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

const patchSchema = z.object({ close: z.literal(true) });

// PATCH /api/polls/[id] — creator/admin closes the poll early. Idempotent:
// closing an already-ended poll just returns the current state.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!patchSchema.safeParse(body).success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const poll = await prisma.poll.findUnique({
    where: { id: params.id },
    select: { id: true, creatorId: true, closedAt: true },
  });
  if (!poll) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (poll.creatorId !== session.user.id && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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
