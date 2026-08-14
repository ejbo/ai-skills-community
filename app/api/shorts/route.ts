import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { toPublicAuthor } from '@/lib/user-identity';
import { uniqueVideoSlug } from '@/lib/video/slug';
import { probeVideoDurationSec, statVideoFileAsync, videoPublicUrl } from '@/lib/video/storage';
import { generateShortSubtitles } from '@/lib/video/subtitles';
import { listShorts, SHORT_FEED_SELECT } from '@/lib/video/shorts-queries';
import {
  MAX_SHORT_CAPTION_CHARS,
  isValidShortPosterKey,
  isValidShortSourceKey,
  parseShortsSort,
  shortTitleFromCaption,
} from '@/lib/video/shorts-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/shorts?cursor=&limit=&sort= (login) — feed pages for the swipe UI.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  // ?uploader=<handle> — TA 的作品 panel (resolved to an id server-side).
  const uploaderHandle = sp.get('uploader')?.trim();
  let uploaderId: string | null = null;
  if (uploaderHandle) {
    const uploader = await prisma.user.findUnique({
      where: { handle: uploaderHandle },
      select: { id: true },
    });
    if (!uploader) return NextResponse.json({ items: [], hasMore: false, nextCursor: null });
    uploaderId = uploader.id;
  }
  const { items, hasMore, nextCursor } = await listShorts({
    cursor: sp.get('cursor'),
    limit: Number(sp.get('limit') ?? 8),
    sort: parseShortsSort(sp.get('sort')),
    viewerId: session.user.id,
    uploaderId,
  });
  const adm = Boolean(session.user.isAdmin);
  return NextResponse.json({
    items: items.map((s) => ({ ...s, uploader: toPublicAuthor(s.uploader, adm) })),
    hasMore,
    nextCursor,
  });
}

const createSchema = z.object({
  caption: z.string().trim().min(1).max(MAX_SHORT_CAPTION_CHARS),
  videoKey: z.string().min(1).max(200),
  posterKey: z.string().min(1).max(200).optional(),
  durationSec: z.number().int().min(1).max(24 * 60 * 60),
  width: z.number().int().min(1).max(8192).optional(),
  height: z.number().int().min(1).max(8192).optional(),
  originType: z.enum(['original', 'repost']).default('original'),
  sourceUrl: z.string().trim().url().max(500).optional(),
  sourceAuthor: z.string().trim().min(1).max(100).optional(),
});

// POST /api/shorts (any logged-in user) — publish an uploaded short.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', reason: await apiReason('invalid_request') },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // Re-validate the echoed storage keys: shape first (a crafted key must never
  // point a row at an arbitrary path)…
  if (!isValidShortSourceKey(d.videoKey) || (d.posterKey && !isValidShortPosterKey(d.posterKey))) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  // …then on-disk existence (sizeBytes comes from the stat — never the client)…
  const [videoStat, posterStat] = await Promise.all([
    statVideoFileAsync(d.videoKey),
    d.posterKey ? statVideoFileAsync(d.posterKey) : Promise.resolve(null),
  ]);
  if (!videoStat || videoStat.size === 0 || (d.posterKey && !posterStat)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  // …then reuse: keys are readable from any served URL and there is no per-key
  // ownership ledger, so reject keys already attached to another Video row
  // (closes the attach-someone-else's-file hole; same idea as mediaKeysAvailable).
  const keys = [d.videoKey, ...(d.posterKey ? [d.posterKey] : [])];
  const inUse = await prisma.video.count({
    where: {
      OR: [
        { videoKey: { in: keys } },
        { posterKey: { in: keys } },
        { previewKey: { in: keys } },
      ],
    },
  });
  if (inUse > 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // NO duration limit (product decision) — ffprobe only CORRECTS the metadata
  // so the feed shows the real duration (client-probed value is the fallback).
  const probed = await probeVideoDurationSec(d.videoKey);
  const durationSec = probed !== null ? Math.max(1, Math.round(probed)) : d.durationSec;

  // 搬运 must credit the original: link + author are mandatory.
  if (d.originType === 'repost' && (!d.sourceUrl || !d.sourceAuthor)) {
    return NextResponse.json(
      { error: 'source_required', reason: await apiReason('short_source_required') },
      { status: 400 },
    );
  }

  const title = shortTitleFromCaption(d.caption);
  const slug = await uniqueVideoSlug(title);

  const short = await prisma.video.create({
    data: {
      slug,
      title,
      summary: d.caption,
      isShort: true,
      sourceType: 'user_uploaded',
      status: 'published',
      visibility: 'public',
      publishedAt: new Date(),
      uploaderId: session.user.id,
      videoKey: d.videoKey,
      videoUrl: videoPublicUrl(d.videoKey),
      posterKey: d.posterKey ?? null,
      posterUrl: d.posterKey ? videoPublicUrl(d.posterKey) : null,
      mimeType: videoStat.contentType,
      // Video.sizeBytes is Int (int32) — with no upload cap a huge file must
      // clamp instead of overflowing the column (display-only value).
      sizeBytes: Math.min(videoStat.size, 2_147_483_647),
      width: d.width ?? null,
      height: d.height ?? null,
      durationSec,
      originType: d.originType,
      sourceUrl: d.originType === 'repost' ? d.sourceUrl : null,
      sourceAuthor: d.originType === 'repost' ? d.sourceAuthor : null,
    },
    select: SHORT_FEED_SELECT,
  });

  // 字幕: whisper ASR + LLM translation in the background — best-effort, takes
  // a while on CPU; the tracks appear on the row when ready.
  void generateShortSubtitles(short.id);

  return NextResponse.json({
    ok: true,
    short: {
      ...short,
      uploader: toPublicAuthor(short.uploader, Boolean(session.user.isAdmin)),
      likedByMe: false,
      favoritedByMe: false,
    },
  });
}
