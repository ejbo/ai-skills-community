import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Toggle the viewer's like. Returns the authoritative count. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const post = await prisma.post.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const key = { userId_postId: { userId: session.user.id, postId: post.id } };
  const existing = await prisma.postLike.findUnique({ where: key });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.postLike.delete({ where: key }),
      prisma.post.update({
        where: { id: post.id },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      }),
    ]);
    return NextResponse.json({ liked: false, likeCount: updated.likeCount });
  }

  const [, updated] = await prisma.$transaction([
    prisma.postLike.create({
      data: { userId: session.user.id, postId: post.id },
    }),
    prisma.post.update({
      where: { id: post.id },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    }),
  ]);
  return NextResponse.json({ liked: true, likeCount: updated.likeCount });
}
