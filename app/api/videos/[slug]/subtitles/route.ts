import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { logAdmin } from '@/lib/audit';
import { canManageVideo, canViewVideo, getVideoActor } from '@/lib/video/access';
import {
  generateVideoSubtitles,
  removeSubtitleTrack,
  saveUploadedSubtitleTrack,
  subtitlesAvailable,
  sweepStaleSubtitles,
} from '@/lib/video/subtitles';
import { SUBTITLE_FILE_MAX_BYTES, isSubtitleLang, parseSubtitleFile } from '@/lib/video/subtitles-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const NO_STORE = { 'cache-control': 'private, no-store' };

const GATE_SELECT = {
  id: true,
  slug: true,
  status: true,
  visibility: true,
  uploaderId: true,
  deletedAt: true,
  isShort: true,
  subtitleStatus: true,
  subtitleSrcLang: true,
  subtitleZhUrl: true,
  subtitleEnUrl: true,
  subtitleError: true,
  subtitleAt: true,
} as const;

/** Long videos only — a short's subtitles live at /api/shorts/[id]/subtitles (author-or-`shorts`). */
async function loadLongVideo(slug: string) {
  const video = await prisma.video.findUnique({ where: { slug }, select: GATE_SELECT });
  return video && !video.deletedAt && !video.isShort ? video : null;
}

// GET /api/videos/[slug]/subtitles — track state for anyone who may WATCH the
// video. The player polls it while a job is running, so a viewer who opened the
// page right after publish gets subtitles without a reload. `error` is the
// pipeline's own diagnostic ("未安装 whisper…") and goes to managers only.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const actor = await getVideoActor();
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const video = await loadLongVideo(params.slug);
  if (!video || !canViewVideo(video, actor)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(
    {
      status: video.subtitleStatus,
      srcLang: video.subtitleSrcLang,
      zhUrl: video.subtitleZhUrl,
      enUrl: video.subtitleEnUrl,
      at: video.subtitleAt,
      error: canManageVideo(video, actor) ? video.subtitleError : null,
    },
    { headers: NO_STORE },
  );
}

// POST /api/videos/[slug]/subtitles (`videos`) — (re)generate both tracks with
// the local whisper + LLM pipeline. The pipeline claims the row atomically, so
// concurrent triggers never double-run, and queues the ASR behind its FIFO.
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const actor = await getVideoActor();
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`videos:subtitles:${actor.id}`, 20, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  // Awaited BEFORE reading the row: a restart strands jobs at 'processing', the
  // one status this route refuses (same reasoning as the shorts route).
  await sweepStaleSubtitles();

  const video = await loadLongVideo(params.slug);
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canManageVideo(video, actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (video.subtitleStatus === 'processing') {
    return NextResponse.json({ ok: true, status: 'processing' });
  }
  if (!(await subtitlesAvailable())) {
    return NextResponse.json(
      {
        error: 'subtitles_unconfigured',
        reason: '服务器未安装 whisper（whisper-cli 或 openai-whisper），无法自动生成字幕；可以改为上传 VTT / SRT 字幕文件',
      },
      { status: 503 },
    );
  }

  void generateVideoSubtitles(video.id);
  return NextResponse.json({ ok: true, status: 'processing' });
}

// PUT /api/videos/[slug]/subtitles?lang=zh|en[&translate=1] (`videos`) — upload
// a track. Body = the raw .vtt / .srt text (house raw-body protocol). The file is
// PARSED and re-serialised, never stored verbatim (parseSubtitleFile), so what
// the file route later serves as text/vtt is timestamps + plain text lines.
export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const actor = await getVideoActor();
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`videos:subtitles:upload:${actor.id}`, 60, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const url = new URL(req.url);
  const lang = url.searchParams.get('lang');
  if (!isSubtitleLang(lang)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const video = await loadLongVideo(params.slug);
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canManageVideo(video, actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > SUBTITLE_FILE_MAX_BYTES) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  const bytes = await readCapped(req, SUBTITLE_FILE_MAX_BYTES);
  if (bytes === 'too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  if (!bytes) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const cues = parseSubtitleFile(decodeSubtitleBytes(bytes));
  if (!cues) return NextResponse.json({ error: 'invalid_subtitle_file' }, { status: 400 });

  const result = await saveUploadedSubtitleTrack(video.id, lang, cues, {
    translate: url.searchParams.get('translate') === '1',
  });
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'busy' ? 409 : 500;
    return NextResponse.json({ error: result.error === 'busy' ? 'subtitles_busy' : result.error }, { status });
  }
  await logAdmin({
    adminUserId: actor.id,
    action: 'video.subtitles.upload',
    targetType: 'video',
    targetId: video.id,
    details: { slug: video.slug, lang, cues: cues.length },
  });
  return NextResponse.json({ ok: true, status: result.status, cues: cues.length });
}

// DELETE /api/videos/[slug]/subtitles?lang=zh|en (`videos`) — remove one track.
export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const actor = await getVideoActor();
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const lang = new URL(req.url).searchParams.get('lang');
  if (!isSubtitleLang(lang)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const video = await loadLongVideo(params.slug);
  if (!video) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canManageVideo(video, actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const result = await removeSubtitleTrack(video.id, lang);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'busy' ? 409 : 500;
    return NextResponse.json({ error: result.error === 'busy' ? 'subtitles_busy' : result.error }, { status });
  }
  await logAdmin({
    adminUserId: actor.id,
    action: 'video.subtitles.delete',
    targetType: 'video',
    targetId: video.id,
    details: { slug: video.slug, lang },
  });
  return NextResponse.json({ ok: true, status: result.status });
}

/** Read the body up to `max` bytes; 'too_large' past it (a lying or absent content-length must not buffer unbounded). */
async function readCapped(req: Request, max: number): Promise<Uint8Array | 'too_large' | null> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    chunks.push(value);
  }
  if (total === 0) return null;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Subtitle files from Chinese tooling are routinely GB18030/GBK, and Windows
 * editors write UTF-16 with a BOM. UTF-8 first (fatal, so mojibake is detected
 * instead of stored), then the BOM'd UTF-16s, then GB18030.
 */
function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}
