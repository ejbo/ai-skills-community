import { createHash } from 'node:crypto';
import { Prisma, PostReaction } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_FIELDS, AUTHOR_IDENTITY_SELECT } from '@/lib/user-identity';
import { POLL_TOKEN_GLOBAL_RE } from '@/lib/polls-shared';
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

  const annotated = await annotateReactions(
    all,
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
    select: {
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
    },
  });

  const ids = rows.map((r) => r.id);
  const [upvoted, participants] = await Promise.all([
    viewerUpvoteSet(filters.viewerId, ids),
    topicParticipants(ids),
  ]);
  const tagMap = await discussionTagMap();
  const items = rows.map(({ bodyMd, ...r }) => ({
    ...r,
    tags: tagViewsFrom(r.categories, tagMap),
    excerpt: excerptOf(bodyMd),
    upvotedByMe: upvoted.has(r.id),
    // Recent repliers (raw identities — consumers trim via toPublicAuthor).
    participants: participants.get(r.id) ?? [],
  }));

  return { items, page, pageSize, total, hasMore: page * pageSize < total };
}

/** Plain-text preview of a markdown body for list rows (CocoLoop-style 阅读更多). */
export function excerptOf(md: string, max = 140): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(POLL_TOKEN_GLOBAL_RE, ' ') // embedded 投票 tokens (incl. \[poll:…\] escaped form)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → label
    .replace(/[#>*_~`|-]+/g, ' ') // md syntax noise
    .replace(/\s+/g, ' ')
    .trim();
  // Slice on code points, not UTF-16 units — a cut surrogate pair (emoji,
  // CJK-Ext ideographs) would render as a lone '�'.
  const cps = [...text];
  return cps.length > max ? `${cps.slice(0, max).join('')}…` : text;
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

  // Per-topic budget (indexed on [topicId, createdAt]) so one hot topic can't
  // starve the quieter topics on the page; then one shared identity fetch.
  const perTopicRows = await Promise.all(
    topicIds.map((id) =>
      prisma.discussionReply.findMany({
        where: { topicId: id, status: 'visible' },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { topicId: true, authorId: true },
      }),
    ),
  );

  const perTopic = new Map<string, string[]>();
  for (const r of perTopicRows.flat()) {
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

  const [upvoted, tags] = await Promise.all([
    viewerUpvoteSet(viewerId, [topic.id]),
    resolveTagViews(topic.categories),
  ]);
  return { ...topic, tags, upvotedByMe: upvoted.has(topic.id) };
}

async function viewerUpvoteSet(viewerId: string | null | undefined, topicIds: string[]) {
  if (!viewerId || topicIds.length === 0) return new Set<string>();
  const rows = await prisma.discussionUpvote.findMany({
    where: { userId: viewerId, topicId: { in: topicIds } },
    select: { topicId: true },
  });
  return new Set(rows.map((r) => r.topicId));
}
