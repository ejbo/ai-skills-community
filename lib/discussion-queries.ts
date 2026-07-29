import { Prisma, DiscussionCategory } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT } from '@/lib/user-identity';

// Shared query layer for the 讨论区 (Discussion) section: the LinkedIn/HF-style
// post feed and the Discourse-style forum. Same conventions as
// lib/feedback-queries.ts — clamped pagination, viewer-flag annotation via one
// IN-query, hard render caps on unpaginated thread loads.

// Includes department/lab/isPrivate — consumers MUST trim via toPublicAuthor().
const AUTHOR_SELECT = AUTHOR_IDENTITY_SELECT;

const MEDIA_SELECT = {
  orderBy: { sortOrder: 'asc' as const },
  select: {
    id: true,
    kind: true,
    url: true,
    posterUrl: true,
    name: true,
    mimeType: true,
    sizeBytes: true,
    width: true,
    height: true,
    sortOrder: true,
  },
};

const POST_SELECT = {
  id: true,
  bodyMd: true,
  pinned: true,
  likeCount: true,
  commentCount: true,
  editedAt: true,
  createdAt: true,
  author: AUTHOR_SELECT,
  media: MEDIA_SELECT,
};

// ─── Feed posts ─────────────────────────────────────────────────────────────

export interface ListPostsOptions {
  /** Opaque cursor from a previous page's `nextCursor` (encodes createdAt|id). */
  cursor?: string | null;
  limit?: number;
  /** When set, each row gets `likedByMe` for this user. */
  viewerId?: string | null;
}

/** How many pinned posts the feed's first page can carry (enforced on pin). */
export const MAX_PINNED_POSTS = 5;

// The cursor encodes the last row's FULL sort key (createdAt|id) so paging is
// an explicit keyset WHERE — robust to the cursor post being deleted, pinned
// or unpinned between pages (Prisma's `cursor` silently breaks in all three).
function encodePostCursor(p: { createdAt: Date; id: string }): string {
  return `${p.createdAt.toISOString()}|${p.id}`;
}

function decodePostCursor(raw: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const sep = raw.indexOf('|');
  if (sep <= 0) return null;
  const createdAt = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

/**
 * Feed pagination: the first page shows all pinned posts (capped) followed by
 * the newest regular posts; subsequent pages continue the regular stream from
 * the keyset cursor. Ordering includes `id` so `createdAt` ties page stably.
 */
export async function listPosts(opts: ListPostsOptions) {
  const rawLimit = Number(opts.limit ?? 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.trunc(rawLimit))) : 10;
  const cursor = decodePostCursor(opts.cursor);

  const pinned = cursor
    ? []
    : await prisma.post.findMany({
        where: { pinned: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_PINNED_POSTS,
        select: POST_SELECT,
      });

  const rows = await prisma.post.findMany({
    where: {
      pinned: false,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: POST_SELECT,
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const all = [...pinned, ...page];

  const liked = await viewerPostLikeSet(
    opts.viewerId,
    all.map((p) => p.id),
  );
  const items = all.map((p) => ({ ...p, likedByMe: liked.has(p.id) }));

  return {
    items,
    hasMore,
    nextCursor: hasMore && page.length > 0 ? encodePostCursor(page[page.length - 1]) : null,
  };
}

export async function getPostDetail(id: string, viewerId?: string | null) {
  const post = await prisma.post.findUnique({
    where: { id },
    select: { ...POST_SELECT, authorId: true },
  });
  if (!post) return null;
  const liked = await viewerPostLikeSet(viewerId, [post.id]);
  return { ...post, likedByMe: liked.has(post.id) };
}

async function viewerPostLikeSet(viewerId: string | null | undefined, postIds: string[]) {
  if (!viewerId || postIds.length === 0) return new Set<string>();
  const rows = await prisma.postLike.findMany({
    where: { userId: viewerId, postId: { in: postIds } },
    select: { postId: true },
  });
  return new Set(rows.map((r) => r.postId));
}

// ─── Post comments ──────────────────────────────────────────────────────────

export type PostCommentSort = 'relevant' | 'recent';

const COMMENT_SELECT = {
  id: true,
  bodyMd: true,
  status: true,
  parentId: true,
  likeCount: true,
  replyCount: true,
  createdAt: true,
  author: AUTHOR_SELECT,
};

/** How many replies each thread preview carries; the rest load on demand. */
export const REPLY_PREVIEW_COUNT = 2;

/**
 * Paginated top-level comment threads for a post. `relevant` approximates the
 * LinkedIn "Most relevant" ordering with engagement counters (likes, then
 * replies), `recent` is pure recency. Offset pagination on purpose — the
 * relevant ordering shifts as people like, so a keyset cursor buys nothing.
 */
export async function listPostComments(
  postId: string,
  opts: { sort?: PostCommentSort; skip?: number; take?: number; viewerId?: string | null } = {},
) {
  const rawSkip = Number(opts.skip ?? 0);
  const skip = Number.isFinite(rawSkip) ? Math.max(0, Math.trunc(rawSkip)) : 0;
  const rawTake = Number(opts.take ?? 3);
  const take = Number.isFinite(rawTake) ? Math.min(20, Math.max(1, Math.trunc(rawTake))) : 3;

  const orderBy: Prisma.PostCommentOrderByWithRelationInput[] =
    opts.sort === 'recent'
      ? [{ createdAt: 'desc' }, { id: 'desc' }]
      : [{ likeCount: 'desc' }, { replyCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];

  const where = { postId, parentId: null };
  const [totalRoots, rows] = await Promise.all([
    prisma.postComment.count({ where }),
    prisma.postComment.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
        ...COMMENT_SELECT,
        replies: {
          orderBy: { createdAt: 'asc' as const },
          take: REPLY_PREVIEW_COUNT,
          select: COMMENT_SELECT,
        },
      },
    }),
  ]);

  const ids = rows.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]);
  const liked = await viewerCommentLikeSet(opts.viewerId, ids);
  const items = rows.map((c) => ({
    ...c,
    likedByMe: liked.has(c.id),
    replies: c.replies.map((r) => ({ ...r, likedByMe: liked.has(r.id) })),
  }));

  return { items, totalRoots, hasMore: skip + rows.length < totalRoots };
}

/** Full reply list of one thread (loaded when "展开其余 N 条回复" is clicked). */
export async function listPostCommentReplies(commentId: string, viewerId?: string | null) {
  const rows = await prisma.postComment.findMany({
    where: { parentId: commentId },
    orderBy: { createdAt: 'asc' },
    // Hard render cap — a stuffed thread must not unbound the response.
    take: 200,
    select: COMMENT_SELECT,
  });
  const liked = await viewerCommentLikeSet(
    viewerId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, likedByMe: liked.has(r.id) }));
}

/** One comment as a thread root incl. reply preview (deep-link resolution). */
export async function getPostCommentThread(commentId: string, viewerId?: string | null) {
  const row = await prisma.postComment.findUnique({
    where: { id: commentId },
    select: {
      ...COMMENT_SELECT,
      postId: true,
      replies: {
        orderBy: { createdAt: 'asc' as const },
        take: REPLY_PREVIEW_COUNT,
        select: COMMENT_SELECT,
      },
    },
  });
  if (!row) return null;
  const liked = await viewerCommentLikeSet(viewerId, [row.id, ...row.replies.map((r) => r.id)]);
  return {
    ...row,
    likedByMe: liked.has(row.id),
    replies: row.replies.map((r) => ({ ...r, likedByMe: liked.has(r.id) })),
  };
}

async function viewerCommentLikeSet(viewerId: string | null | undefined, commentIds: string[]) {
  if (!viewerId || commentIds.length === 0) return new Set<string>();
  const rows = await prisma.postCommentLike.findMany({
    where: { userId: viewerId, commentId: { in: commentIds } },
    select: { commentId: true },
  });
  return new Set(rows.map((r) => r.commentId));
}

// ─── Forum topics ───────────────────────────────────────────────────────────

export const DISCUSSION_CATEGORIES = ['tech', 'qa', 'share', 'showcase', 'general'] as const;

export function isDiscussionCategory(v: unknown): v is DiscussionCategory {
  return typeof v === 'string' && (DISCUSSION_CATEGORIES as readonly string[]).includes(v);
}

export type TopicSort = 'latest' | 'top' | 'new';

export interface ListTopicsFilters {
  category?: DiscussionCategory;
  sort?: TopicSort;
  page?: number;
  pageSize?: number;
  /** When set, each row gets `upvotedByMe` for this user. */
  viewerId?: string | null;
}

export async function listTopics(filters: ListTopicsFilters) {
  const rawPage = Number(filters.page ?? 1);
  const requested = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
  const rawSize = Number(filters.pageSize ?? 20);
  const pageSize = Number.isFinite(rawSize) ? Math.min(50, Math.max(1, Math.trunc(rawSize))) : 20;

  const where: Prisma.DiscussionTopicWhereInput = {};
  if (filters.category) where.category = filters.category;

  // Pinned topics always float to the top (Discourse behavior); the sort only
  // decides the order of the regular stream below them.
  const orderBy: Prisma.DiscussionTopicOrderByWithRelationInput[] =
    filters.sort === 'top'
      ? [{ pinned: 'desc' }, { upvoteCount: 'desc' }, { lastActivityAt: 'desc' }]
      : filters.sort === 'new'
        ? [{ pinned: 'desc' }, { createdAt: 'desc' }]
        : [{ pinned: 'desc' }, { lastActivityAt: 'desc' }];

  const total = await prisma.discussionTopic.count({ where });
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));

  const rows = await prisma.discussionTopic.findMany({
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      title: true,
      category: true,
      pinned: true,
      locked: true,
      upvoteCount: true,
      replyCount: true,
      lastActivityAt: true,
      createdAt: true,
      author: AUTHOR_SELECT,
    },
  });

  const upvoted = await viewerUpvoteSet(
    filters.viewerId,
    rows.map((r) => r.id),
  );
  const items = rows.map((r) => ({ ...r, upvotedByMe: upvoted.has(r.id) }));

  return { items, page, pageSize, total, hasMore: page * pageSize < total };
}

/**
 * Full topic detail: the post plus ALL replies as 2-level threads. Forum
 * volume is low, so there is deliberately no pagination — one query, one
 * render, and `?focus=` highlighting is a simple scrollIntoView.
 */
export async function getTopicDetail(id: string, viewerId?: string | null) {
  const topic = await prisma.discussionTopic.findUnique({
    where: { id },
    include: {
      author: AUTHOR_SELECT,
      replies: {
        where: { parentId: null },
        orderBy: { createdAt: 'asc' },
        // Hard render caps — a stuffed thread must not unbound the RSC render.
        take: 300,
        select: {
          id: true,
          bodyMd: true,
          status: true,
          replyCount: true,
          createdAt: true,
          author: AUTHOR_SELECT,
          replies: {
            orderBy: { createdAt: 'asc' as const },
            take: 100,
            select: {
              id: true,
              bodyMd: true,
              status: true,
              replyCount: true,
              createdAt: true,
              author: AUTHOR_SELECT,
            },
          },
        },
      },
    },
  });
  if (!topic) return null;

  const upvoted = await viewerUpvoteSet(viewerId, [topic.id]);
  return { ...topic, upvotedByMe: upvoted.has(topic.id) };
}

async function viewerUpvoteSet(viewerId: string | null | undefined, topicIds: string[]) {
  if (!viewerId || topicIds.length === 0) return new Set<string>();
  const rows = await prisma.discussionUpvote.findMany({
    where: { userId: viewerId, topicId: { in: topicIds } },
    select: { topicId: true },
  });
  return new Set(rows.map((r) => r.topicId));
}
