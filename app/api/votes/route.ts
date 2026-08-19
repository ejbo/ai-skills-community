import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { VOTE_TITLE_MAX } from '@/lib/votes/shared';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const createSchema = z.object({
  title: z.string().trim().min(1).max(VOTE_TITLE_MAX),
});

// POST /api/votes — create a DRAFT vote activity (the resumable upload target).
// The creator then attaches entries via /api/votes/[id]/upload and publishes
// with PATCH { publish: true }.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`votes:create:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const activity = await prisma.voteActivity.create({
    data: { creatorId: session.user.id, title: parsed.data.title },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, activity });
}
