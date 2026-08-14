// 随刷短视频 (Shorts) — read-side query helpers. Shorts are Video rows with
// isShort: true; they reuse the board's likes/favorites/comments/views models
// but have their own vertical feed and are excluded from long-video surfaces
// (lib/video/queries.ts PUBLISHED_PUBLIC filters isShort: false).

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import {
  type ShortsSort,
  decodeShortsCursor,
  encodeShortsCursor,
} from './shorts-shared';

export const SHORT_FEED_SELECT = {
  id: true,
  slug: true,
  title: true,
  summary: true, // the caption
  videoUrl: true,
  posterUrl: true,
  mimeType: true,
  width: true,
  height: true,
  durationSec: true,
  viewCount: true,
  likeCount: true,
  commentCount: true,
  favoriteCount: true,
  featured: true,
  publishedAt: true,
  createdAt: true,
  uploaderId: true,
  subtitleStatus: true,
  subtitleZhUrl: true,
  subtitleEnUrl: true,
  originType: true,
  sourceUrl: true,
  sourceAuthor: true,
  uploader: AUTHOR_IDENTITY_SELECT,
} satisfies Prisma.VideoSelect;

export type ShortRow = Prisma.VideoGetPayload<{ select: typeof SHORT_FEED_SELECT }>;
/** Feed row + per-viewer flags (annotated in 2 batched queries, never per-row). */
export type ShortFeedRow = ShortRow & { likedByMe: boolean; favoritedByMe: boolean };

const SHORTS_PUBLIC = {
  isShort: true,
  status: 'published',
  visibility: 'public',
  deletedAt: null,
} satisfies Prisma.VideoWhereInput;

/** Batch per-viewer flags (2 IN-queries over the whole page, never per-row). */
export async function annotateShortsViewer(
  rows: ShortRow[],
  viewerId: string | null,
): Promise<ShortFeedRow[]> {
  if (!viewerId || rows.length === 0) {
    return rows.map((r) => ({ ...r, likedByMe: false, favoritedByMe: false }));
  }
  const ids = rows.map((r) => r.id);
  const [likes, favs] = await Promise.all([
    prisma.videoLike.findMany({
      where: { userId: viewerId, videoId: { in: ids } },
      select: { videoId: true },
    }),
    prisma.videoFavorite.findMany({
      where: { userId: viewerId, videoId: { in: ids } },
      select: { videoId: true },
    }),
  ]);
  const liked = new Set(likes.map((l) => l.videoId));
  const faved = new Set(favs.map((f) => f.videoId));
  return rows.map((r) => ({ ...r, likedByMe: liked.has(r.id), favoritedByMe: faved.has(r.id) }));
}

/**
 * Server-boundary mapper: annotated row → the exact client payload the player
 * components consume (ISO dates, toPublicAuthor identity trim, no uploaderId).
 * Every RSC that mounts ShortsCell/ShortsShowcase must go through this.
 */
export function toShortView(s: ShortFeedRow, viewerIsAdmin: boolean) {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    videoUrl: s.videoUrl,
    posterUrl: s.posterUrl,
    mimeType: s.mimeType,
    width: s.width,
    height: s.height,
    durationSec: s.durationSec,
    viewCount: s.viewCount,
    likeCount: s.likeCount,
    commentCount: s.commentCount,
    favoriteCount: s.favoriteCount,
    featured: s.featured,
    publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
    subtitleStatus: s.subtitleStatus,
    subtitleZhUrl: s.subtitleZhUrl,
    subtitleEnUrl: s.subtitleEnUrl,
    originType: s.originType,
    sourceUrl: s.sourceUrl,
    sourceAuthor: s.sourceAuthor,
    uploader: toPublicAuthor(s.uploader, viewerIsAdmin),
    likedByMe: s.likedByMe,
    favoritedByMe: s.favoritedByMe,
  };
}

export interface ListShortsOptions {
  sort?: ShortsSort;
  cursor?: string | null;
  limit?: number;
  viewerId?: string | null;
  /** Filter to one uploader (TA 的作品 panel). */
  uploaderId?: string | null;
}

export async function listShorts(opts: ListShortsOptions) {
  const rawLimit = Number(opts.limit ?? 8);
  const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.trunc(rawLimit))) : 8;
  const sort: ShortsSort = opts.sort === 'new' ? 'new' : 'hot';

  const cursor = sort === 'new' ? decodeShortsCursor(opts.cursor) : null;
  const rawOffset =
    sort === 'hot' && opts.cursor?.startsWith('o:') ? Number(opts.cursor.slice(2)) : 0;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  const orderBy: Prisma.VideoOrderByWithRelationInput[] =
    sort === 'hot'
      ? [{ likeCount: 'desc' }, { viewCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

  const rows = await prisma.video.findMany({
    where: {
      ...SHORTS_PUBLIC,
      ...(opts.uploaderId ? { uploaderId: opts.uploaderId } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy,
    ...(sort === 'hot' ? { skip: offset } : {}),
    take: limit + 1,
    select: SHORT_FEED_SELECT,
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    items: await annotateShortsViewer(page, opts.viewerId ?? null),
    hasMore,
    nextCursor:
      hasMore && page.length > 0
        ? sort === 'hot'
          ? `o:${offset + limit}`
          : encodeShortsCursor(page[page.length - 1])
        : null,
  };
}

/** One playable short by id (deep link ?v=), annotated for the viewer. */
export async function getShortForFeed(
  id: string,
  viewerId: string | null,
): Promise<ShortFeedRow | null> {
  const row = await prisma.video.findFirst({
    where: { id, ...SHORTS_PUBLIC },
    select: SHORT_FEED_SELECT,
  });
  if (!row) return null;
  const [annotated] = await annotateShortsViewer([row], viewerId);
  return annotated;
}

/**
 * Strip for the homepage / /videos: admin-featured shorts first (featuredAt
 * desc), backfilled with the hottest recent shorts up to `take`.
 */
export async function featuredShorts(take = 8): Promise<ShortRow[]> {
  const featured = await prisma.video.findMany({
    where: { ...SHORTS_PUBLIC, featured: true },
    select: SHORT_FEED_SELECT,
    orderBy: [{ featuredAt: 'desc' }, { publishedAt: 'desc' }],
    take,
  });
  if (featured.length >= take) return featured;
  const backfill = await prisma.video.findMany({
    where: { ...SHORTS_PUBLIC, featured: false },
    select: SHORT_FEED_SELECT,
    orderBy: [{ likeCount: 'desc' }, { viewCount: 'desc' }, { createdAt: 'desc' }],
    take: take - featured.length,
  });
  return [...featured, ...backfill];
}

/**
 * Count one view per viewer per short per UTC day (the VideoView sessionHash
 * dedupe the model was built for). Array transaction: a duplicate insert rolls
 * the increment back with it. Best-effort — never throws.
 */
export async function recordShortView(videoId: string, viewerId: string): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const sessionHash = createHash('sha256').update(`${viewerId}:${videoId}:${day}`).digest('hex');
    await prisma.$transaction([
      prisma.videoView.create({ data: { videoId, userId: viewerId, sessionHash } }),
      prisma.video.update({ where: { id: videoId }, data: { viewCount: { increment: 1 } } }),
    ]);
  } catch {
    /* already viewed today, or short deleted — fine */
  }
}
