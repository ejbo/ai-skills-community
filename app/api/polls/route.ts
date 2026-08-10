import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { getPollDto, viewerFromSession } from '@/lib/poll-queries';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const createSchema = z.object({
  question: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(12),
  multiple: z.boolean().optional().default(false),
  maxChoices: z.number().int().min(2).max(12).nullish(),
  anonymous: z.boolean().optional().default(false),
  resultsAfterVote: z.boolean().optional().default(false),
  endsAt: z.string().datetime({ offset: true }).nullish(),
});

// POST /api/polls — create a poll the editor then embeds as a `[poll:<id>]`
// token. Polls are immutable after creation (option edits would invalidate
// cast votes); the only later mutation is the creator/admin closing it early.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`poll:create:${session.user.id}`, 30, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const data = parsed.data;

  const endsAt = data.endsAt ? new Date(data.endsAt) : null;
  if (endsAt && endsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'ends_in_past' }, { status: 400 });
  }

  // maxChoices only means something for multi-choice polls, and a limit ≥ the
  // option count is no limit at all — normalize both to null.
  let maxChoices = data.multiple ? (data.maxChoices ?? null) : null;
  if (maxChoices != null && maxChoices >= data.options.length) maxChoices = null;

  const poll = await prisma.poll.create({
    data: {
      creatorId: session.user.id,
      question: data.question,
      multiple: data.multiple,
      maxChoices,
      anonymous: data.anonymous,
      resultsAfterVote: data.resultsAfterVote,
      endsAt,
      options: { create: data.options.map((text, i) => ({ text, ord: i })) },
    },
    select: { id: true },
  });

  const dto = await getPollDto(poll.id, viewerFromSession(session));
  return NextResponse.json({ ok: true, poll: dto });
}
