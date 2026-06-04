import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// POST /api/videos/[slug]/like (login) — toggle VideoLike + Video.likeCount.
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const video = await prisma.video.findUnique({ where: { slug: params.slug }, select: { id: true, deletedAt: true } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const userId = session.user.id;
  const existing = await prisma.videoLike.findUnique({
    where: { userId_videoId: { userId, videoId: video.id } },
  });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.videoLike.delete({ where: { userId_videoId: { userId, videoId: video.id } } }),
      prisma.video.update({ where: { id: video.id }, data: { likeCount: { decrement: 1 } }, select: { likeCount: true } }),
    ]);
    return NextResponse.json({ liked: false, likeCount: updated.likeCount });
  }

  const [, updated] = await prisma.$transaction([
    prisma.videoLike.create({ data: { userId, videoId: video.id } }),
    prisma.video.update({ where: { id: video.id }, data: { likeCount: { increment: 1 } }, select: { likeCount: true } }),
  ]);
  return NextResponse.json({ liked: true, likeCount: updated.likeCount });
}
