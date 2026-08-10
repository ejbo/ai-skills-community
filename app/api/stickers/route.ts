import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { toStickerDto } from '@/lib/sticker-queries';

export const dynamic = 'force-dynamic';

// GET /api/stickers — the viewer's whole sticker library, newest first.
// The picker derives its tabs client-side: 全部 = this order, 收藏 = favorited,
// 最近 = lastUsedAt desc (see StickerPicker).
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rows = await prisma.userSticker.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ stickers: rows.map(toStickerDto) });
}
