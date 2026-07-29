import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Toggle the viewer's like on a post comment. Returns the authoritative count. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const comment = await prisma.postComment.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  });
  if (!comment || comment.status === 'deleted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = { userId_commentId: { userId: session.user.id, commentId: comment.id } };
  const existing = await prisma.postCommentLike.findUnique({ where: key });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.postCommentLike.delete({ where: key }),
      prisma.postComment.update({
        where: { id: comment.id },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      }),
    ]);
    return NextResponse.json({ liked: false, likeCount: updated.likeCount });
  }

  const [, updated] = await prisma.$transaction([
    prisma.postCommentLike.create({
      data: { userId: session.user.id, commentId: comment.id },
    }),
    prisma.postComment.update({
      where: { id: comment.id },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    }),
  ]);
  return NextResponse.json({ liked: true, likeCount: updated.likeCount });
}
