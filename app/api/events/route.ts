import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { composeEventData, eventContentSchema } from '@/lib/events/validate';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// POST /api/events — publish an event (any logged-in member).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`events:create:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '发布过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = eventContentSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? '请求参数无效' },
      { status: 400 },
    );
  }

  const composed = composeEventData(parsed.data);
  if (!composed.ok) {
    return NextResponse.json({ error: 'invalid_input', reason: composed.reason }, { status: 400 });
  }

  const created = await prisma.event.create({
    data: {
      ...composed.value.columns,
      authorId: session.user.id,
      speakers: { create: composed.value.speakers },
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, event: created });
}
