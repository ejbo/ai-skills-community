// Read-side query helpers for the video board. The future unified homepage
// composes latestVideos() alongside the skills query in app/page.tsx — no joins.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { CommentSort, VideoSort } from './types';

// ── Card shape (feed grids + rails) ──────────────────────────────────────────
export const VIDEO_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  posterUrl: true,
  videoUrl: true,
  durationSec: true,
  width: true,
  height: true,
  viewCount: true,
  likeCount: true,
  commentCount: true,
  publishedAt: true,
  createdAt: true,
  featured: true,
  intervieweeName: true,
  intervieweeTitle: true,
  uploader: { select: { handle: true, displayName: true, avatarUrl: true } },
  category: { select: { slug: true, name: true } },
} satisfies Prisma.VideoSelect;

export type VideoCard = Prisma.VideoGetPayload<{ select: typeof VIDEO_CARD_SELECT }>;

export const VIDEO_DETAIL_INCLUDE = {
  uploader: { select: { handle: true, displayName: true, avatarUrl: true } },
  guestUser: { select: { handle: true, displayName: true, avatarUrl: true } },
  category: { select: { slug: true, name: true } },
  tags: { include: { tag: { select: { slug: true, name: true } } } },
} satisfies Prisma.VideoInclude;

export type VideoDetail = Prisma.VideoGetPayload<{ include: typeof VIDEO_DETAIL_INCLUDE }>;

const PUBLISHED_PUBLIC = {
  status: 'published',
  visibility: 'public',
  deletedAt: null,
} satisfies Prisma.VideoWhereInput;

function orderForSort(sort: VideoSort): Prisma.VideoOrderByWithRelationInput {
  if (sort === 'trending') return { trendingScore: 'desc' };
  if (sort === 'popular') return { viewCount: 'desc' };
  return { publishedAt: 'desc' };
}

// ── Browse / search (feed page) ──────────────────────────────────────────────
export interface BrowseParams {
  q?: string;
  categorySlug?: string;
  sort?: VideoSort;
  page?: number;
  pageSize?: number;
}

export async function browseVideos(params: BrowseParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, params.pageSize ?? 24));
  const q = params.q?.trim();

  const where: Prisma.VideoWhereInput = {
    ...PUBLISHED_PUBLIC,
    ...(params.categorySlug ? { category: { slug: params.categorySlug } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { descriptionMd: { contains: q, mode: 'insensitive' } },
            { intervieweeName: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [videos, total] = await Promise.all([
    prisma.video.findMany({
      where,
      select: VIDEO_CARD_SELECT,
      orderBy: orderForSort(params.sort ?? 'latest'),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.video.count({ where }),
  ]);

  return { videos, total, page, pageSize, hasMore: page * pageSize < total };
}

// ── Rails ────────────────────────────────────────────────────────────────────
export function latestVideos(take = 14): Promise<VideoCard[]> {
  return prisma.video.findMany({
    where: PUBLISHED_PUBLIC,
    select: VIDEO_CARD_SELECT,
    orderBy: { publishedAt: 'desc' },
    take,
  });
}

export function trendingVideos(take = 14): Promise<VideoCard[]> {
  return prisma.video.findMany({
    where: PUBLISHED_PUBLIC,
    select: VIDEO_CARD_SELECT,
    orderBy: [{ trendingScore: 'desc' }, { viewCount: 'desc' }],
    take,
  });
}

export function featuredVideos(take = 8): Promise<VideoCard[]> {
  return prisma.video.findMany({
    where: { ...PUBLISHED_PUBLIC, featured: true },
    select: VIDEO_CARD_SELECT,
    orderBy: [{ featuredAt: 'desc' }, { publishedAt: 'desc' }],
    take,
  });
}

export async function favoriteVideos(userId: string, take = 14): Promise<VideoCard[]> {
  const rows = await prisma.videoFavorite.findMany({
    where: { userId, video: PUBLISHED_PUBLIC },
    orderBy: { createdAt: 'desc' },
    take,
    select: { video: { select: VIDEO_CARD_SELECT } },
  });
  return rows.map((r) => r.video);
}

export async function relatedVideos(videoId: string, categoryId: string | null, take = 12): Promise<VideoCard[]> {
  return prisma.video.findMany({
    where: {
      ...PUBLISHED_PUBLIC,
      id: { not: videoId },
      ...(categoryId ? { categoryId } : {}),
    },
    select: VIDEO_CARD_SELECT,
    orderBy: { publishedAt: 'desc' },
    take,
  });
}

export function listVideoCategories() {
  return prisma.videoCategory.findMany({ orderBy: { sortOrder: 'asc' } });
}

// ── Home feed (Netflix/YouTube-style hero + rails) ──────────────────────────
export interface HomeFeed {
  hero: VideoCard[];
  rails: { key: string; title: string; href?: string; videos: VideoCard[] }[];
}

export async function getHomeFeed(actorId: string | null): Promise<HomeFeed> {
  const categories = await prisma.videoCategory.findMany({ orderBy: { sortOrder: 'asc' }, take: 6 });

  const [hero, latest, trending, favorites, ...categoryRails] = await Promise.all([
    featuredVideos(8),
    latestVideos(16),
    trendingVideos(16),
    actorId ? favoriteVideos(actorId, 16) : Promise.resolve<VideoCard[]>([]),
    ...categories.map((c) =>
      prisma.video.findMany({
        where: { ...PUBLISHED_PUBLIC, categoryId: c.id },
        select: VIDEO_CARD_SELECT,
        orderBy: { publishedAt: 'desc' },
        take: 16,
      }),
    ),
  ]);

  const rails: HomeFeed['rails'] = [];
  if (trending.length) rails.push({ key: 'trending', title: '热门', videos: trending });
  if (latest.length) rails.push({ key: 'latest', title: '最新', href: '/videos?sort=latest', videos: latest });
  if (favorites.length) rails.push({ key: 'favorites', title: '稍后看', videos: favorites });
  categories.forEach((c, i) => {
    const vids = categoryRails[i];
    if (vids && vids.length) rails.push({ key: `cat:${c.slug}`, title: c.name, href: `/videos?category=${c.slug}`, videos: vids });
  });

  // Fallback hero: if nothing is featured, headline with the latest videos.
  return { hero: hero.length ? hero : latest.slice(0, 5), rails };
}

// ── Detail ───────────────────────────────────────────────────────────────────
export function getVideoBySlug(slug: string): Promise<VideoDetail | null> {
  return prisma.video.findUnique({ where: { slug }, include: VIDEO_DETAIL_INCLUDE });
}

// ── Comments ─────────────────────────────────────────────────────────────────
const COMMENT_SELECT = {
  id: true,
  bodyMd: true,
  status: true,
  parentId: true,
  likeCount: true,
  replyCount: true,
  pinned: true,
  editedAt: true,
  createdAt: true,
  author: { select: { handle: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.VideoCommentSelect;

export type VideoCommentView = Prisma.VideoCommentGetPayload<{ select: typeof COMMENT_SELECT }> & {
  likedByMe: boolean;
};

function commentOrder(sort: CommentSort): Prisma.VideoCommentOrderByWithRelationInput[] {
  return sort === 'newest'
    ? [{ createdAt: 'desc' }]
    : [{ pinned: 'desc' }, { likeCount: 'desc' }, { createdAt: 'desc' }];
}

async function annotateLikes(
  rows: Prisma.VideoCommentGetPayload<{ select: typeof COMMENT_SELECT }>[],
  actorId: string | null,
): Promise<VideoCommentView[]> {
  if (!actorId || rows.length === 0) return rows.map((r) => ({ ...r, likedByMe: false }));
  const liked = await prisma.videoCommentLike.findMany({
    where: { userId: actorId, commentId: { in: rows.map((r) => r.id) } },
    select: { commentId: true },
  });
  const set = new Set(liked.map((l) => l.commentId));
  return rows.map((r) => ({ ...r, likedByMe: set.has(r.id) }));
}

export interface TopCommentsParams {
  videoId: string;
  sort?: CommentSort;
  cursor?: string | null;
  take?: number;
  actorId?: string | null;
}

export async function listTopComments(params: TopCommentsParams) {
  const take = Math.min(50, Math.max(1, params.take ?? 20));
  const rows = await prisma.videoComment.findMany({
    where: { videoId: params.videoId, parentId: null, status: { not: 'hidden' } },
    select: COMMENT_SELECT,
    orderBy: commentOrder(params.sort ?? 'top'),
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    comments: await annotateLikes(page, params.actorId ?? null),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function listReplies(parentId: string, actorId: string | null) {
  const rows = await prisma.videoComment.findMany({
    where: { parentId, status: { not: 'hidden' } },
    select: COMMENT_SELECT,
    orderBy: [{ createdAt: 'asc' }],
  });
  return annotateLikes(rows, actorId);
}
