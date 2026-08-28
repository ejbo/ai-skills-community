import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/feedback/[id]/comments/[commentId]/like (login) — toggle → { liked, likeCount }.
// Guarded writes + authoritative re-read: the same contract every like route in
// this app follows, so a racing double-click is a no-op instead of a 500 and the
// counter cannot drift away from the join table.
export async function POST(
  _req: Request,
  { params }: { params: { id: string; commentId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`feedback:comment-like:${session.user.id}`, 60, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const comment = await prisma.feedbackComment.findUnique({
    where: { id: params.commentId },
    select: { id: true, status: true, feedbackId: true },
  });
  // The board is open to every signed-in member, so existence + not-a-tombstone
  // is the whole gate — but the comment must belong to the feedback in the URL.
  if (!comment || comment.status === 'deleted' || comment.feedbackId !== params.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = { userId: session.user.id, commentId: comment.id };
  await prisma.$transaction(async (tx) => {
    const removed = await tx.feedbackCommentLike.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.feedbackComment.update({
        where: { id: comment.id },
        data: { likeCount: { decrement: removed.count } },
      });
      return;
    }
    const added = await tx.feedbackCommentLike.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.feedbackComment.update({
        where: { id: comment.id },
        data: { likeCount: { increment: added.count } },
      });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.feedbackComment.findUnique({ where: { id: comment.id }, select: { likeCount: true } }),
    prisma.feedbackCommentLike.findUnique({
      where: { userId_commentId: key },
      select: { userId: true },
    }),
  ]);
  return NextResponse.json({ liked: Boolean(mine), likeCount: Math.max(0, fresh?.likeCount ?? 0) });
}
