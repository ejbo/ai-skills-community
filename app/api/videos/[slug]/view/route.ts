import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// POST /api/videos/[slug]/view (login) — day-bucketed dedupe. First insert per
// (user, video, UTC day) increments viewCount; replays hit the unique index and
// are silently ignored.
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const video = await prisma.video.findUnique({ where: { slug: params.slug }, select: { id: true, deletedAt: true } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // UTC YYYYMMDD
  const sessionHash = createHash('sha256')
    .update(`${session.user.id}:${video.id}:${day}`)
    .digest('hex');

  try {
    await prisma.$transaction([
      prisma.videoView.create({
        data: { videoId: video.id, userId: session.user.id, sessionHash },
      }),
      prisma.video.update({ where: { id: video.id }, data: { viewCount: { increment: 1 } } }),
    ]);
  } catch (e) {
    // P2002 = unique constraint: already counted today. Anything else: swallow too.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) {
      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ ok: true });
}
