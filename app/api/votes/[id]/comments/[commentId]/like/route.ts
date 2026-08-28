import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/votes/[id]/comments/[commentId]/like (login) — toggle.
// Gate mirrors the comments LIST route: comments on a hidden or unapproved
// entry are visible (and therefore likeable) only to the creator/admins.
export async function POST(
  _req: Request,
  { params }: { params: { id: string; commentId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`votes:comment-like:${session.user.id}`, 60, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const comment = await prisma.voteComment.findUnique({
    where: { id: params.commentId },
    select: {
      id: true,
      activityId: true,
      activity: { select: { deletedAt: true, creatorId: true } },
      entry: { select: { hidden: true, status: true } },
    },
  });
  if (!comment || comment.activityId !== params.id || comment.activity.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const isManager = can(session.user, 'votes') || comment.activity.creatorId === session.user.id;
  if ((comment.entry.hidden || comment.entry.status !== 'approved') && !isManager) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = { userId: session.user.id, commentId: comment.id };
  await prisma.$transaction(async (tx) => {
    const removed = await tx.voteCommentLike.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.voteComment.update({
        where: { id: comment.id },
        data: { likeCount: { decrement: removed.count } },
      });
      return;
    }
    const added = await tx.voteCommentLike.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.voteComment.update({
        where: { id: comment.id },
        data: { likeCount: { increment: added.count } },
      });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.voteComment.findUnique({ where: { id: comment.id }, select: { likeCount: true } }),
    prisma.voteCommentLike.findUnique({
      where: { userId_commentId: key },
      select: { userId: true },
    }),
  ]);
  return NextResponse.json({
    ok: true,
    liked: Boolean(mine),
    likeCount: Math.max(0, fresh?.likeCount ?? 0),
  });
}
