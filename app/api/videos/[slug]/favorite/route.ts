import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// POST /api/videos/[slug]/favorite (login) — toggle VideoFavorite + Video.favoriteCount.
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const video = await prisma.video.findUnique({ where: { slug: params.slug }, select: { id: true, deletedAt: true } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const userId = session.user.id;
  const existing = await prisma.videoFavorite.findUnique({
    where: { userId_videoId: { userId, videoId: video.id } },
  });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.videoFavorite.delete({ where: { userId_videoId: { userId, videoId: video.id } } }),
      prisma.video.update({
        where: { id: video.id },
        data: { favoriteCount: { decrement: 1 } },
        select: { favoriteCount: true },
      }),
    ]);
    return NextResponse.json({ favorited: false, favoriteCount: updated.favoriteCount });
  }

  const [, updated] = await prisma.$transaction([
    prisma.videoFavorite.create({ data: { userId, videoId: video.id } }),
    prisma.video.update({
      where: { id: video.id },
      data: { favoriteCount: { increment: 1 } },
      select: { favoriteCount: true },
    }),
  ]);
  return NextResponse.json({ favorited: true, favoriteCount: updated.favoriteCount });
}
