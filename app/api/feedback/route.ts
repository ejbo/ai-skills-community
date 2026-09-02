import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { notifyMentions } from '@/lib/mention-notify';

const HOUR_MS = 60 * 60 * 1000;

const createSchema = z.object({
  title: z.string().trim().min(4, '标题至少 4 个字').max(120),
  bodyMd: z.string().max(10000).default(''),
  category: z.enum(['feature', 'bug', 'other']).default('other'),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`feedback:new:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '提交过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? '请求参数无效' },
      { status: 400 },
    );
  }

  const created = await prisma.feedback.create({
    data: { ...parsed.data, authorId: session.user.id },
    select: { id: true },
  });

  // @人 — the 意见反馈 board has no per-item visibility: every member can open
  // any feedback, so there is nothing to gate on. Best-effort, never blocks.
  void notifyMentions({
    bodyMd: parsed.data.bodyMd,
    actorId: session.user.id,
    actorName: session.user.displayName,
    site: { what: '反馈', title: parsed.data.title, link: `/feedback/${created.id}` },
  });

  return NextResponse.json({ ok: true, feedback: created });
}
