import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { recordShortView } from '@/lib/video/shorts-queries';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/shorts/[id]/view (login) — the feed pings this once per short after
// ~2s of ACCUMULATED real playback (not merely mounted time). Server-side the
// VideoView sessionHash dedupes to one view per viewer per short per UTC day,
// unlike the long-video ViewPing (+1 per open, deliberate).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`shorts:view:${session.user.id}`, 120, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const short = await prisma.video.findFirst({
    where: { id: params.id, isShort: true, status: 'published', deletedAt: null },
    select: { id: true },
  });
  if (!short) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await recordShortView(short.id, session.user.id);
  return NextResponse.json({ ok: true });
}
