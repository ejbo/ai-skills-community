import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// POST /api/videos/[slug]/view (login) — counts a view every time the user opens
// the video page. No per-user dedupe by design (each open counts once).
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const video = await prisma.video.findUnique({
    where: { slug: params.slug },
    select: { id: true, deletedAt: true },
  });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.video.update({ where: { id: video.id }, data: { viewCount: { increment: 1 } } });
  return NextResponse.json({ ok: true });
}
