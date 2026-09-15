// 个人主页 (/users/[handle]) — the viewer model and every section's data.
//
// Contract (SPEC §3.1–§3.2, CLAUDE.md "Profile vs Dashboard"):
//   • `resolveProfileViewer` is the ONE place that decides who is looking:
//     owner / 访客视角 preview / `identity` holder / signed-in member / anonymous.
//   • `viewer.allowed` is the list of sections this viewer may see. Every loader
//     below returns empty for a section outside it WITHOUT querying — a hidden
//     section's rows never leave the server (never fetched-then-hidden).
//   • Each section reuses its DOMAIN's own gate (DISCOVERABLE_SKILL_WHERE,
//     BROWSABLE_DOC_WHERE, PUBLISHED_PUBLIC, listZoneFeed, toPublicEvent,
//     toVoteCard…). Domain MANAGE permissions are deliberately NOT honoured here:
//     the profile is a showcase, admins have /manage — so every domain viewer is
//     built with `canManage: false` / `siteAdmin: false`.
//   • The owner's public tabs show the SAME set a visitor would (drafts, private
//     and unready rows live in 工作台). The one domain-mandated exception is
//     技术专区: an author is privileged on their own posts, so the owner's list
//     keeps posts in zones they can no longer read (listZoneFeed handles it).
//   • 访客视角 runs the gates as a signed-in member with NO memberships or grants:
//     the domain viewer id is a sentinel no row can match, so every "own row /
//     my zone / my grant" branch of a gate falls away exactly as for a stranger.
//
// The pure helpers (viewer, tabs, paging, merges, cursors) are unit-tested in
// tests/profile-queries.test.ts.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { can, type DomainViewer, type PermissionHolder } from '@/lib/permissions';
import {
  PROFILE_SECTIONS,
  isLoginOnlySection,
  type ProfileLayout,
  type ProfileSection,
  type ProfileTab,
} from '@/lib/profile/shared';
import { DISCOVERABLE_SKILL_WHERE, SKILL_CARD_SELECT } from '@/lib/skill-queries';
import {
  BROWSABLE_DOC_WHERE,
  DOC_CARD_SELECT,
  READY_DOC_WHERE,
  type DocCardData,
} from '@/lib/library-queries';
import { discussionTagMap, excerptOf, tagViewsFrom } from '@/lib/discussion-queries';
import type { DiscussionTagOption } from '@/lib/discussion-tags';
import { PUBLISHED_PUBLIC, VIDEO_CARD_SELECT, type VideoCard } from '@/lib/video/queries';
import { SHORTS_PUBLIC, listShorts, toShortView } from '@/lib/video/shorts-queries';
import type { ShortView } from '@/app/videos/shorts/_components/types';
import type { ZoneSiteViewer } from '@/lib/zones/access';
import { countZoneFeed, listZoneFeed } from '@/lib/zones/post-queries';
import { zonePostHref } from '@/lib/zones/shared';
import type { ZonePostCardView } from '@/lib/zones/types';
import { countEventsByAuthor, listEventsByAuthor, type AuthoredEventItem } from '@/lib/event-queries';
import {
  countVoteActivitiesByCreator,
  listVoteActivitiesByCreator,
  type PublicVoteCard,
} from '@/lib/vote-queries';

// ─── Viewer model (pure) ─────────────────────────────────────────────────

/**
 * Domain-gate viewer id used in 访客视角. Not a cuid, so it can never equal a
 * real user / membership / grant row — the gates then see a member with no
 * relationship to anything, which is exactly what a stranger is.
 */
export const PREVIEW_VISITOR_ID = '__profile_visitor_preview__';

export interface ProfileViewer {
  profileUserId: string;
  /** The session user, untouched (null anonymous). */
  realViewerId: string | null;
  /** The id handed to domain gates: real id · PREVIEW_VISITOR_ID in preview · null anonymous. */
  gateViewerId: string | null;
  loggedIn: boolean;
  isRealOwner: boolean;
  /** Owner looking at `?as=visitor`. */
  previewAsVisitor: boolean;
  /** Owner tooling + 工作台 + empty-state CTAs (false in preview). */
  isOwner: boolean;
  /** `identity` permission (false in preview): untrimmed 隐私账号 fields + hidden sections. */
  canSeeIdentity: boolean;
  canSeeHidden: boolean;
  layout: ProfileLayout;
  /** Sections this viewer may see, in the member's layout order. Nothing else is ever queried. */
  allowed: ProfileSection[];
}

export function resolveProfileViewer(input: {
  sessionUser: ({ id: string } & PermissionHolder) | null | undefined;
  profileUserId: string;
  /** Raw `searchParams.as`. */
  as?: unknown;
  layout: ProfileLayout;
}): ProfileViewer {
  const user = input.sessionUser ?? null;
  const asParam = Array.isArray(input.as) ? input.as[0] : input.as;
  const isRealOwner = !!user && user.id === input.profileUserId;
  const previewAsVisitor = isRealOwner && asParam === 'visitor';
  const isOwner = isRealOwner && !previewAsVisitor;
  const canSeeIdentity = can(user, 'identity') && !previewAsVisitor;
  const canSeeHidden = isOwner || canSeeIdentity;
  const loggedIn = !!user;
  const allowed = input.layout.order.filter(
    (s) => (!isLoginOnlySection(s) || loggedIn) && (!input.layout.hidden.includes(s) || canSeeHidden),
  );
  return {
    profileUserId: input.profileUserId,
    realViewerId: user?.id ?? null,
    gateViewerId: user ? (previewAsVisitor ? PREVIEW_VISITOR_ID : user.id) : null,
    loggedIn,
    isRealOwner,
    previewAsVisitor,
    isOwner,
    canSeeIdentity,
    canSeeHidden,
    layout: input.layout,
    allowed,
  };
}

export function isSectionAllowed(v: Pick<ProfileViewer, 'allowed'>, s: ProfileSection): boolean {
  return v.allowed.includes(s);
}

/** Hidden from the public but visible to THIS viewer (owner / identity) — rendered with the 仅自己可见 marker. */
export function isHiddenButVisible(v: Pick<ProfileViewer, 'allowed' | 'layout'>, s: ProfileSection): boolean {
  return v.allowed.includes(s) && v.layout.hidden.includes(s);
}

export type SectionCounts = Record<ProfileSection, number>;

export function emptySectionCounts(): SectionCounts {
  return Object.fromEntries(PROFILE_SECTIONS.map((s) => [s, 0])) as SectionCounts;
}

/**
 * 概览 first, then the allowed sections in layout order — a visitor only gets
 * tabs with content, the owner gets every allowed section (empty ones carry a
 * CTA) — and 工作台 last for the owner.
 */
export function deriveProfileTabs(
  v: Pick<ProfileViewer, 'allowed' | 'isOwner'>,
  counts: Partial<Record<ProfileSection, number>>,
): ProfileTab[] {
  const tabs: ProfileTab[] = ['overview'];
  for (const s of v.allowed) if (v.isOwner || (counts[s] ?? 0) > 0) tabs.push(s);
  if (v.isOwner) tabs.push('workspace');
  return tabs;
}

// ─── Paging (pure) ───────────────────────────────────────────────────────

/** Grids (skills, docs, videos, votes, shelf). */
export const PROFILE_GRID_PAGE_SIZE = 24;
/** Row lists (posts, topics, zones, events, feedback, comments). */
export const PROFILE_LIST_PAGE_SIZE = 20;

/** `?page=` → a positive integer (garbage → 1). */
export function parseProfilePage(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(10_000, Math.trunc(n)) : 1;
}

/** `?cursor=` → a bounded string or null. */
export function parseProfileCursor(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null;
}

export function pageWindow(total: number, requested: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, skip: (page - 1) * pageSize };
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
}

export interface CursorResult<T> {
  items: T[];
  nextCursor: string | null;
}

function emptyPage<T>(): PagedResult<T> {
  return { items: [], total: 0, page: 1, pageCount: 1 };
}

const iso = (d: Date) => d.toISOString();

// ─── 最近动态 merge (pure) ────────────────────────────────────────────────

export type ActivityKind =
  | 'skill'
  | 'doc'
  | 'post'
  | 'topic'
  | 'short'
  | 'video'
  | 'zonePost'
  | 'event'
  | 'vote'
  | 'feedback'
  | 'post_comment'
  | 'topic_reply'
  | 'feedback_comment'
  | 'doc_comment'
  | 'shelf';

export interface ProfileActivityItem {
  /** `${kind}:${id}` — unique across the merged timeline. */
  key: string;
  kind: ActivityKind;
  title: string;
  /** Where it happened (the post a comment is on, the zone a post is in…). */
  context: string | null;
  href: string;
  at: string;
}

/** Newest first across every source; ties broken by key so SSR output is stable; duplicates dropped. */
export function mergeActivity(lists: readonly (readonly ProfileActivityItem[])[], take: number): ProfileActivityItem[] {
  const seen = new Set<string>();
  const all: ProfileActivityItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item.key) || Number.isNaN(Date.parse(item.at))) continue;
      seen.add(item.key);
      all.push(item);
    }
  }
  all.sort((a, b) => {
    const d = Date.parse(b.at) - Date.parse(a.at);
    return d !== 0 ? d : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return all.slice(0, Math.max(0, take));
}

// ─── 评论 keyset across four tables (pure) ───────────────────────────────

export const COMMENT_KINDS = ['post_comment', 'topic_reply', 'feedback_comment', 'doc_comment'] as const;
export type ProfileCommentKind = (typeof COMMENT_KINDS)[number];

export interface ProfileCommentItem {
  key: string;
  kind: ProfileCommentKind;
  id: string;
  excerpt: string;
  /** The parent's title; '' when it has none (a media-only 动态) — the UI substitutes a label. */
  contextTitle: string;
  href: string;
  createdAt: string;
}

export interface CommentCursor {
  at: Date;
  kind: ProfileCommentKind;
  id: string;
}

// The merged list's total order is (createdAt desc, kind rank asc, id desc).
// Every table is paged with the SAME order, so the first `limit` of the union of
// each table's next `limit + 1` rows is exactly the global next page.
const kindRank = (k: ProfileCommentKind) => COMMENT_KINDS.indexOf(k);

export function encodeCommentCursor(item: { createdAt: string | Date; kind: ProfileCommentKind; id: string }): string {
  const at = typeof item.createdAt === 'string' ? item.createdAt : item.createdAt.toISOString();
  return `${at}|${item.kind}|${item.id}`;
}

export function decodeCommentCursor(raw: string | null | undefined): CommentCursor | null {
  if (!raw) return null;
  const parts = raw.split('|');
  if (parts.length !== 3) return null;
  const [atRaw, kind, id] = parts;
  const at = new Date(atRaw);
  if (Number.isNaN(at.getTime()) || !(COMMENT_KINDS as readonly string[]).includes(kind)) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return { at, kind: kind as ProfileCommentKind, id };
}

/** A where fragment every comment table accepts (createdAt + id exist on all four). */
export type CommentAfterWhere = {
  createdAt?: { lt: Date } | { lte: Date };
  OR?: ({ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } })[];
};

/** Rows of `kind` strictly after the cursor in the merged order. */
export function commentAfterWhere(cursor: CommentCursor | null, kind: ProfileCommentKind): CommentAfterWhere {
  if (!cursor) return {};
  const r = kindRank(kind);
  const c = kindRank(cursor.kind);
  if (r > c) return { createdAt: { lte: cursor.at } };
  if (r < c) return { createdAt: { lt: cursor.at } };
  return { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] };
}

export function compareComments(a: ProfileCommentItem, b: ProfileCommentItem): number {
  const d = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (d !== 0) return d;
  const k = kindRank(a.kind) - kindRank(b.kind);
  if (k !== 0) return k;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function mergeCommentPages(
  lists: readonly (readonly ProfileCommentItem[])[],
  limit: number,
): CursorResult<ProfileCommentItem> {
  const all = lists.flat().sort(compareComments);
  const items = all.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: all.length > limit && last ? encodeCommentCursor(last) : null };
}

// ─── Domain viewers ──────────────────────────────────────────────────────

function domainViewerFor(v: ProfileViewer): DomainViewer {
  return { id: v.gateViewerId, canManage: false, canSeeIdentity: v.canSeeIdentity };
}

function zoneViewerFor(v: ProfileViewer): ZoneSiteViewer {
  return { id: v.gateViewerId, siteAdmin: false, canSeeIdentity: v.canSeeIdentity };
}

/**
 * 书架 and 知识库评论 only ever surface PUBLIC, ready docs — a restricted doc's
 * shelf row or comment would advertise what someone reads behind a gate.
 */
const PUBLIC_READY_DOC = { ...READY_DOC_WHERE, visibility: 'public' } satisfies Prisma.LibraryDocWhereInput;

// ─── Counts + hero figures ───────────────────────────────────────────────

async function countSection(v: ProfileViewer, s: ProfileSection): Promise<number> {
  const uid = v.profileUserId;
  switch (s) {
    case 'skills':
      return prisma.skill.count({ where: { authorId: uid, ...DISCOVERABLE_SKILL_WHERE } });
    case 'docs':
      return prisma.libraryDoc.count({ where: { uploaderId: uid, ...BROWSABLE_DOC_WHERE } });
    case 'posts':
      return prisma.post.count({ where: { authorId: uid } });
    case 'topics':
      return prisma.discussionTopic.count({ where: { authorId: uid } });
    case 'videos': {
      const [shorts, longs] = await Promise.all([
        prisma.video.count({ where: { ...SHORTS_PUBLIC, uploaderId: uid } }),
        prisma.video.count({ where: { ...PUBLISHED_PUBLIC, uploaderId: uid } }),
      ]);
      return shorts + longs;
    }
    case 'zones':
      return countZoneFeed({ viewer: zoneViewerFor(v), authorId: uid });
    case 'events':
      return countEventsByAuthor(uid);
    case 'votes':
      return countVoteActivitiesByCreator(uid);
    case 'feedback':
      return prisma.feedback.count({ where: { authorId: uid } });
    case 'comments': {
      const [a, b, c, d] = await Promise.all([
        prisma.postComment.count({ where: { authorId: uid, status: 'visible' } }),
        prisma.discussionReply.count({ where: { authorId: uid, status: 'visible' } }),
        prisma.feedbackComment.count({ where: { authorId: uid, status: 'visible' } }),
        // /library comment threads are login-only, so anonymous visitors never get these.
        v.loggedIn
          ? prisma.libraryComment.count({ where: { authorId: uid, status: 'visible', doc: PUBLIC_READY_DOC } })
          : Promise.resolve(0),
      ]);
      return a + b + c + d;
    }
    case 'shelf':
      return prisma.libraryShelfItem.count({ where: { userId: uid, doc: PUBLIC_READY_DOC } });
  }
}

/** Tab counts. Sections outside `allowed` stay 0 and are never queried. */
export async function countProfileSections(v: ProfileViewer): Promise<SectionCounts> {
  const counts = emptySectionCounts();
  const values = await Promise.all(v.allowed.map((s) => countSection(v, s)));
  v.allowed.forEach((s, i) => {
    counts[s] = values[i];
  });
  return counts;
}

export type ProfileFigureKey = 'skills' | 'downloads' | 'likes' | 'docs' | 'posts' | 'topics' | 'postsTopics' | 'videos';

export interface ProfileFigure {
  key: ProfileFigureKey;
  value: number;
  /** Tab the figure links to. */
  tab: ProfileSection;
}

/**
 * The hero stats strip. Only figures for sections the viewer may see (the old
 * header counted drafts/private skills and ignored privacy); downloads/likes are
 * a SUM over the discoverable skills, not over one page of them.
 *
 * 动态 and 话题 share ONE slot (the strip stays six wide), and its key names
 * what was actually summed: `postsTopics` only when both sections are visible —
 * a figure labelled like the 动态 tab but counting topics too would contradict
 * the tab bar right under it. `videos` = public shorts + PUBLISHED_PUBLIC long
 * videos, the same set the 名片's 视频 stat counts.
 */
export async function loadProfileFigures(v: ProfileViewer, counts: SectionCounts): Promise<ProfileFigure[]> {
  const figures: ProfileFigure[] = [];
  if (isSectionAllowed(v, 'skills')) {
    figures.push({ key: 'skills', value: counts.skills, tab: 'skills' });
    if (counts.skills > 0) {
      const agg = await prisma.skill.aggregate({
        where: { authorId: v.profileUserId, ...DISCOVERABLE_SKILL_WHERE },
        _sum: { downloadCount: true, likeCount: true },
      });
      figures.push({ key: 'downloads', value: agg._sum.downloadCount ?? 0, tab: 'skills' });
      figures.push({ key: 'likes', value: agg._sum.likeCount ?? 0, tab: 'skills' });
    }
  }
  if (isSectionAllowed(v, 'docs')) figures.push({ key: 'docs', value: counts.docs, tab: 'docs' });
  const discussion = postsFigure(isSectionAllowed(v, 'posts'), isSectionAllowed(v, 'topics'), counts);
  if (discussion) figures.push(discussion);
  if (isSectionAllowed(v, 'videos')) figures.push({ key: 'videos', value: counts.videos, tab: 'videos' });
  // A visitor sees no wall of zeros; the owner sees the whole strip.
  return v.isOwner ? figures : figures.filter((f) => f.value > 0);
}

/** The 动态 + 话题 slot of the hero strip (pure — see loadProfileFigures). */
export function postsFigure(
  postsAllowed: boolean,
  topicsAllowed: boolean,
  counts: Pick<SectionCounts, 'posts' | 'topics'>,
): ProfileFigure | null {
  if (postsAllowed && topicsAllowed) {
    // Link to whichever tab has something, preferring 动态.
    return {
      key: 'postsTopics',
      value: counts.posts + counts.topics,
      tab: counts.posts > 0 || counts.topics === 0 ? 'posts' : 'topics',
    };
  }
  if (postsAllowed) return { key: 'posts', value: counts.posts, tab: 'posts' };
  if (topicsAllowed) return { key: 'topics', value: counts.topics, tab: 'topics' };
  return null;
}

// ─── Section loaders ─────────────────────────────────────────────────────

export interface ProfileSkillItem {
  id: string;
  slug: string;
  name: string;
  summary: string;
  sourceType: 'internal' | 'external' | 'curated';
  visibility: 'public' | 'restricted' | 'private';
  updatedAt: string;
  author: { handle: string; displayName: string; avatarUrl: string | null };
  stats: { downloads: number; likes: number; rating: number; reviewCount: number; tokens: number };
}

export async function loadSkillsSection(v: ProfileViewer, page: number): Promise<PagedResult<ProfileSkillItem>> {
  if (!isSectionAllowed(v, 'skills')) return emptyPage();
  const where = { authorId: v.profileUserId, ...DISCOVERABLE_SKILL_WHERE } satisfies Prisma.SkillWhereInput;
  const total = await prisma.skill.count({ where });
  const w = pageWindow(total, page, PROFILE_GRID_PAGE_SIZE);
  const rows = await prisma.skill.findMany({
    where,
    select: SKILL_CARD_SELECT,
    orderBy: [{ trendingScore: 'desc' }, { id: 'desc' }],
    skip: w.skip,
    take: PROFILE_GRID_PAGE_SIZE,
  });
  return {
    total,
    page: w.page,
    pageCount: w.pageCount,
    items: rows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      summary: s.summary,
      sourceType: s.sourceType,
      visibility: s.visibility,
      updatedAt: iso(s.updatedAt),
      author: { handle: s.author.handle, displayName: s.author.displayName, avatarUrl: s.author.avatarUrl },
      stats: {
        downloads: s.downloadCount,
        likes: s.likeCount,
        rating: s.avgRating,
        reviewCount: s.reviewCount,
        tokens: s.tokenCostEstimate,
      },
    })),
  };
}

export type ProfileDocItem = Omit<DocCardData, 'createdAt'> & { createdAt: string };

export async function loadDocsSection(v: ProfileViewer, page: number): Promise<PagedResult<ProfileDocItem>> {
  if (!isSectionAllowed(v, 'docs')) return emptyPage();
  const where = { uploaderId: v.profileUserId, ...BROWSABLE_DOC_WHERE } satisfies Prisma.LibraryDocWhereInput;
  const total = await prisma.libraryDoc.count({ where });
  const w = pageWindow(total, page, PROFILE_GRID_PAGE_SIZE);
  const rows = await prisma.libraryDoc.findMany({
    where,
    select: DOC_CARD_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: w.skip,
    take: PROFILE_GRID_PAGE_SIZE,
  });
  return { total, page: w.page, pageCount: w.pageCount, items: rows.map((d) => ({ ...d, createdAt: iso(d.createdAt) })) };
}

export interface ProfilePostMediaThumb {
  kind: 'image' | 'video';
  url: string;
}

export interface ProfilePostItem {
  id: string;
  excerpt: string;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  /** Up to 3 visual thumbs. Video posters only for signed-in viewers (the media route is login-walled). */
  thumbs: ProfilePostMediaThumb[];
  mediaCount: number;
  fileCount: number;
}

const POST_ROW_SELECT = {
  id: true,
  bodyMd: true,
  likeCount: true,
  commentCount: true,
  createdAt: true,
  media: {
    orderBy: { sortOrder: 'asc' as const },
    select: { kind: true, url: true, posterUrl: true },
    take: 12,
  },
} satisfies Prisma.PostSelect;

function toPostItem(p: Prisma.PostGetPayload<{ select: typeof POST_ROW_SELECT }>, loggedIn: boolean): ProfilePostItem {
  const thumbs: ProfilePostMediaThumb[] = [];
  for (const m of p.media) {
    if (thumbs.length >= 3) break;
    if (m.kind === 'image') thumbs.push({ kind: 'image', url: m.url });
    else if (m.kind === 'video' && loggedIn && m.posterUrl) thumbs.push({ kind: 'video', url: m.posterUrl });
  }
  return {
    id: p.id,
    excerpt: excerptOf(p.bodyMd, 280),
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    createdAt: iso(p.createdAt),
    thumbs,
    mediaCount: p.media.filter((m) => m.kind !== 'file').length,
    fileCount: p.media.filter((m) => m.kind === 'file').length,
  };
}

export async function loadPostsSection(v: ProfileViewer, page: number): Promise<PagedResult<ProfilePostItem>> {
  if (!isSectionAllowed(v, 'posts')) return emptyPage();
  const where = { authorId: v.profileUserId } satisfies Prisma.PostWhereInput;
  const total = await prisma.post.count({ where });
  const w = pageWindow(total, page, PROFILE_LIST_PAGE_SIZE);
  const rows = await prisma.post.findMany({
    where,
    select: POST_ROW_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: w.skip,
    take: PROFILE_LIST_PAGE_SIZE,
  });
  return { total, page: w.page, pageCount: w.pageCount, items: rows.map((p) => toPostItem(p, v.loggedIn)) };
}

export interface ProfileTopicItem {
  id: string;
  title: string;
  excerpt: string;
  tags: DiscussionTagOption[];
  pinned: boolean;
  locked: boolean;
  upvoteCount: number;
  replyCount: number;
  viewCount: number;
  createdAt: string;
  lastActivityAt: string;
}

export async function loadTopicsSection(v: ProfileViewer, page: number): Promise<PagedResult<ProfileTopicItem>> {
  if (!isSectionAllowed(v, 'topics')) return emptyPage();
  const where = { authorId: v.profileUserId } satisfies Prisma.DiscussionTopicWhereInput;
  const total = await prisma.discussionTopic.count({ where });
  const w = pageWindow(total, page, PROFILE_LIST_PAGE_SIZE);
  const [rows, tagMap] = await Promise.all([
    prisma.discussionTopic.findMany({
      where,
      select: {
        id: true,
        title: true,
        bodyMd: true,
        categories: true,
        pinned: true,
        locked: true,
        upvoteCount: true,
        replyCount: true,
        viewCount: true,
        createdAt: true,
        lastActivityAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: w.skip,
      take: PROFILE_LIST_PAGE_SIZE,
    }),
    discussionTagMap(),
  ]);
  return {
    total,
    page: w.page,
    pageCount: w.pageCount,
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      excerpt: excerptOf(r.bodyMd, 160),
      tags: tagViewsFrom(r.categories, tagMap),
      pinned: r.pinned,
      locked: r.locked,
      upvoteCount: r.upvoteCount,
      replyCount: r.replyCount,
      viewCount: r.viewCount,
      createdAt: iso(r.createdAt),
      lastActivityAt: iso(r.lastActivityAt),
    })),
  };
}

/**
 * Long videos per page. Smaller than a grid page on purpose: the block sits
 * ABOVE the shorts grid, and 24 wide cards would push the shorts off-screen.
 */
export const PROFILE_LONG_VIDEO_PAGE_SIZE = 12;

export interface ProfileVideosSection {
  shorts: CursorResult<ShortView>;
  shortsTotal: number;
  /**
   * Long-form videos (staff-curated boards), offset-paged on `?page=` with
   * their OWN pager, independent of the shorts `?cursor=` — so every video the
   * tab count (shorts + long) promises can actually be reached.
   */
  long: PagedResult<VideoCard>;
}

export async function loadVideosSection(
  v: ProfileViewer,
  cursor: string | null,
  page = 1,
): Promise<ProfileVideosSection> {
  const empty: ProfileVideosSection = { shorts: { items: [], nextCursor: null }, shortsTotal: 0, long: emptyPage() };
  if (!isSectionAllowed(v, 'videos') || !v.loggedIn) return empty;
  const uid = v.profileUserId;
  const longWhere = { ...PUBLISHED_PUBLIC, uploaderId: uid } satisfies Prisma.VideoWhereInput;
  const [shorts, shortsTotal, longTotal] = await Promise.all([
    listShorts({ uploaderId: uid, viewerId: v.gateViewerId, sort: 'new', cursor, limit: 20 }),
    prisma.video.count({ where: { ...SHORTS_PUBLIC, uploaderId: uid } }),
    prisma.video.count({ where: longWhere }),
  ]);
  const w = pageWindow(longTotal, page, PROFILE_LONG_VIDEO_PAGE_SIZE);
  const longItems =
    longTotal > 0
      ? await prisma.video.findMany({
          where: longWhere,
          select: VIDEO_CARD_SELECT,
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          skip: w.skip,
          take: PROFILE_LONG_VIDEO_PAGE_SIZE,
        })
      : [];
  return {
    shorts: { items: shorts.items.map((s) => toShortView(s, v.canSeeIdentity)), nextCursor: shorts.nextCursor },
    shortsTotal,
    long: { items: longItems, total: longTotal, page: w.page, pageCount: w.pageCount },
  };
}

export async function loadZonesSection(v: ProfileViewer, cursor: string | null): Promise<CursorResult<ZonePostCardView>> {
  if (!isSectionAllowed(v, 'zones') || !v.loggedIn) return { items: [], nextCursor: null };
  const res = await listZoneFeed({
    viewer: zoneViewerFor(v),
    authorId: v.profileUserId,
    sort: 'new',
    cursor,
    limit: PROFILE_LIST_PAGE_SIZE,
  });
  return { items: res.items, nextCursor: res.nextCursor };
}

export async function loadEventsSection(v: ProfileViewer, page: number): Promise<PagedResult<AuthoredEventItem>> {
  if (!isSectionAllowed(v, 'events')) return emptyPage();
  return listEventsByAuthor(v.profileUserId, domainViewerFor(v), { page, pageSize: PROFILE_LIST_PAGE_SIZE });
}

export async function loadVotesSection(v: ProfileViewer, page: number): Promise<PagedResult<PublicVoteCard>> {
  if (!isSectionAllowed(v, 'votes') || !v.loggedIn) return emptyPage();
  return listVoteActivitiesByCreator(v.profileUserId, domainViewerFor(v), { page, pageSize: PROFILE_GRID_PAGE_SIZE });
}

export interface ProfileFeedbackItem {
  id: string;
  title: string;
  category: 'feature' | 'bug' | 'other';
  status: 'open' | 'planned' | 'in_progress' | 'done' | 'declined';
  upvoteCount: number;
  commentCount: number;
  createdAt: string;
}

export async function loadFeedbackSection(v: ProfileViewer, page: number): Promise<PagedResult<ProfileFeedbackItem>> {
  if (!isSectionAllowed(v, 'feedback')) return emptyPage();
  const where = { authorId: v.profileUserId } satisfies Prisma.FeedbackWhereInput;
  const total = await prisma.feedback.count({ where });
  const w = pageWindow(total, page, PROFILE_LIST_PAGE_SIZE);
  const rows = await prisma.feedback.findMany({
    where,
    select: { id: true, title: true, category: true, status: true, upvoteCount: true, commentCount: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: w.skip,
    take: PROFILE_LIST_PAGE_SIZE,
  });
  return { total, page: w.page, pageCount: w.pageCount, items: rows.map((f) => ({ ...f, createdAt: iso(f.createdAt) })) };
}

async function commentSources(
  v: ProfileViewer,
  cursor: CommentCursor | null,
  take: number,
): Promise<ProfileCommentItem[][]> {
  const uid = v.profileUserId;
  const order = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  const [postComments, topicReplies, feedbackComments, docComments] = await Promise.all([
    prisma.postComment.findMany({
      where: { authorId: uid, status: 'visible', ...commentAfterWhere(cursor, 'post_comment') },
      orderBy: order,
      take,
      select: { id: true, bodyMd: true, createdAt: true, post: { select: { id: true, bodyMd: true } } },
    }),
    prisma.discussionReply.findMany({
      where: { authorId: uid, status: 'visible', ...commentAfterWhere(cursor, 'topic_reply') },
      orderBy: order,
      take,
      select: { id: true, bodyMd: true, createdAt: true, topic: { select: { id: true, title: true } } },
    }),
    prisma.feedbackComment.findMany({
      where: { authorId: uid, status: 'visible', ...commentAfterWhere(cursor, 'feedback_comment') },
      orderBy: order,
      take,
      select: { id: true, bodyMd: true, createdAt: true, feedback: { select: { id: true, title: true } } },
    }),
    v.loggedIn
      ? prisma.libraryComment.findMany({
          where: { authorId: uid, status: 'visible', doc: PUBLIC_READY_DOC, ...commentAfterWhere(cursor, 'doc_comment') },
          orderBy: order,
          take,
          select: { id: true, bodyMd: true, createdAt: true, doc: { select: { slug: true, title: true } } },
        })
      : Promise.resolve([]),
  ]);
  return [
    postComments.map((c) => ({
      key: `post_comment:${c.id}`,
      kind: 'post_comment' as const,
      id: c.id,
      excerpt: excerptOf(c.bodyMd, 160),
      contextTitle: excerptOf(c.post.bodyMd, 40),
      href: `/discussion/posts/${c.post.id}?focus=${c.id}`,
      createdAt: iso(c.createdAt),
    })),
    topicReplies.map((c) => ({
      key: `topic_reply:${c.id}`,
      kind: 'topic_reply' as const,
      id: c.id,
      excerpt: excerptOf(c.bodyMd, 160),
      contextTitle: c.topic.title,
      href: `/discussion/topics/${c.topic.id}?focus=${c.id}`,
      createdAt: iso(c.createdAt),
    })),
    feedbackComments.map((c) => ({
      key: `feedback_comment:${c.id}`,
      kind: 'feedback_comment' as const,
      id: c.id,
      excerpt: excerptOf(c.bodyMd, 160),
      contextTitle: c.feedback.title,
      href: `/feedback/${c.feedback.id}?focus=${c.id}`,
      createdAt: iso(c.createdAt),
    })),
    docComments.map((c) => ({
      key: `doc_comment:${c.id}`,
      kind: 'doc_comment' as const,
      id: c.id,
      excerpt: excerptOf(c.bodyMd, 160),
      contextTitle: c.doc.title,
      href: `/library/${c.doc.slug}?focus=${c.id}`,
      createdAt: iso(c.createdAt),
    })),
  ];
}

export async function loadCommentsSection(v: ProfileViewer, cursor: string | null): Promise<CursorResult<ProfileCommentItem>> {
  if (!isSectionAllowed(v, 'comments')) return { items: [], nextCursor: null };
  const limit = PROFILE_LIST_PAGE_SIZE;
  const lists = await commentSources(v, decodeCommentCursor(cursor), limit + 1);
  return mergeCommentPages(lists, limit);
}

export interface ProfileShelfItem {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  docType: string;
  coverUrl: string | null;
  shelvedAt: string;
}

export async function loadShelfSection(v: ProfileViewer, page: number): Promise<PagedResult<ProfileShelfItem>> {
  if (!isSectionAllowed(v, 'shelf')) return emptyPage();
  const where = { userId: v.profileUserId, doc: PUBLIC_READY_DOC } satisfies Prisma.LibraryShelfItemWhereInput;
  const total = await prisma.libraryShelfItem.count({ where });
  const w = pageWindow(total, page, PROFILE_GRID_PAGE_SIZE);
  const rows = await prisma.libraryShelfItem.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { docId: 'desc' }],
    skip: w.skip,
    take: PROFILE_GRID_PAGE_SIZE,
    select: {
      createdAt: true,
      doc: { select: { id: true, slug: true, title: true, author: true, docType: true, coverUrl: true } },
    },
  });
  return {
    total,
    page: w.page,
    pageCount: w.pageCount,
    items: rows.map((r) => ({ ...r.doc, shelvedAt: iso(r.createdAt) })),
  };
}

// ─── 最近动态 ─────────────────────────────────────────────────────────────

async function activityFor(v: ProfileViewer, s: ProfileSection, take: number): Promise<ProfileActivityItem[]> {
  const uid = v.profileUserId;
  switch (s) {
    case 'skills': {
      const rows = await prisma.skill.findMany({
        where: { authorId: uid, ...DISCOVERABLE_SKILL_WHERE },
        select: { id: true, slug: true, name: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return rows.map((r) => ({ key: `skill:${r.id}`, kind: 'skill', title: r.name, context: null, href: `/skills/${r.slug}`, at: iso(r.createdAt) }));
    }
    case 'docs': {
      const rows = await prisma.libraryDoc.findMany({
        where: { uploaderId: uid, ...BROWSABLE_DOC_WHERE },
        select: { id: true, slug: true, title: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return rows.map((r) => ({ key: `doc:${r.id}`, kind: 'doc', title: r.title, context: null, href: `/library/${r.slug}`, at: iso(r.createdAt) }));
    }
    case 'posts': {
      const rows = await prisma.post.findMany({
        where: { authorId: uid },
        select: { id: true, bodyMd: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return rows.map((r) => ({ key: `post:${r.id}`, kind: 'post', title: excerptOf(r.bodyMd, 80), context: null, href: `/discussion/posts/${r.id}`, at: iso(r.createdAt) }));
    }
    case 'topics': {
      const rows = await prisma.discussionTopic.findMany({
        where: { authorId: uid },
        select: { id: true, title: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return rows.map((r) => ({ key: `topic:${r.id}`, kind: 'topic', title: r.title, context: null, href: `/discussion/topics/${r.id}`, at: iso(r.createdAt) }));
    }
    case 'videos': {
      if (!v.loggedIn) return [];
      const [shorts, longs] = await Promise.all([
        listShorts({ uploaderId: uid, viewerId: null, sort: 'new', limit: Math.min(take, 20) }),
        prisma.video.findMany({
          where: { ...PUBLISHED_PUBLIC, uploaderId: uid },
          select: { id: true, slug: true, title: true, publishedAt: true, createdAt: true },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take,
        }),
      ]);
      return [
        ...shorts.items.map((r) => ({
          key: `short:${r.id}`,
          kind: 'short' as const,
          title: r.summary || r.title,
          context: null,
          href: `/videos/shorts?v=${r.id}`,
          at: iso(r.publishedAt ?? r.createdAt),
        })),
        ...longs.map((r) => ({
          key: `video:${r.id}`,
          kind: 'video' as const,
          title: r.title,
          context: null,
          href: `/videos/${r.slug}`,
          at: iso(r.publishedAt ?? r.createdAt),
        })),
      ];
    }
    case 'zones': {
      if (!v.loggedIn) return [];
      const res = await listZoneFeed({ viewer: zoneViewerFor(v), authorId: uid, sort: 'new', limit: take });
      return res.items.map((p) => ({
        key: `zonePost:${p.id}`,
        kind: 'zonePost',
        title: p.title,
        context: p.zone.name,
        href: zonePostHref(p.zone.slug, p.id),
        at: p.publishedAt ?? p.createdAt ?? new Date(0).toISOString(),
      }));
    }
    case 'events': {
      const res = await listEventsByAuthor(uid, domainViewerFor(v), { pageSize: take, order: 'created' });
      return res.items.map((e) => ({ key: `event:${e.id}`, kind: 'event', title: e.title, context: e.city, href: `/events/${e.id}`, at: e.createdAt }));
    }
    case 'votes': {
      if (!v.loggedIn) return [];
      const res = await listVoteActivitiesByCreator(uid, domainViewerFor(v), { pageSize: take });
      return res.items.map((a) => ({ key: `vote:${a.id}`, kind: 'vote', title: a.title, context: null, href: `/votes/${a.id}`, at: a.publishedAt ?? a.createdAt }));
    }
    case 'feedback': {
      const rows = await prisma.feedback.findMany({
        where: { authorId: uid },
        select: { id: true, title: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return rows.map((r) => ({ key: `feedback:${r.id}`, kind: 'feedback', title: r.title, context: null, href: `/feedback/${r.id}`, at: iso(r.createdAt) }));
    }
    case 'comments': {
      const lists = await commentSources(v, null, take);
      return lists.flat().map((c) => ({ key: c.key, kind: c.kind, title: c.excerpt, context: c.contextTitle, href: c.href, at: c.createdAt }));
    }
    case 'shelf': {
      const rows = await prisma.libraryShelfItem.findMany({
        where: { userId: uid, doc: PUBLIC_READY_DOC },
        orderBy: [{ createdAt: 'desc' }, { docId: 'desc' }],
        take,
        select: { createdAt: true, doc: { select: { id: true, slug: true, title: true } } },
      });
      return rows.map((r) => ({ key: `shelf:${r.doc.id}`, kind: 'shelf', title: r.doc.title, context: null, href: `/library/${r.doc.slug}`, at: iso(r.createdAt) }));
    }
  }
}

/** The 概览 timeline: the newest `take` items across every allowed section that has content. */
export async function loadRecentActivity(v: ProfileViewer, counts: SectionCounts, take = 12): Promise<ProfileActivityItem[]> {
  const sources = v.allowed.filter((s) => counts[s] > 0);
  const lists = await Promise.all(sources.map((s) => activityFor(v, s, take)));
  return mergeActivity(lists, take);
}
