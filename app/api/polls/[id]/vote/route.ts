import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { getPollDto, pollEnded, viewerFromSession } from '@/lib/poll-queries';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

const voteSchema = z.object({
  // The FULL new selection (replace semantics, so 改票 is one call);
  // empty array = 撤销投票.
  optionIds: z.array(z.string().min(1).max(64)).max(12),
});

// POST /api/polls/[id]/vote — cast / change / retract the viewer's vote.
// The transaction REPLACES the user's votes then recomputes every denormalized
// count from the actual PollVote rows (no increment drift); Serializable +
// retry keeps concurrent recounts honest, and a final conflict after retries is
// a real failure (the vote didn't land), reported as 500 — not swallowed.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const userId = session.user.id;

  const gate = rateLimit(`poll:vote:${userId}`, 60, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const poll = await prisma.poll.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      multiple: true,
      maxChoices: true,
      resultsAfterVote: true,
      endsAt: true,
      closedAt: true,
      options: { select: { id: true } },
    },
  });
  if (!poll) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (pollEnded(poll)) return NextResponse.json({ error: 'poll_ended' }, { status: 400 });
  // 投票后才能查看结果: full retraction would be a free peek (vote → see the
  // numbers → retract). Vote CHANGES stay allowed; only emptying is blocked.
  if (poll.resultsAfterVote && parsed.data.optionIds.length === 0) {
    return NextResponse.json({ error: 'retract_forbidden' }, { status: 400 });
  }

  const validIds = new Set(poll.options.map((o) => o.id));
  const ids = Array.from(new Set(parsed.data.optionIds));
  if (ids.some((id) => !validIds.has(id))) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const limit = poll.multiple ? (poll.maxChoices ?? poll.options.length) : 1;
  if (ids.length > limit) {
    return NextResponse.json({ error: 'too_many_choices' }, { status: 400 });
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.pollVote.deleteMany({ where: { pollId: poll.id, userId } });
          if (ids.length > 0) {
            await tx.pollVote.createMany({
              data: ids.map((optionId) => ({ pollId: poll.id, optionId, userId })),
            });
          }
          const grouped = await tx.pollVote.groupBy({
            by: ['optionId'],
            where: { pollId: poll.id },
            _count: { _all: true },
          });
          const counts = new Map(grouped.map((g) => [g.optionId, g._count._all]));
          for (const o of poll.options) {
            await tx.pollOption.update({
              where: { id: o.id },
              data: { voteCount: counts.get(o.id) ?? 0 },
            });
          }
          const voters = await tx.pollVote.findMany({
            where: { pollId: poll.id },
            distinct: ['userId'],
            select: { userId: true },
          });
          await tx.poll.update({
            where: { id: poll.id },
            data: { voterCount: voters.length },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (e) {
      const conflict =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (conflict && attempt < 3) continue;
      return NextResponse.json({ error: 'vote_failed' }, { status: 500 });
    }
  }

  const dto = await getPollDto(poll.id, viewerFromSession(session));
  return NextResponse.json({ ok: true, poll: dto });
}
