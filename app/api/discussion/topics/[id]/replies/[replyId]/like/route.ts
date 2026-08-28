import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/discussion/topics/[id]/replies/[replyId]/like (login) — toggle.
// Guarded writes + authoritative re-read (see the zones comment-like route).
export async function POST(
  _req: Request,
  { params }: { params: { id: string; replyId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`discussion:reply-like:${session.user.id}`, 60, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const reply = await prisma.discussionReply.findUnique({
    where: { id: params.replyId },
    select: { id: true, status: true, topicId: true },
  });
  if (!reply || reply.status === 'deleted' || reply.topicId !== params.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // A locked topic stops NEW replies, not appreciation of the existing ones —
  // the same reason likes stay open on a closed thread elsewhere.

  const key = { userId: session.user.id, replyId: reply.id };
  await prisma.$transaction(async (tx) => {
    const removed = await tx.discussionReplyLike.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.discussionReply.update({
        where: { id: reply.id },
        data: { likeCount: { decrement: removed.count } },
      });
      return;
    }
    const added = await tx.discussionReplyLike.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.discussionReply.update({
        where: { id: reply.id },
        data: { likeCount: { increment: added.count } },
      });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.discussionReply.findUnique({ where: { id: reply.id }, select: { likeCount: true } }),
    prisma.discussionReplyLike.findUnique({
      where: { userId_replyId: key },
      select: { userId: true },
    }),
  ]);
  return NextResponse.json({ liked: Boolean(mine), likeCount: Math.max(0, fresh?.likeCount ?? 0) });
}
