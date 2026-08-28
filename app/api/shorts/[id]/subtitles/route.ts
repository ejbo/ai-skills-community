import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { generateShortSubtitles, subtitlesAvailable, sweepStaleSubtitles } from '@/lib/video/subtitles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// POST /api/shorts/[id]/subtitles — (re)generate subtitle tracks on demand.
// Author-or-admin; the pipeline itself claims the row atomically so concurrent
// triggers never double-run, and queues the ASR behind its FIFO.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`shorts:subtitles:${session.user.id}`, 5, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  // Awaited on purpose, BEFORE reading the row: a restart strands jobs at
  // 'processing', which is the one status this route refuses — so 重试 on
  // exactly those rows would answer "processing" forever. The sweep is
  // TTL-throttled (one run per ~10 min, de-duplicated while in flight), so it
  // costs nothing on the common path — and unlike the old run-once-per-process
  // memo it can still rescue a row whose lease expires AFTER this process
  // booted, which is exactly the case a deploy creates.
  await sweepStaleSubtitles();

  const short = await prisma.video.findFirst({
    where: { id: params.id, isShort: true, deletedAt: null },
    select: { id: true, uploaderId: true, subtitleStatus: true },
  });
  if (!short) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (short.uploaderId !== session.user.id && !can(session.user, 'shorts')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (short.subtitleStatus === 'processing') {
    return NextResponse.json({ ok: true, status: 'processing' });
  }
  if (!(await subtitlesAvailable())) {
    return NextResponse.json(
      {
        error: 'subtitles_unconfigured',
        reason: '服务器未安装 whisper（whisper-cli 或 openai-whisper），无法生成字幕',
      },
      { status: 503 },
    );
  }

  void generateShortSubtitles(short.id);
  return NextResponse.json({ ok: true, status: 'processing' });
}
