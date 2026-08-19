import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { voteDayKey, votingOpen } from '@/lib/votes/shared';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

const voteSchema = z.object({
  action: z.enum(['add', 'remove']),
});

// POST /api/votes/[id]/entries/[entryId]/vote — spend / reclaim ONE vote.
// Budget (每人 N 票, total or per-Beijing-day) and the per-entry cap are
// enforced INSIDE a Serializable transaction that recomputes every
// denormalized count from the VoteBallot rows (poll pattern — no increment
// drift, concurrent double-spends serialize). The response is an
// authoritative re-read with results gated server-side.
export async function POST(
  req: Request,
  { params }: { params: { id: string; entryId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const userId = session.user.id;

  const gate = rateLimit(`votes:cast:${userId}`, 60, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  // SSO 部署下投票要求华为 W3 实名身份 — 密码注册的小号不能刷票。
  if (env.ENABLE_SSO) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { huaweiW3Id: true },
    });
    if (!me?.huaweiW3Id) {
      return NextResponse.json({ error: 'huawei_required' }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => null);
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const action = parsed.data.action;

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
  if (!activity || activity.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!votingOpen(activity.status, activity)) {
    return NextResponse.json({ error: 'vote_closed' }, { status: 400 });
  }
  if (action === 'remove' && !activity.allowRevoke) {
    return NextResponse.json({ error: 'revoke_forbidden' }, { status: 400 });
  }

  const entry = await prisma.voteEntry.findUnique({
    where: { id: params.entryId },
    select: { id: true, activityId: true, hidden: true, status: true },
  });
  if (!entry || entry.activityId !== activity.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Hidden/unapproved entries accept no NEW votes, but 撤票 must keep working —
  // votes on a later-hidden entry still consume the voter's budget until
  // reclaimed.
  if (action === 'add' && (entry.hidden || entry.status !== 'approved')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const dayKey = voteDayKey(activity.budgetPeriod);
  const ballotKey = { entryId_userId_day: { entryId: entry.id, userId, day: dayKey } };

  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const mine = await tx.voteBallot.findMany({
            where: { activityId: activity.id, userId, day: dayKey },
            select: { entryId: true, count: true },
          });
          const used = mine.reduce((sum, b) => sum + b.count, 0);
          const onEntry = mine.find((b) => b.entryId === entry.id)?.count ?? 0;

          if (action === 'add') {
            if (used + 1 > activity.votesPerUser) throw new Error('budget_exhausted');
            if (onEntry + 1 > activity.maxPerEntry) throw new Error('entry_cap');
            await tx.voteBallot.upsert({
              where: ballotKey,
              create: {
                activityId: activity.id,
                entryId: entry.id,
                userId,
                day: dayKey,
                count: 1,
              },
              update: { count: { increment: 1 } },
            });
          } else {
            if (onEntry <= 0) throw new Error('nothing_to_remove');
            if (onEntry === 1) {
              await tx.voteBallot.delete({ where: ballotKey });
            } else {
              await tx.voteBallot.update({
                where: ballotKey,
                data: { count: { decrement: 1 } },
              });
            }
          }

          // Recompute denormalized counters from the rows (never increment).
          const entryTotal = await tx.voteBallot.aggregate({
            where: { entryId: entry.id },
            _sum: { count: true },
          });
          await tx.voteEntry.update({
            where: { id: entry.id },
            data: { voteCount: entryTotal._sum.count ?? 0 },
          });
          const totals = await tx.voteBallot.aggregate({
            where: { activityId: activity.id },
            _sum: { count: true },
          });
          const voters = await tx.voteBallot.findMany({
            where: { activityId: activity.id },
            distinct: ['userId'],
            select: { userId: true },
          });
          await tx.voteActivity.update({
            where: { id: activity.id },
            data: { voteCount: totals._sum.count ?? 0, voterCount: voters.length },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'budget_exhausted') {
          return NextResponse.json({ error: 'budget_exhausted' }, { status: 400 });
        }
        if (e.message === 'entry_cap') {
          return NextResponse.json({ error: 'entry_cap' }, { status: 400 });
        }
        if (e.message === 'nothing_to_remove') {
          return NextResponse.json({ error: 'nothing_to_remove' }, { status: 400 });
        }
      }
      const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (conflict && attempt < 5) {
        // Every vote rewrites the same VoteActivity row, so concurrent voters
        // WILL serialize-conflict under load — jittered backoff instead of
        // hammering immediate retries.
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 60));
        continue;
      }
      return NextResponse.json({ error: 'vote_failed' }, { status: 500 });
    }
  }

  // Authoritative re-read; results stay server-gated exactly like the page.
  const [entryRow, activityRow, myRows] = await Promise.all([
    prisma.voteEntry.findUnique({ where: { id: entry.id }, select: { voteCount: true } }),
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
  const isOwner = session.user.isAdmin || userId === activity.creatorId;
  const resultsVisible = isOwner || activity.resultsMode === 'realtime';

  return NextResponse.json({
    ok: true,
    myVotes: myRows.find((b) => b.entryId === entry.id)?.count ?? 0,
    budgetUsed,
    budgetRemaining: Math.max(0, activity.votesPerUser - budgetUsed),
    voteCount: resultsVisible ? (entryRow?.voteCount ?? 0) : null,
    activityVoteCount: resultsVisible ? (activityRow?.voteCount ?? 0) : null,
    voterCount: activityRow?.voterCount ?? 0,
  });
}
