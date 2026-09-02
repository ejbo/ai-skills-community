import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { excerptOf } from '@/lib/discussion-queries';
import { BROWSABLE_DOC_WHERE } from '@/lib/library-queries';
import { DISCOVERABLE_SKILL_WHERE } from '@/lib/skill-queries';

/**
 * The signed-in homepage's aggregate figures + its 热议 links.
 *
 * Two reasons this is its own module rather than more entries in
 * `CommunityHome`'s `Promise.all`:
 *
 * 1. **It is memoized.** These are a dozen `COUNT(*)`s and the homepage is
 *    `force-dynamic`, so without a memo every signed-in render pays them on the
 *    one JS thread this deploy has (docs/capacity-tuning.md: "唯一的瓶颈就是
 *    一个 Node 进程"). At a 60 s TTL they cost a dozen statements per *minute*
 *    instead of per render. Route-level caching is not an option here — the root
 *    layout's `headers()` + `auth()` opt the whole tree out of static rendering.
 * 2. **Nothing in here may be viewer-dependent.** The memo is shared by every
 *    signed-in user in the process, so no `likedByMe` / `attending` / private-zone
 *    membership may leak in. That constraint is why the 技术专区 halves below use
 *    the public-zone approximation rather than a per-viewer gate.
 *
 * Multi-process note (capacity-tuning appendix C lists module-level state as the
 * blocker for going multi-process): unlike the rate limiter or the upload queue,
 * this cache is correctness-neutral under N processes — each keeps its own copy,
 * so the only effect is N× the upstream queries, still bounded and still tiny.
 */

/** Recent-activity figures, plus the one stock figure the hero shows. */
export interface HomeStats {
  /** New discoverable Skills in the window. */
  skills: number;
  /** 动态 + 论坛主题 + 技术专区帖 — one "new discussion" number, not three. */
  discussions: number;
  /** Comments and replies across every board that has them. */
  comments: number;
  /** Published videos, long-form and 短视频 together. */
  videos: number;
  /** New 知识库 documents. */
  docs: number;
}

/** A 热议 link in the hero brief: 动态 have no title, only a body. */
export interface HomeHotPost {
  id: string;
  excerpt: string;
  likeCount: number;
  commentCount: number;
}

export interface HomeSnapshot {
  stats: HomeStats;
  hotPosts: HomeHotPost[];
}

const TTL_MS = 60_000;

/**
 * How many calendar days the flow figures cover, counting today. A single-day
 * window was the original design and it reads as dead on a community this size:
 * six counters that are almost always `0` say less than three that were. Seven
 * days is short enough to still mean "lately" and long enough that a quiet
 * Tuesday does not blank the whole ledger. One constant — narrow it back to 1
 * for a strict 今日 board.
 */
const WINDOW_DAYS = 7;

/** How far back a 动态 may be and still count as "what people are talking about". */
const HOT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOT_POST_LIMIT = 3;
/**
 * Over-fetch, because a 动态 is allowed to have no text at all: the create route
 * accepts a post with media and an empty `bodyMd`, and `excerptOf` strips poll
 * tokens and image markdown, so an image-only or poll-only post excerpts to ''.
 * Those are exactly the posts that collect likes, so they rank high here — and a
 * row of them would render as a link with a dot, the word 热议, and nothing else.
 */
const HOT_POST_SCAN = HOT_POST_LIMIT * 4;
const HOT_EXCERPT_CHARS = 70;

const EMPTY: HomeSnapshot = {
  stats: { skills: 0, discussions: 0, comments: 0, videos: 0, docs: 0 },
  hotPosts: [],
};

/**
 * 技术专区 posts countable without a viewer: published, in a live public zone,
 * and zone-visible. This is the same approximation site search uses
 * (lib/search.ts) and for the same reason — `members`/`restricted` posts need a
 * membership or a grant to list, which cannot be decided once for a shared
 * cache. It undercounts; a figure that is stable across viewers is worth more
 * here than one that is exact for each of them.
 */
const PUBLIC_ZONE_POST_WHERE = {
  status: 'published',
  deletedAt: null,
  visibility: 'zone',
  zone: { deletedAt: null, visibility: 'public' },
} satisfies Prisma.ZonePostWhereInput;

/**
 * Comments are never soft-deleted in this app: a tombstone keeps its row with
 * `status: 'deleted'` so the thread shape survives, and the LIST queries
 * deliberately ship it so the UI can render 「该评论已删除」. A count must
 * therefore filter `status: 'visible'` — copying a list `where` over-counts.
 * `VideoComment` also has a moderator-only `hidden` state, which `'visible'`
 * excludes too; `VoteComment` has no status column at all (hard delete only).
 */
const VISIBLE = { status: 'visible' } as const;

interface CacheEntry {
  at: number;
  /** Server-local midnight these figures were counted from. */
  dayKey: number;
  snapshot: HomeSnapshot;
}

let cached: CacheEntry | null = null;
let inflight: Promise<HomeSnapshot> | null = null;

/** Server-local midnight — the boundary the cache's day bucket keys on. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Drop the memo, e.g. from a test. */
export function bustHomeSnapshot(): void {
  cached = null;
}

export async function getHomeSnapshot(): Promise<HomeSnapshot> {
  const today = startOfToday();
  const dayKey = today.getTime();
  // Local date arithmetic, not `dayKey - N * DAY_MS`: a DST week has a 23h or
  // 25h day, so subtracting fixed milliseconds would land the window an hour off
  // midnight and count a sliver of the eighth day.
  const since = new Date(today);
  since.setDate(since.getDate() - (WINDOW_DAYS - 1));
  // The day bucket is part of the key on purpose: a snapshot taken at 23:59:30
  // covers a window that has moved by the time the clock rolls over, TTL or no
  // TTL, so a new day is always a miss.
  if (cached && cached.dayKey === dayKey && Date.now() - cached.at < TTL_MS) {
    return cached.snapshot;
  }
  if (inflight) return inflight;

  inflight = load(since)
    .then((snapshot) => {
      cached = { at: Date.now(), dayKey, snapshot };
      return snapshot;
    })
    .catch((err) => {
      // A failed figure must never take the homepage down with it. Serve this
      // window's stale numbers if we have any; never a previous day's, whose
      // window no longer matches the caption.
      console.error('[home-stats] snapshot failed', err);
      return cached && cached.dayKey === dayKey ? cached.snapshot : EMPTY;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

async function load(since: Date): Promise<HomeSnapshot> {
  // 热议 reaches further back than the ledger on purpose: the figures are about
  // "is anything happening", the links are about "what is worth reading".
  const hotSince = new Date(since.getTime() - HOT_WINDOW_DAYS * DAY_MS);

  const [
    skills,
    feedPosts,
    topics,
    zonePosts,
    videoComments,
    feedComments,
    topicReplies,
    zoneComments,
    docComments,
    voteComments,
    videos,
    docs,
    hotRecent,
  ] = await Promise.all([
    prisma.skill.count({ where: { ...DISCOVERABLE_SKILL_WHERE, createdAt: { gte: since } } }),

    // 动态 and 论坛主题 have no soft delete, no status and no visibility — the
    // delete routes hard-delete — so a bare createdAt count is already exactly
    // what a member can see.
    prisma.post.count({ where: { createdAt: { gte: since } } }),
    prisma.discussionTopic.count({ where: { createdAt: { gte: since } } }),
    prisma.zonePost.count({
      where: { ...PUBLIC_ZONE_POST_WHERE, publishedAt: { gte: since } },
    }),

    // Each comment count is gated on its parent too, so a comment on a
    // soft-deleted video or an unready doc does not inflate the figure.
    prisma.videoComment.count({
      where: {
        ...VISIBLE,
        createdAt: { gte: since },
        // No `isShort` key: this figure deliberately spans both boards.
        video: { status: 'published', visibility: 'public', deletedAt: null },
      },
    }),
    prisma.postComment.count({ where: { ...VISIBLE, createdAt: { gte: since } } }),
    prisma.discussionReply.count({ where: { ...VISIBLE, createdAt: { gte: since } } }),
    prisma.zonePostComment.count({
      where: { ...VISIBLE, createdAt: { gte: since }, post: PUBLIC_ZONE_POST_WHERE },
    }),
    prisma.libraryComment.count({
      where: { ...VISIBLE, createdAt: { gte: since }, doc: BROWSABLE_DOC_WHERE },
    }),
    prisma.voteComment.count({
      where: {
        createdAt: { gte: since },
        activity: { deletedAt: null, status: 'published' },
        entry: { hidden: false, status: 'approved' },
      },
    }),

    prisma.video.count({
      where: {
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        publishedAt: { gte: since },
      },
    }),
    prisma.libraryDoc.count({ where: { ...BROWSABLE_DOC_WHERE, createdAt: { gte: since } } }),

    hotPosts(hotSince),
  ]);

  // 共享批注 replies (LibraryNoteReply) are deliberately left out: they are
  // public only while their owner's per-doc `shareNotes` flag is on, which is a
  // correlated predicate no single global count can express.
  const comments =
    videoComments + feedComments + topicReplies + zoneComments + docComments + voteComments;

  // A young community can have nothing engaging in the window yet; fall back to
  // the all-time best rather than rendering no 热议 row at all. Only ever fires
  // while the window is barren, and it is inside the memo either way.
  let hot = linkable(hotRecent);
  if (hot.length === 0) hot = linkable(await hotPosts(null));

  return {
    stats: {
      skills,
      discussions: feedPosts + topics + zonePosts,
      comments,
      videos,
      docs,
    },
    hotPosts: hot,
  };
}

/** Rows that actually have text to put in a link, best first, capped. */
function linkable(rows: { id: string; bodyMd: string; likeCount: number; commentCount: number }[]) {
  const out: HomeHotPost[] = [];
  for (const p of rows) {
    const excerpt = excerptOf(p.bodyMd, HOT_EXCERPT_CHARS);
    if (!excerpt) continue;
    out.push({ id: p.id, excerpt, likeCount: p.likeCount, commentCount: p.commentCount });
    if (out.length === HOT_POST_LIMIT) break;
  }
  return out;
}

/**
 * Hottest 动态, engagement first. Anything with no likes and no comments is
 * excluded: an unengaged post is not a 热议, and showing one would make the row
 * read as an arbitrary sample of the feed.
 */
function hotPosts(since: Date | null) {
  return prisma.post.findMany({
    where: {
      ...(since ? { createdAt: { gte: since } } : {}),
      OR: [{ likeCount: { gt: 0 } }, { commentCount: { gt: 0 } }],
    },
    orderBy: [{ likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }],
    take: HOT_POST_SCAN,
    select: { id: true, bodyMd: true, likeCount: true, commentCount: true },
  });
}
