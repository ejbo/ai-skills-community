import { createHash } from 'node:crypto';
import { Prisma, PostReaction } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_FIELDS, AUTHOR_IDENTITY_SELECT } from '@/lib/user-identity';
import { markdownToPlainText } from '@/lib/markdown-text';
import {
  RETIRED_TAG_SLUGS,
  normalizeTagName,
  slugifyDiscussionTag,
  isValidTagName,
  type DiscussionTagOption,
} from '@/lib/discussion-tags';

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

export type PostSort = 'new' | 'hot';

export interface ListPostsOptions {
  /**
   * Opaque cursor from a previous page's `nextCursor`. For `new` it encodes
   * the keyset `createdAt|id`; for `hot` (whose ordering shifts as people
   * react) it is a plain offset `o:<n>`.
   */
  cursor?: string | null;
  limit?: number;
  sort?: PostSort;
  /** When set, each row gets `myReaction` for this user. */
  viewerId?: string | null;
  /** Tab 内搜索：按正文匹配；置顶不再前置（搜索结果按时间排）。 */
  q?: string;
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
 * the regular stream. `new` pages with the keyset cursor (ordering includes
 * `id` so `createdAt` ties page stably); `hot` (engagement ordering, shifts
 * as people react) pages with a plain offset instead.
 */
export async function listPosts(opts: ListPostsOptions) {
  const rawLimit = Number(opts.limit ?? 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.trunc(rawLimit))) : 10;
  const sort: PostSort = opts.sort === 'hot' ? 'hot' : 'new';
  const q = (opts.q ?? '').trim();

  const cursor = sort === 'new' ? decodePostCursor(opts.cursor) : null;
  const rawOffset =
    sort === 'hot' && opts.cursor?.startsWith('o:') ? Number(opts.cursor.slice(2)) : 0;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
  const firstPage = sort === 'new' ? !cursor : offset === 0;

  const pinned =
    !firstPage || q
      ? []
      : await prisma.post.findMany({
          where: { pinned: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_PINNED_POSTS,
          select: POST_SELECT,
        });

  const orderBy: Prisma.PostOrderByWithRelationInput[] =
    sort === 'hot'
      ? [{ likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

  const rows = await prisma.post.findMany({
    where: {
      // 搜索时不区分置顶（否则置顶命中项会在关键字翻页时重复出现）。
      ...(q ? { bodyMd: { contains: q, mode: 'insensitive' } } : { pinned: false }),
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
    select: POST_SELECT,
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const all = [...pinned, ...page];

  const annotated = await attachCommentPreviews(
    await annotateReactions(all, opts.viewerId),
    opts.viewerId,
  );

  return {
    items: annotated,
    hasMore,
    nextCursor:
      hasMore && page.length > 0
        ? sort === 'hot'
          ? `o:${offset + limit}`
          : encodePostCursor(page[page.length - 1])
        : null,
  };
}

export async function getPostDetail(id: string, viewerId?: string | null) {
  const post = await prisma.post.findUnique({
    where: { id },
    select: { ...POST_SELECT, authorId: true },
  });
  if (!post) return null;
  const [annotated] = await annotateReactions([post], viewerId);
  return annotated;
}

// ─── 动态 + 讨论 merged stream ───────────────────────────────────────────────

/**
 * The 全部 tab: feed posts and forum topics in ONE reverse-chronological
 * stream, so a visitor sees both without switching tabs.
 *
 * Both tables are paged by the same keyset `createdAt|id` (the posts cursor
 * format). Each side reads `limit + 1` rows past the cursor and the two are
 * merged; if the merge holds more than `limit`, at least one row is left, and
 * if it does not, both sides are exhausted — so `hasMore` is exact without a
 * count. Ids are cuids from two tables, never equal, so `(createdAt, id)` is a
 * total order across the union and a tie can never skip or repeat a row.
 *
 * Pinned posts lead the first unfiltered page and are kept out of the stream
 * below, exactly like `listPosts`. Topics stay chronological: pinning a topic
 * is a forum-list concept, and the card still wears the pin badge.
 */
export async function listDiscussionStream(opts: {
  cursor?: string | null;
  limit?: number;
  viewerId?: string | null;
  q?: string;
}) {
  const rawLimit = Number(opts.limit ?? 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.trunc(rawLimit))) : 10;
  const q = (opts.q ?? '').trim();
  const cursor = decodePostCursor(opts.cursor);
  const keyset = cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }
    : {};

  const [pinned, postRows, topicRows] = await Promise.all([
    cursor || q
      ? Promise.resolve([])
      : prisma.post.findMany({
          where: { pinned: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_PINNED_POSTS,
          select: POST_SELECT,
        }),
    prisma.post.findMany({
      where: {
        ...(q ? { bodyMd: { contains: q, mode: 'insensitive' } } : { pinned: false }),
        ...keyset,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: POST_SELECT,
    }),
    prisma.discussionTopic.findMany({
      where: {
        ...(q
          ? {
              AND: [
                {
                  OR: [
                    { title: { contains: q, mode: 'insensitive' } },
                    { bodyMd: { contains: q, mode: 'insensitive' } },
                  ],
                },
                keyset,
              ],
            }
          : keyset),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: TOPIC_LIST_SELECT,
    }),
  ]);

  type Merged =
    | { kind: 'post'; createdAt: Date; id: string; row: (typeof postRows)[number] }
    | { kind: 'topic'; createdAt: Date; id: string; row: (typeof topicRows)[number] };
  const merged: Merged[] = [
    ...postRows.map((row) => ({ kind: 'post' as const, createdAt: row.createdAt, id: row.id, row })),
    ...topicRows.map((row) => ({ kind: 'topic' as const, createdAt: row.createdAt, id: row.id, row })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  const hasMore = merged.length > limit;
  const page = merged.slice(0, limit);

  const pagePosts = page.flatMap((m) => (m.kind === 'post' ? [m.row] : []));
  const pageTopics = page.flatMap((m) => (m.kind === 'topic' ? [m.row] : []));
  const [posts, topics] = await Promise.all([
    annotateReactions([...pinned, ...pagePosts], opts.viewerId).then((rows) =>
      attachCommentPreviews(rows, opts.viewerId),
    ),
    annotateTopicRows(pageTopics, opts.viewerId),
  ]);
  const postById = new Map(posts.map((p) => [p.id, p]));
  const topicById = new Map(topics.map((t) => [t.id, t]));

  type PostItem = (typeof posts)[number];
  type TopicItem = (typeof topics)[number];
  const items: ({ kind: 'post'; post: PostItem } | { kind: 'topic'; topic: TopicItem })[] = [
    ...pinned.map((p) => ({ kind: 'post' as const, post: postById.get(p.id)! })),
    ...page.map((m) =>
      m.kind === 'post'
        ? { kind: 'post' as const, post: postById.get(m.id)! }
        : { kind: 'topic' as const, topic: topicById.get(m.id)! },
    ),
  ];

  const last = page[page.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodePostCursor(last) : null,
  };
}

/**
 * The 热门讨论 rail: topics people are engaging with NOW. Ranked by upvotes,
 * then replies, among topics active in the last 30 days; a quiet forum is
 * back-filled from all time so the rail never renders half-empty. Pinned is
 * deliberately NOT a rank key here — 置顶 is a moderator's notice, not heat.
 */
export async function listHotTopics(limit = 5) {
  const select = {
    id: true,
    title: true,
    upvoteCount: true,
    replyCount: true,
    viewCount: true,
    lastActivityAt: true,
    author: AUTHOR_SELECT,
  } as const;
  const orderBy: Prisma.DiscussionTopicOrderByWithRelationInput[] = [
    { upvoteCount: 'desc' },
    { replyCount: 'desc' },
    { lastActivityAt: 'desc' },
  ];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = await prisma.discussionTopic.findMany({
    where: { lastActivityAt: { gte: since } },
    orderBy,
    take: limit,
    select,
  });
  if (recent.length >= limit) return recent;
  const backfill = await prisma.discussionTopic.findMany({
    where: { id: { notIn: recent.map((t) => t.id) } },
    orderBy,
    take: limit - recent.length,
    select,
  });
  return [...recent, ...backfill];
}

export interface ReactionCount {
  reaction: PostReaction;
  count: number;
}

/** Attach `myReaction` + per-type `reactions` summary to post rows (2 queries total). */
async function annotateReactions<T extends { id: string }>(
  posts: T[],
  viewerId?: string | null,
): Promise<(T & { myReaction: PostReaction | null; reactions: ReactionCount[] })[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);

  const [mine, grouped] = await Promise.all([
    viewerId
      ? prisma.postLike.findMany({
          where: { userId: viewerId, postId: { in: ids } },
          select: { postId: true, reaction: true },
        })
      : Promise.resolve([] as { postId: string; reaction: PostReaction }[]),
    prisma.postLike.groupBy({
      by: ['postId', 'reaction'],
      where: { postId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const myMap = new Map(mine.map((r) => [r.postId, r.reaction]));
  const summary = new Map<string, ReactionCount[]>();
  for (const g of grouped) {
    const list = summary.get(g.postId) ?? [];
    list.push({ reaction: g.reaction, count: g._count._all });
    summary.set(g.postId, list);
  }
  for (const list of summary.values()) list.sort((a, b) => b.count - a.count);

  return posts.map((p) => ({
    ...p,
    myReaction: myMap.get(p.id) ?? null,
    reactions: summary.get(p.id) ?? [],
  }));
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

/** How many comments a feed card shows before 查看全部评论. */
export const COMMENT_PREVIEW_COUNT = 2;

/**
 * Attach `previewComments` — the top visible root comments of each post, in
 * the comment section's own 最相关 order — so a feed card can show the
 * conversation without a request per card.
 *
 * ONE statement for the whole page, with the per-post budget enforced in SQL:
 * the LATERAL runs the per-post `LIMIT` once per id (Index Scan on
 * `PostComment_postId_likeCount_idx`), the same shape — and the same reasons —
 * as `topicParticipants` below. Tombstoned roots are skipped: a preview of
 * 「该评论已删除」 is noise. Posts with no comments never reach the query.
 */
async function attachCommentPreviews<T extends { id: string; commentCount: number }>(
  posts: T[],
  viewerId?: string | null,
) {
  type Preview = Prisma.PostCommentGetPayload<{ select: typeof COMMENT_SELECT }> & { likedByMe: boolean };
  const ids = posts.filter((p) => p.commentCount > 0).map((p) => p.id);
  if (ids.length === 0) return posts.map((p) => ({ ...p, previewComments: [] as Preview[] }));

  const picks = await prisma.$queryRaw<{ postId: string; id: string }[]>`
    SELECT c."postId", c."id"
    FROM unnest(${ids}::text[]) AS p(id)
    CROSS JOIN LATERAL (
      SELECT "postId", "id"
      FROM "PostComment"
      WHERE "postId" = p.id AND "parentId" IS NULL AND "status" = 'visible'
      ORDER BY "likeCount" DESC, "replyCount" DESC, "createdAt" DESC, "id" DESC
      LIMIT ${Prisma.raw(String(COMMENT_PREVIEW_COUNT))}
    ) c`;

  const byPost = new Map<string, Preview[]>();
  if (picks.length > 0) {
    const rows = await prisma.postComment.findMany({
      where: { id: { in: picks.map((p) => p.id) } },
      orderBy: [{ likeCount: 'desc' }, { replyCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { ...COMMENT_SELECT, postId: true },
    });
    const liked = await viewerCommentLikeSet(
      viewerId,
      rows.map((r) => r.id),
    );
    for (const { postId, ...row } of rows) {
      const list = byPost.get(postId) ?? [];
      list.push({ ...row, likedByMe: liked.has(row.id) });
      byPost.set(postId, list);
    }
  }
  return posts.map((p) => ({ ...p, previewComments: byPost.get(p.id) ?? [] }));
}

// ─── Forum topics ───────────────────────────────────────────────────────────

const TAG_SELECT = { slug: true, name: true, nameEn: true, official: true } as const;
const TAG_CACHE_MS = 30_000;

let tagCache: { at: number; rows: DiscussionTagOption[] } | null = null;

export function bustDiscussionTagCache(): void {
  tagCache = null;
}

/** 侧栏分类在前（按 sortOrder），然后是成员自建的（按名字）。 */
export async function listDiscussionTags(): Promise<DiscussionTagOption[]> {
  if (tagCache && Date.now() - tagCache.at < TAG_CACHE_MS) return tagCache.rows;
  const rows = await prisma.discussionTag.findMany({
    orderBy: [{ official: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    select: TAG_SELECT,
  });
  tagCache = { at: Date.now(), rows };
  return rows;
}

export async function discussionTagMap(): Promise<Map<string, DiscussionTagOption>> {
  return new Map((await listDiscussionTags()).map((t) => [t.slug, t]));
}

/** 侧栏那一组（发帖时必须至少选一个）。 */
export async function listOfficialDiscussionTags(): Promise<DiscussionTagOption[]> {
  return (await listDiscussionTags()).filter((t) => t.official);
}

/**
 * 自建分类的候选：给了 q 就按名字模糊搜，没给就返回用得最多的几个。
 * 选择器默认折叠，只有展开/输入时才会打到这里 —— 侧栏永远不会被它们挤爆。
 */
export async function searchCustomDiscussionTags(q: string, take = 8): Promise<DiscussionTagOption[]> {
  const term = q.trim().slice(0, 40);
  // 退役值（综合讨论）official=false，但它绝不是"可以挂到新帖上的自建分类" ——
  // 老帖还留在它上面、侧栏也还能筛，但选择器里不该再出现。
  const all = (await listDiscussionTags()).filter(
    (t) => !t.official && !RETIRED_TAG_SLUGS.has(t.slug),
  );
  if (all.length === 0) return [];
  if (term) {
    const lower = term.toLowerCase();
    return all
      .filter(
        (t) =>
          t.name.toLowerCase().includes(lower) ||
          t.nameEn.toLowerCase().includes(lower) ||
          t.slug.includes(lower),
      )
      .slice(0, take);
  }
  // 无搜索词：按被使用次数排序，counts 里没有的（刚建还没发帖）排在后面。
  const counts = await countTopicsByTag();
  return [...all]
    .sort((a, b) => (counts[b.slug] ?? 0) - (counts[a.slug] ?? 0) || a.name.localeCompare(b.name))
    .slice(0, take);
}

export type CreateDiscussionTagResult =
  | { ok: true; tag: DiscussionTagOption; created: boolean }
  | { ok: false; error: 'invalid_name' | 'create_failed' };

/**
 * 成员自建分类的 find-or-create。撞上已存在的名字（任一语言、忽略大小写）就
 * 复用那一个而不是造个近似重复的 —— 共享分类体系的意义就在这里；这也是为什么
 * 自建分类是全站可搜的。新建的一律 official=false：侧栏只有管理员能改。
 */
export async function findOrCreateDiscussionTag(
  rawName: string,
  createdById: string | null,
): Promise<CreateDiscussionTagResult> {
  const name = normalizeTagName(rawName);
  if (!isValidTagName(name)) return { ok: false, error: 'invalid_name' };

  const existing = await prisma.discussionTag.findFirst({
    where: {
      OR: [
        { name: { equals: name, mode: 'insensitive' } },
        { nameEn: { equals: name, mode: 'insensitive' } },
        { slug: name.toLowerCase() },
      ],
    },
    select: TAG_SELECT,
  });
  if (existing) return { ok: true, tag: existing, created: false };

  let slug = slugifyDiscussionTag(name);
  // Slug collisions are possible (two different names, same latin skeleton).
  for (let i = 0; i < 5; i++) {
    const taken = await prisma.discussionTag.findUnique({ where: { slug }, select: { slug: true } });
    if (!taken) break;
    slug = `${slugifyDiscussionTag(name)}-${i + 2}`;
  }

  const create = (author: string | null) =>
    prisma.discussionTag.create({
      data: { slug, name, official: false, createdById: author, sortOrder: 200 },
      select: TAG_SELECT,
    });

  try {
    const created = await create(createdById);
    bustDiscussionTagCache();
    return { ok: true, tag: created, created: true };
  } catch {
    // Lost a race — whoever won created the same name.
    const row = await prisma.discussionTag.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: TAG_SELECT,
    });
    if (row) return { ok: true, tag: row, created: false };
    // Not a race: the only other way the insert fails is a dangling author (a
    // session JWT outliving its user row). The TAG is still worth having.
    if (createdById) {
      try {
        const created = await create(null);
        bustDiscussionTagCache();
        return { ok: true, tag: created, created: true };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: 'create_failed' };
  }
}

/**
 * Topic count per分类 — feeds the Discourse-style sidebar. Topics are
 * multi-tag, so a topic counts toward each of its分类; groupBy can't unnest
 * arrays, so count in JS over the tiny select.
 */
export async function countTopicsByTag(): Promise<Record<string, number>> {
  const rows = await prisma.discussionTopic.findMany({ select: { categories: true } });
  const counts: Record<string, number> = {};
  for (const r of rows) {
    for (const c of new Set(r.categories)) counts[c] = (counts[c] ?? 0) + 1;
  }
  return counts;
}

export interface SidebarTag extends DiscussionTagOption {
  count: number;
}

/**
 * 左侧栏：只有 official 分类。自建分类哪怕再热也不进来（这是刻意的 —— 侧栏
 * 是固定导航，不是标签云），它们只作为 chip 出现在帖子上、点击可筛选。
 */
export async function listSidebarTags(): Promise<{ tags: SidebarTag[]; total: number }> {
  const [all, counts, total] = await Promise.all([
    listDiscussionTags(),
    countTopicsByTag(),
    prisma.discussionTopic.count(),
  ]);
  return {
    tags: all.filter((t) => t.official).map((t) => ({ ...t, count: counts[t.slug] ?? 0 })),
    total,
  };
}

/** slug 数组 → 可渲染的分类视图；查不到的 slug 退化成显示 slug 本身。 */
export async function resolveTagViews(slugs: readonly string[]): Promise<DiscussionTagOption[]> {
  const map = await discussionTagMap();
  return slugs.map(
    (slug) => map.get(slug) ?? { slug, name: slug, nameEn: slug, official: false },
  );
}

/** 批量版：一次 map，喂给列表页的多行。 */
export function tagViewsFrom(
  slugs: readonly string[],
  map: ReadonlyMap<string, DiscussionTagOption>,
): DiscussionTagOption[] {
  return slugs.map((slug) => map.get(slug) ?? { slug, name: slug, nameEn: slug, official: false });
}

export type TopicSort = 'latest' | 'top' | 'new';

export interface ListTopicsFilters {
  /** DiscussionTag slug — 侧栏分类或自建分类都能筛。 */
  category?: string;
  sort?: TopicSort;
  page?: number;
  pageSize?: number;
  /** When set, each row gets `upvotedByMe` for this user. */
  viewerId?: string | null;
  /** Tab 内搜索：标题/正文匹配。 */
  q?: string;
}

export async function listTopics(filters: ListTopicsFilters) {
  const rawPage = Number(filters.page ?? 1);
  const requested = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
  const rawSize = Number(filters.pageSize ?? 20);
  const pageSize = Number.isFinite(rawSize) ? Math.min(50, Math.max(1, Math.trunc(rawSize))) : 20;

  // Both filters are OR-groups — compose with AND so they never clobber each other.
  const and: Prisma.DiscussionTopicWhereInput[] = [];
  // 迁移把每一行的 categories 都填满了（见 20260827130000_discussion_tags），
  // 所以这里不再需要回落到旧的单列。
  if (filters.category) and.push({ categories: { has: filters.category } });
  const q = (filters.q ?? '').trim();
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { bodyMd: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  const where: Prisma.DiscussionTopicWhereInput = and.length > 0 ? { AND: and } : {};

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
    select: TOPIC_LIST_SELECT,
  });

  const items = await annotateTopicRows(rows, filters.viewerId);

  return { items, page, pageSize, total, hasMore: page * pageSize < total };
}

/** The columns a topic ROW needs (forum list, 全部 stream) — never the replies. */
const TOPIC_LIST_SELECT = {
  id: true,
  title: true,
  bodyMd: true,
  category: true,
  categories: true,
  pinned: true,
  locked: true,
  upvoteCount: true,
  replyCount: true,
  viewCount: true,
  lastActivityAt: true,
  createdAt: true,
  author: AUTHOR_SELECT,
} satisfies Prisma.DiscussionTopicSelect;

/** Tags, excerpt, the viewer's +1 and the participant stack — 3 queries for a whole page. */
async function annotateTopicRows(
  rows: Prisma.DiscussionTopicGetPayload<{ select: typeof TOPIC_LIST_SELECT }>[],
  viewerId?: string | null,
) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [upvoted, participants, tagMap] = await Promise.all([
    viewerUpvoteSet(viewerId, ids),
    topicParticipants(ids),
    discussionTagMap(),
  ]);
  return rows.map(({ bodyMd, ...r }) => ({
    ...r,
    tags: tagViewsFrom(r.categories, tagMap),
    excerpt: excerptOf(bodyMd),
    upvotedByMe: upvoted.has(r.id),
    // Recent repliers (raw identities — consumers trim via toPublicAuthor).
    participants: participants.get(r.id) ?? [],
  }));
}

/**
 * Plain-text preview of a markdown body for list rows (CocoLoop-style 阅读更多),
 * profile excerpts and the homepage 社区此刻 hot posts.
 *
 * Topic and reply bodies carry own-line `[embed:<kind>:<ref>]` / `[poll:<id>]`
 * tokens, formatting spans, resized `<img width>` and raw-HTML tables; all of
 * that — plus code blocks (a code-only body shows its first code line),
 * entities and code-point-safe truncation — is decided
 * in lib/markdown-text.ts, the one markdown → plain-text path, so a list row
 * can never show `<span data color="red"` garbage again.
 */
export function excerptOf(md: string, max = 140): string {
  return markdownToPlainText(md, { max });
}

type ParticipantIdentity = {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  lab: string | null;
  isPrivate: boolean;
};

/** Up to 4 most-recent distinct repliers per topic (Discourse-style avatar stack). */
async function topicParticipants(
  topicIds: string[],
): Promise<Map<string, ParticipantIdentity[]>> {
  const map = new Map<string, ParticipantIdentity[]>();
  if (topicIds.length === 0) return map;

  // ONE round trip, with the per-topic row budget still enforced IN SQL. This
  // used to be Promise.all(topicIds.map(…)) — one query PER ROW, so a page of
  // up to 50 topics fired 50 concurrent queries and could drain the Prisma pool
  // on its own (P2024 surfaced as a raw 500). Collapsing it to a plain
  // `topicId: { in: … }` findMany is not enough: an IN-query has no per-topic
  // LIMIT, so it reads and ships every visible reply of every topic on the page
  // — unbounded, and growing with the forum.
  //
  // The LATERAL is literally the old per-topic query, run once per id inside a
  // single statement: same index, same ORDER BY, same LIMIT 12, and the rows
  // even come back in the old `perTopicRows.flat()` order. EXPLAIN is
  // `Nested Loop → Limit → Index Scan Backward using
  // DiscussionReply_topicId_createdAt_idx`, i.e. it stops after 12 index
  // entries per topic instead of sorting the whole match set. (A
  // `row_number() … <= 12` window is the other way to write this, but it only
  // stops early on PostgreSQL 15+, where the planner turns the outer filter
  // into a WindowAgg Run Condition; below that it materialises every matching
  // reply first. LATERAL is bounded on every version.)
  // `unnest($1::text[])` keeps the ids one bound parameter — never
  // interpolated, and one prepared-statement shape whatever the page size.
  const replies = await prisma.$queryRaw<{ topicId: string; authorId: string }[]>`
    SELECT r."topicId", r."authorId"
    FROM unnest(${topicIds}::text[]) AS t(id)
    CROSS JOIN LATERAL (
      SELECT "topicId", "authorId"
      FROM "DiscussionReply"
      WHERE "topicId" = t.id AND "status" = 'visible'
      ORDER BY "createdAt" DESC
      LIMIT 12
    ) r`;

  // Unchanged: the 12-row window is the budget this scan spends, so a topic
  // whose newest 12 replies come from 2 people yields 2 participants — it must
  // NOT dig past the window to find a 3rd.
  const perTopic = new Map<string, string[]>();
  for (const r of replies) {
    const list = perTopic.get(r.topicId) ?? [];
    if (list.length < 4 && !list.includes(r.authorId)) list.push(r.authorId);
    perTopic.set(r.topicId, list);
  }

  const authorIds = [...new Set([...perTopic.values()].flat())];
  if (authorIds.length === 0) return map;
  const users = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, ...AUTHOR_IDENTITY_FIELDS },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  for (const [topicId, list] of perTopic) {
    map.set(
      topicId,
      list
        .map((id) => byId.get(id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map(({ id: _id, ...identity }) => ({ ...identity, avatarUrl: identity.avatarUrl ?? null })),
    );
  }
  return map;
}

/**
 * Count one view per viewer per topic per UTC day (mirrors VideoView's
 * sessionHash dedupe). Array transaction: a duplicate insert rolls the
 * increment back with it. Best-effort — never throws.
 */
export async function recordTopicView(topicId: string, viewerKey: string): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const sessionHash = createHash('sha256').update(`${viewerKey}:${topicId}:${day}`).digest('hex');
    await prisma.$transaction([
      prisma.discussionTopicView.create({ data: { topicId, sessionHash } }),
      prisma.discussionTopic.update({
        where: { id: topicId },
        data: { viewCount: { increment: 1 } },
      }),
    ]);
  } catch {
    /* already viewed today, or topic deleted — fine */
  }
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
      media: MEDIA_SELECT,
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
          likeCount: true,
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
              likeCount: true,
              createdAt: true,
              author: AUTHOR_SELECT,
            },
          },
        },
      },
    },
  });
  if (!topic) return null;

  // One batched read for the viewer's reply likes — a per-row `likes: { where }`
  // would issue a subquery per reply on a 300-reply topic.
  const replyIds = topic.replies.flatMap((r) => [r.id, ...r.replies.map((c) => c.id)]);
  const [upvoted, tags, likedReplies] = await Promise.all([
    viewerUpvoteSet(viewerId, [topic.id]),
    resolveTagViews(topic.categories),
    viewerReplyLikeSet(viewerId, replyIds),
  ]);
  return { ...topic, tags, upvotedByMe: upvoted.has(topic.id), likedReplies };
}

/** Ids among `replyIds` the viewer has liked. Empty for anonymous viewers. */
async function viewerReplyLikeSet(viewerId: string | null | undefined, replyIds: string[]) {
  if (!viewerId || replyIds.length === 0) return new Set<string>();
  const rows = await prisma.discussionReplyLike.findMany({
    where: { userId: viewerId, replyId: { in: replyIds } },
    select: { replyId: true },
  });
  return new Set(rows.map((r) => r.replyId));
}

async function viewerUpvoteSet(viewerId: string | null | undefined, topicIds: string[]) {
  if (!viewerId || topicIds.length === 0) return new Set<string>();
  const rows = await prisma.discussionUpvote.findMany({
    where: { userId: viewerId, topicId: { in: topicIds } },
    select: { topicId: true },
  });
  return new Set(rows.map((r) => r.topicId));
}
