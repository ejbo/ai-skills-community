import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import {
  MAX_BALLOT_CHANGES,
  MAX_PER_ENTRY_MAX,
  planBallotChanges,
  voteDayKey,
  votingOpen,
} from '@/lib/votes/shared';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

const bodySchema = z.object({
  // The budget bucket the client computed its desired totals against
  // (viewer.dayKey). In daily mode a tab kept open across Beijing midnight
  // would otherwise turn "+1" into an absolute "3" on the fresh day.
  day: z.string().max(16),
  changes: z
    .array(
      z.object({
        entryId: z.string().min(1).max(64),
        // DESIRED total on that entry (not a delta) — a retried submit is idempotent.
        count: z.number().int().min(0).max(MAX_PER_ENTRY_MAX),
      }),
    )
    .min(1)
    .max(MAX_BALLOT_CHANGES),
});

class PlanRejected extends Error {
  constructor(
    readonly code: string,
    readonly entryId?: string,
  ) {
    super(code);
  }
}

// POST /api/votes/[id]/ballots — submit the gallery's draft in ONE request.
// Body: { day, changes: [{ entryId, count }] } where count is the desired total
// on that entry in the CURRENT budget bucket; entries not listed are untouched.
// Budget (每人 N 票, total or per-Beijing-day), the per-entry cap and 撤票 are
// validated by planBallotChanges INSIDE a Serializable transaction against the
// ballot rows (cap/budget gate INCREASES only — a voter over a lowered limit
// can always 撤回), then every denormalized counter is RECOMPUTED from the
// rows (never incremented). Writes are batched (deleteMany / createMany /
// updateMany per distinct count + one recount statement) so a 1000-entry
// draft is still a handful of statements inside the tx window. The response
// is an authoritative re-read with results gated server-side exactly like the
// page payload.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const userId = session.user.id;

  const gate = rateLimit(`votes:cast:${userId}`, 60, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  // SSO 部署下投票要求华为 W3 实名身份 — 密码注册的小号不能刷票。
  if (env.ENABLE_SSO) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { huaweiW3Id: true } });
    if (!me?.huaweiW3Id) return NextResponse.json({ error: 'huawei_required' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const changes = parsed.data.changes;
  if (new Set(changes.map((c) => c.entryId)).size !== changes.length) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const activity = await prisma.voteActivity.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      creatorId: true,
      startAt: true,
      endAt: true,
      closedAt: true,
      votesPerUser: true,
      budgetPeriod: true,
      maxPerEntry: true,
      allowRevoke: true,
      resultsMode: true,
    },
  });
  if (!activity || activity.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!votingOpen(activity.status, activity)) {
    return NextResponse.json({ error: 'vote_closed' }, { status: 400 });
  }

  const dayKey = voteDayKey(activity.budgetPeriod);
  if (parsed.data.day !== dayKey) {
    // The client's picture is from another bucket — it must re-read and re-draft.
    return NextResponse.json({ error: 'budget_reset', day: dayKey }, { status: 400 });
  }

  const entryIds = changes.map((c) => c.entryId);
  const entries = await prisma.voteEntry.findMany({
    where: { id: { in: entryIds }, activityId: activity.id },
    select: { id: true, hidden: true, status: true },
  });
  const entryById = new Map(entries.map((e) => [e.id, e]));
  for (const c of changes) {
    if (!entryById.has(c.entryId)) {
      return NextResponse.json({ error: 'entry_unavailable', entryId: c.entryId }, { status: 400 });
    }
  }

  const rules = {
    votesPerUser: activity.votesPerUser,
    maxPerEntry: activity.maxPerEntry,
    allowRevoke: activity.allowRevoke,
  };
  let touched: string[] = [];

  for (let attempt = 0; ; attempt++) {
    touched = [];
    try {
      await prisma.$transaction(
        async (tx) => {
          const mine = await tx.voteBallot.findMany({
            where: { activityId: activity.id, userId, day: dayKey },
            select: { entryId: true, count: true },
          });
          const current = new Map(mine.map((b) => [b.entryId, b.count]));
          const planned = planBallotChanges(rules, current, changes);
          if (!planned.ok) throw new PlanRejected(planned.error, planned.entryId);

          const zeroed: string[] = [];
          const created: { entryId: string; count: number }[] = [];
          const updated = new Map<number, string[]>(); // count → entryIds (rows that exist)
          for (const step of planned.plan.steps) {
            // Hidden/unapproved entries accept no NEW votes, but 撤票 must keep
            // working — votes on a later-hidden entry still consume the voter's
            // budget until reclaimed.
            const entry = entryById.get(step.entryId)!;
            if (step.to > step.from && (entry.hidden || entry.status !== 'approved')) {
              throw new PlanRejected('entry_unavailable', step.entryId);
            }
            if (step.to === 0) zeroed.push(step.entryId);
            else if (step.from === 0) created.push({ entryId: step.entryId, count: step.to });
            else updated.set(step.to, [...(updated.get(step.to) ?? []), step.entryId]);
            touched.push(step.entryId);
          }
          if (touched.length === 0) return; // idempotent no-op — nothing to recount

          if (zeroed.length) {
            await tx.voteBallot.deleteMany({ where: { userId, day: dayKey, entryId: { in: zeroed } } });
          }
          if (created.length) {
            await tx.voteBallot.createMany({
              data: created.map((c) => ({
                activityId: activity.id,
                entryId: c.entryId,
                userId,
                day: dayKey,
                count: c.count,
              })),
            });
          }
          for (const [count, ids] of updated) {
            await tx.voteBallot.updateMany({
              where: { userId, day: dayKey, entryId: { in: ids } },
              data: { count },
            });
          }

          // Recompute denormalized counters from the rows (never increment) —
          // ONE statement for every touched entry, however many there are.
          await tx.$executeRaw`
            UPDATE "VoteEntry" AS e
            SET "voteCount" = COALESCE((SELECT SUM(b."count") FROM "VoteBallot" AS b WHERE b."entryId" = e."id"), 0)::int
            WHERE e."id" IN (${Prisma.join(touched)})`;
          // Sequential on purpose: an interactive tx rides ONE connection.
          const totals = await tx.voteBallot.aggregate({
            where: { activityId: activity.id },
            _sum: { count: true },
          });
          // GROUP BY in SQL — one row per voter, not one per ballot (Prisma's
          // `distinct` is applied in memory over every row).
          const voters = await tx.voteBallot.groupBy({ by: ['userId'], where: { activityId: activity.id } });
          await tx.voteActivity.update({
            where: { id: activity.id },
            data: { voteCount: totals._sum.count ?? 0, voterCount: voters.length },
          });
        },
        // A large draft is still ~8 statements, but give it headroom over
        // Prisma's 5 s default so a slow RDS round-trip cannot P2028 it.
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 },
      );
      break;
    } catch (e) {
      if (e instanceof PlanRejected) {
        return NextResponse.json({ error: e.code, entryId: e.entryId }, { status: 400 });
      }
      const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (conflict && attempt < 5) {
        // Every submission rewrites the same VoteActivity row, so concurrent
        // voters WILL serialize-conflict under load — jittered backoff instead
        // of hammering immediate retries.
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 60));
        continue;
      }
      return NextResponse.json({ error: 'vote_failed' }, { status: 500 });
    }
  }

  // Authoritative re-read; results stay server-gated exactly like the page.
  const [entryRows, activityRow, myRows] = await Promise.all([
    touched.length
      ? prisma.voteEntry.findMany({ where: { id: { in: touched } }, select: { id: true, voteCount: true } })
      : Promise.resolve([] as { id: string; voteCount: number }[]),
    prisma.voteActivity.findUnique({
      where: { id: activity.id },
      select: { voteCount: true, voterCount: true },
    }),
    prisma.voteBallot.findMany({
      where: { activityId: activity.id, userId, day: dayKey },
      select: { entryId: true, count: true },
    }),
  ]);
  const budgetUsed = myRows.reduce((sum, b) => sum + b.count, 0);
  const isOwner = can(session.user, 'votes') || userId === activity.creatorId;
  const resultsVisible = isOwner || activity.resultsMode === 'realtime';

  return NextResponse.json({
    ok: true,
    applied: touched.length,
    day: dayKey,
    myBallots: Object.fromEntries(myRows.map((b) => [b.entryId, b.count])),
    budgetUsed,
    budgetRemaining: Math.max(0, activity.votesPerUser - budgetUsed),
    entryVotes: resultsVisible ? Object.fromEntries(entryRows.map((e) => [e.id, e.voteCount])) : null,
    activityVoteCount: resultsVisible ? (activityRow?.voteCount ?? 0) : null,
    voterCount: activityRow?.voterCount ?? 0,
  });
}
