import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { getPollDto, viewerFromSession } from '@/lib/poll-queries';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// GET /api/polls/[id] — poll state for the current viewer. Anonymous is
// allowed (polls embed in publicly readable content) but sees no voter
// identities and no gated results — getPollDto decides all of that
// server-side. Rate-limited (the only anonymous poll endpoint): keyed by user
// id, else x-real-ip / LAST XFF hop (first hop is forgeable — same anon-key
// convention as DiscussionTopicView).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const anonIp =
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ??
    'unknown';
  const gate = rateLimit(`poll:get:${session?.user?.id ?? anonIp}`, 240, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }
  const dto = await getPollDto(params.id, viewerFromSession(session));
  if (!dto) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, poll: dto });
}

const closeSchema = z.object({ close: z.literal(true) });

// Mirrors the create schema (app/api/polls/route.ts) — a poll edit is a full
// replacement of its definition, only legal while nobody has voted.
const editSchema = z.object({
  question: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(12),
  multiple: z.boolean().optional().default(false),
  maxChoices: z.number().int().min(2).max(12).nullish(),
  anonymous: z.boolean().optional().default(false),
  resultsAfterVote: z.boolean().optional().default(false),
  endsAt: z.string().datetime({ offset: true }).nullish(),
});

// PATCH /api/polls/[id] — creator/admin only. Two actions:
//   { close: true }  → end the poll early (idempotent: already-ended returns state)
//   { question, options, … } → edit the definition, allowed ONLY while
//   voterCount === 0 (editing under cast votes would corrupt their meaning);
//   options are replaced wholesale (EventSpeaker pattern) — safe, no votes exist.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);

  const poll = await prisma.poll.findUnique({
    where: { id: params.id },
    select: { id: true, creatorId: true, closedAt: true, voterCount: true },
  });
  if (!poll) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (poll.creatorId !== session.user.id && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (closeSchema.safeParse(body).success) {
    if (!poll.closedAt) {
      // Guarded write: only flips when still open, so a double-click never
      // moves an existing closedAt.
      await prisma.poll.updateMany({
        where: { id: poll.id, closedAt: null },
        data: { closedAt: new Date() },
      });
    }
    const dto = await getPollDto(poll.id, viewerFromSession(session));
    return NextResponse.json({ ok: true, poll: dto });
  }

  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const data = parsed.data;

  // Re-checked inside the transaction below — this is just the fast path.
  if (poll.voterCount > 0) {
    return NextResponse.json({ error: 'poll_has_votes' }, { status: 400 });
  }

  const endsAt = data.endsAt ? new Date(data.endsAt) : null;
  if (endsAt && endsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'ends_in_past' }, { status: 400 });
  }
  let maxChoices = data.multiple ? (data.maxChoices ?? null) : null;
  if (maxChoices != null && maxChoices >= data.options.length) maxChoices = null;

  try {
    await prisma.$transaction(async (tx) => {
      // A vote may have landed between the fast path and here.
      const votes = await tx.pollVote.count({ where: { pollId: poll.id } });
      if (votes > 0) throw new Error('poll_has_votes');
      await tx.pollOption.deleteMany({ where: { pollId: poll.id } });
      await tx.poll.update({
        where: { id: poll.id },
        data: {
          question: data.question,
          multiple: data.multiple,
          maxChoices,
          anonymous: data.anonymous,
          resultsAfterVote: data.resultsAfterVote,
          endsAt,
          voterCount: 0,
          options: { create: data.options.map((text, i) => ({ text, ord: i })) },
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'poll_has_votes') {
      return NextResponse.json({ error: 'poll_has_votes' }, { status: 400 });
    }
    console.error('[polls/edit]', e);
    return NextResponse.json({ error: 'edit_failed' }, { status: 500 });
  }

  const dto = await getPollDto(poll.id, viewerFromSession(session));
  return NextResponse.json({ ok: true, poll: dto });
}
