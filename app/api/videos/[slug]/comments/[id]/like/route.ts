import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// POST /api/videos/[slug]/comments/[id]/like (login) — toggle VideoCommentLike + likeCount.
export async function POST(_req: Request, { params }: { params: { slug: string; id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const comment = await prisma.videoComment.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, video: { select: { slug: true, deletedAt: true } } },
  });
  if (!comment || comment.status === 'deleted' || comment.video.slug !== params.slug || comment.video.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const userId = session.user.id;
  const existing = await prisma.videoCommentLike.findUnique({
    where: { userId_commentId: { userId, commentId: comment.id } },
  });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.videoCommentLike.delete({ where: { userId_commentId: { userId, commentId: comment.id } } }),
      prisma.videoComment.update({
        where: { id: comment.id },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      }),
    ]);
    return NextResponse.json({ liked: false, likeCount: updated.likeCount });
  }

  const [, updated] = await prisma.$transaction([
    prisma.videoCommentLike.create({ data: { userId, commentId: comment.id } }),
    prisma.videoComment.update({
      where: { id: comment.id },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    }),
  ]);
  return NextResponse.json({ liked: true, likeCount: updated.likeCount });
}
