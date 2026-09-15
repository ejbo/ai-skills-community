// 工作台 — the owner-only half of the merged 个人主页 (it replaced /dashboard).
//
// Every read here is scoped to ONE user's own rows (authorId / uploaderId /
// creatorId / userId = the given id). That is the whole security model: the
// owner may see all of their own drafts, private items and incoming requests,
// so no cross-viewer gate is re-derived — and nothing here may ever be called
// with another member's id on their behalf. The page decides who is the owner
// (lib/profile + app/users/[handle]/page.tsx); `WorkspaceTab` re-checks the
// session before calling in.
//
// Two traps this module exists to keep closed:
//   • The old dashboard listed subscriptions and favourites of soft-deleted
//     skills, and a favourite of someone else's skill that has since gone
//     private/unpublished. Both are filtered here (`skill.deletedAt`, and the
//     DISCOVERABLE-or-mine rule for favourites).
//   • The 工作台 tab badge (`loadWorkspaceAttentionCount`) and the 待处理 panel
//     inside the tab are computed by the SAME `loadAttention` rows, so the dot
//     on the tab can never promise work the panel does not show — and every
//     subscription it counts as outdated is merged into the 订阅 list even when
//     it is older than the list's cap.
//   • Lists are capped (a member with 300 Skills does not get 300 rows), so no
//     figure may be a `.length`: tiles and section counts come from count
//     queries (`WorkspaceTotals`), and a capped list says how much it shows.

import type { SkillVisibility, SourceType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { DISCOVERABLE_SKILL_WHERE, SKILL_CARD_SELECT } from '@/lib/skill-queries';
import { getCommentsOnMyDocs } from '@/lib/library-queries';
import { eventViewerFromSession, listEvents } from '@/lib/event-queries';
import { listVoteActivities } from '@/lib/vote-queries';
import { excerptOf, zonePostHref } from '@/lib/zones/shared';
import { eventLocalDayKey } from '@/lib/events/time';
import { toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import { can, type PermissionHolder } from '@/lib/permissions';
import type { PublicEventItem } from '@/lib/events/types';

// ─── pure helpers (unit-tested) ─────────────────────────────────────────────

/** Rows before a list folds the rest behind 展开其余 N 项. */
export const WS_FOLD = {
  skills: 6,
  docs: 6,
  subscriptions: 6,
  drafts: 6,
  votes: 5,
  upcomingEvents: 5,
} as const;
/** Past attended events shown under 已结束 (the list is about what is next). */
export const WS_PAST_EVENTS = 3;
export const WS_FAVORITES = 12;
export const WS_DOC_COMMENTS = 8;

/**
 * A subscription has an update when BOTH versions are known and differ. A
 * subscription taken before a version existed (installed null) or a skill with
 * no published version yet (current null) is not "outdated" — nagging about it
 * would be a false alarm the owner cannot clear.
 */
export function hasSubscriptionUpdate(s: {
  installedVersionId: string | null;
  currentVersionId: string | null;
}): boolean {
  return Boolean(s.installedVersionId && s.currentVersionId && s.installedVersionId !== s.currentVersionId);
}

export interface AttentionCounts {
  subscriptionUpdates: number;
  skillRequests: number;
  docRequests: number;
  voteSubmissions: number;
}

export function attentionTotal(c: AttentionCounts): number {
  return c.subscriptionUpdates + c.skillRequests + c.docRequests + c.voteSubmissions;
}

/** Split a list into what renders inline and what folds behind the disclosure. */
export function foldList<T>(items: readonly T[], visible: number): { shown: T[]; rest: T[] } {
  const n = Math.max(0, Math.floor(visible));
  return { shown: items.slice(0, n), rest: items.slice(n) };
}

export type WsVoteState = 'draft' | 'soon' | 'live' | 'over';

/** One state per activity row — the same precedence VoteCard's cover chip uses. */
export function voteRowState(v: { status: 'draft' | 'published'; over: boolean; started: boolean; startAt: string | null }): WsVoteState {
  if (v.status === 'draft') return 'draft';
  if (v.over) return 'over';
  if (!v.started && v.startAt) return 'soon';
  return 'live';
}

export type WsDraftKind = 'skill' | 'zonePost' | 'vote';

/**
 * 草稿箱 = every unpublished thing the owner started, across the three
 * surfaces that HAVE drafts (Skill · 专区帖子 · 投票活动), newest edit first.
 * Ties keep input order so a render is deterministic.
 */
export function mergeDrafts<T extends { updatedAt: Date }>(...groups: readonly (readonly T[])[]): T[] {
  return groups
    .flat()
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.updatedAt.getTime() - a.r.updatedAt.getTime() || a.i - b.i)
    .map((x) => x.r);
}

/** Updates first (what needs doing), then newest subscription — stable otherwise. */
export function sortSubscriptions<T extends { hasUpdate: boolean }>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(b.r.hasUpdate) - Number(a.r.hasUpdate) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * The capped (newest-first) subscription rows plus the outdated ones that fell
 * outside the cap, appended — they are older than every capped row, so after
 * `sortSubscriptions` the newest update still leads. Deduped by skill.
 */
export function unionSubscriptionRows<T extends { skillId: string }>(capped: readonly T[], outdated: readonly T[]): T[] {
  const seen = new Set(capped.map((r) => r.skillId));
  const out = [...capped];
  for (const r of outdated) {
    if (seen.has(r.skillId)) continue;
    seen.add(r.skillId);
    out.push(r);
  }
  return out;
}

/** `groupBy({ by: ['status'] })` rows → per-status counts + the total. */
export function tallyByStatus<S extends string>(
  groups: readonly { status: S; _count: { _all: number } }[],
): { total: number; by: Partial<Record<S, number>> } {
  const by: Partial<Record<S, number>> = {};
  let total = 0;
  for (const g of groups) {
    by[g.status] = (by[g.status] ?? 0) + g._count._all;
    total += g._count._all;
  }
  return { total, by };
}

// ─── view types (server-rendered only; Dates stay Dates) ────────────────────

export type WsSkillStatus = 'draft' | 'published' | 'archived';
export type WsDocStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface WsSkillRow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  status: WsSkillStatus;
  visibility: SkillVisibility;
  sourceType: SourceType;
  version: string | null;
  downloads: number;
  likes: number;
  updatedAt: Date;
  pendingRequests: number;
}

export interface WsDocRow {
  id: string;
  slug: string;
  title: string;
  docType: string;
  coverUrl: string | null;
  status: WsDocStatus;
  visibility: 'public' | 'restricted' | 'private';
  shelfCount: number;
  viewCount: number;
  commentCount: number;
  ratingCount: number;
  avgRating: number;
  createdAt: Date;
  pendingRequests: number;
}

export interface WsSubscriptionRow {
  skillId: string;
  slug: string;
  name: string;
  sourceType: SourceType;
  authorName: string;
  installed: string | null;
  latest: string | null;
  hasUpdate: boolean;
}

export interface WsFavoriteRow {
  slug: string;
  name: string;
  summary: string;
  sourceType: SourceType;
  visibility: SkillVisibility;
  author: { handle: string; displayName: string; avatarUrl: string | null };
  updatedAt: Date;
  stats: { downloads: number; likes: number; rating: number; reviewCount: number; tokens: number };
}

export interface WsDraftRow {
  kind: WsDraftKind;
  id: string;
  /** '' ⇒ the view shows 无标题草稿. */
  title: string;
  updatedAt: Date;
  /** Where the draft is continued: skill manage page / post editor / vote editor. */
  href: string;
  /** zonePost only — the 版块 it will be published in. */
  zone: { slug: string; name: string; iconUrl: string | null; themeColor: string | null } | null;
}

export interface WsVoteRow {
  id: string;
  title: string;
  coverUrl: string | null;
  state: WsVoteState;
  entryCount: number;
  voterCount: number;
  pendingSubmissions: number;
  createdAt: string;
}

export interface WsEventRow {
  event: PublicEventItem;
  /** Event-local wall date `YYYY-MM-DD` (the events board groups on the same key). */
  dayKey: string;
}

export interface WsDocCommentRow {
  id: string;
  excerpt: string;
  createdAt: Date;
  author: PublicAuthor;
  doc: { slug: string; title: string };
}

export interface WsAttentionItem<K extends string> {
  kind: K;
  /** skill slug / doc slug / vote id — whatever the handling surface is keyed on. */
  ref: string;
  title: string;
  count: number;
}

export interface WorkspaceAttention extends AttentionCounts {
  skills: WsAttentionItem<'skill'>[];
  docs: WsAttentionItem<'doc'>[];
  votes: WsAttentionItem<'vote'>[];
}

/** Real totals for the tiles and section headers — never the length of a capped list. */
export interface WorkspaceTotals {
  skills: number;
  skillsPublished: number;
  docs: number;
  docsReady: number;
  /** pending + processing. */
  docsProcessing: number;
  subscriptions: number;
  drafts: number;
}

export interface WorkspaceData {
  attention: WorkspaceAttention;
  totals: WorkspaceTotals;
  skills: WsSkillRow[];
  docs: WsDocRow[];
  subscriptions: WsSubscriptionRow[];
  favorites: WsFavoriteRow[];
  favoriteTotal: number;
  drafts: WsDraftRow[];
  draftCounts: Record<WsDraftKind, number>;
  votes: WsVoteRow[];
  voteTotal: number;
  upcomingEvents: WsEventRow[];
  upcomingEventTotal: number;
  pastEvents: WsEventRow[];
  docComments: WsDocCommentRow[];
}

// ─── queries ────────────────────────────────────────────────────────────────

/**
 * An activity still collecting: not deleted, not closed early, no deadline or
 * a future one. Submissions left pending on a finished activity can no longer
 * change anything the voters see, so they stop counting as 待处理 — otherwise
 * the tab badge would nag forever about a vote that ended last year.
 */
function openActivityWhere(userId: string, now: Date) {
  return {
    creatorId: userId,
    deletedAt: null,
    closedAt: null,
    OR: [{ endAt: null }, { endAt: { gt: now } }],
  };
}

/** Newest subscriptions listed inline; outdated ones beyond it are merged in. */
const WS_SUBSCRIPTION_CAP = 100;

/** A subscription of a skill that still exists (the old dashboard listed deleted ones). */
function subscriptionWhere(userId: string) {
  return { userId, skill: { deletedAt: null } };
}

const SUBSCRIPTION_ROW_SELECT = {
  skillId: true,
  installedVersionId: true,
  installedVersion: { select: { version: true } },
  skill: {
    select: {
      slug: true,
      name: true,
      sourceType: true,
      currentVersionId: true,
      currentVersion: { select: { version: true } },
      author: { select: { displayName: true } },
    },
  },
} as const;

/**
 * The 待处理 rows, grouped per item so the panel can link each one to where it
 * is handled. Four small indexed reads; the subscription one is filtered in JS
 * because Prisma cannot compare two columns (installed vs current version).
 */
async function loadAttention(userId: string): Promise<WorkspaceAttention & { outdatedSkillIds: string[] }> {
  const now = new Date();
  const [subs, skillGroups, docGroups, voteGroups] = await Promise.all([
    prisma.subscription.findMany({
      where: { userId, installedVersionId: { not: null }, skill: { deletedAt: null, currentVersionId: { not: null } } },
      select: { skillId: true, installedVersionId: true, skill: { select: { currentVersionId: true } } },
    }),
    prisma.skillAccessRequest.groupBy({
      by: ['skillId'],
      where: { status: 'pending', skill: { authorId: userId, deletedAt: null } },
      _count: { _all: true },
    }),
    prisma.libraryAccessRequest.groupBy({
      by: ['docId'],
      where: { status: 'pending', doc: { uploaderId: userId, deletedAt: null } },
      _count: { _all: true },
    }),
    prisma.voteEntry.groupBy({
      by: ['activityId'],
      where: { status: 'pending', activity: openActivityWhere(userId, now) },
      _count: { _all: true },
    }),
  ]);

  const outdatedSkillIds = subs
    .filter((s) =>
      hasSubscriptionUpdate({ installedVersionId: s.installedVersionId, currentVersionId: s.skill.currentVersionId }),
    )
    .map((s) => s.skillId);
  const subscriptionUpdates = outdatedSkillIds.length;

  // Titles for the grouped ids (only the rows that actually have work).
  const [skillRows, docRows, voteRows] = await Promise.all([
    skillGroups.length
      ? prisma.skill.findMany({
          where: { id: { in: skillGroups.map((g) => g.skillId) }, authorId: userId },
          select: { id: true, slug: true, name: true },
        })
      : [],
    docGroups.length
      ? prisma.libraryDoc.findMany({
          where: { id: { in: docGroups.map((g) => g.docId) }, uploaderId: userId },
          select: { id: true, slug: true, title: true },
        })
      : [],
    voteGroups.length
      ? prisma.voteActivity.findMany({
          where: { id: { in: voteGroups.map((g) => g.activityId) }, creatorId: userId },
          select: { id: true, title: true },
        })
      : [],
  ]);

  const byCountDesc = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  const skillMap = new Map(skillRows.map((r) => [r.id, r]));
  const docMap = new Map(docRows.map((r) => [r.id, r]));
  const voteMap = new Map(voteRows.map((r) => [r.id, r]));

  const skills = skillGroups
    .flatMap((g) => {
      const s = skillMap.get(g.skillId);
      return s ? [{ kind: 'skill' as const, ref: s.slug, title: s.name, count: g._count._all }] : [];
    })
    .sort(byCountDesc);
  const docs = docGroups
    .flatMap((g) => {
      const d = docMap.get(g.docId);
      return d ? [{ kind: 'doc' as const, ref: d.slug, title: d.title, count: g._count._all }] : [];
    })
    .sort(byCountDesc);
  const votes = voteGroups
    .flatMap((g) => {
      const v = voteMap.get(g.activityId);
      return v ? [{ kind: 'vote' as const, ref: v.id, title: v.title, count: g._count._all }] : [];
    })
    .sort(byCountDesc);

  const sum = (xs: { count: number }[]) => xs.reduce((n, x) => n + x.count, 0);
  return {
    subscriptionUpdates,
    outdatedSkillIds,
    skillRequests: sum(skills),
    docRequests: sum(docs),
    voteSubmissions: sum(votes),
    skills,
    docs,
    votes,
  };
}

/** Items needing the owner's attention: subscription updates + pending access requests (+ open vote submissions to review). */
export async function loadWorkspaceAttentionCount(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    return attentionTotal(await loadAttention(userId));
  } catch (err) {
    // A badge must never take the profile page down with it.
    console.error('[workspace] attention count failed', err);
    return 0;
  }
}

/**
 * Everything the 工作台 tab renders, in one parallel pass. `viewer` is the
 * session user and MUST be the owner (`viewer.id === userId`) — callers check;
 * it is taken only so the domain helpers that shape rows for a viewer (events,
 * votes) and the comment-author trim see the real permission set.
 */
export async function loadWorkspaceData(
  userId: string,
  viewer: { id: string } & PermissionHolder,
): Promise<WorkspaceData> {
  const canSeeIdentity = can(viewer, 'identity');
  const eventViewer = eventViewerFromSession({ user: viewer });
  // `canManage` stays false on purpose: the owner's own activities are theirs
  // by `creatorId`, and a staff permission must not turn "我发起的" into
  // "everything I could manage".
  const voteViewer = { id: userId, canManage: false, canSeeIdentity };

  const zoneDraftWhere = {
    status: 'draft' as const,
    deletedAt: null,
    zone: { deletedAt: null },
    OR: [{ authorId: userId }, { coauthors: { some: { userId } } }],
  };
  const voteDraftWhere = { creatorId: userId, deletedAt: null, status: 'draft' as const };

  const [
    { outdatedSkillIds, ...attention },
    skillRows,
    docRows,
    subRows,
    favRows,
    favoriteTotal,
    zoneDraftRows,
    voteDraftRows,
    voteList,
    upcoming,
    past,
    comments,
    skillStatus,
    docStatus,
    subscriptionTotal,
    zoneDraftTotal,
    voteDraftTotal,
  ] = await Promise.all([
    loadAttention(userId),
    prisma.skill.findMany({
      where: { authorId: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        slug: true,
        name: true,
        summary: true,
        status: true,
        visibility: true,
        sourceType: true,
        downloadCount: true,
        likeCount: true,
        updatedAt: true,
        currentVersion: { select: { version: true } },
      },
    }),
    prisma.libraryDoc.findMany({
      where: { uploaderId: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        slug: true,
        title: true,
        docType: true,
        coverUrl: true,
        status: true,
        visibility: true,
        shelfCount: true,
        viewCount: true,
        commentCount: true,
        ratingCount: true,
        avgRating: true,
        createdAt: true,
      },
    }),
    prisma.subscription.findMany({
      where: subscriptionWhere(userId),
      orderBy: { createdAt: 'desc' },
      take: WS_SUBSCRIPTION_CAP,
      select: SUBSCRIPTION_ROW_SELECT,
    }),
    prisma.favorite.findMany({
      where: { userId, skill: favoriteSkillWhere(userId) },
      orderBy: { createdAt: 'desc' },
      take: WS_FAVORITES,
      select: { skill: { select: SKILL_CARD_SELECT } },
    }),
    prisma.favorite.count({ where: { userId, skill: favoriteSkillWhere(userId) } }),
    prisma.zonePost.findMany({
      where: zoneDraftWhere,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        zone: { select: { slug: true, name: true, iconUrl: true, themeColor: true } },
      },
    }),
    // listVoteActivities carries no updatedAt, and a draft is ordered by when it was last touched.
    prisma.voteActivity.findMany({
      where: voteDraftWhere,
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    }),
    listVoteActivities('mine', voteViewer, 1),
    listEvents({ tab: 'upcoming', mineFor: userId }, eventViewer, 1),
    listEvents({ tab: 'past', mineFor: userId }, eventViewer, 1),
    getCommentsOnMyDocs(userId, WS_DOC_COMMENTS),
    // Totals: one grouped count per capped list (see the header).
    prisma.skill.groupBy({ by: ['status'], where: { authorId: userId, deletedAt: null }, _count: { _all: true } }),
    prisma.libraryDoc.groupBy({ by: ['status'], where: { uploaderId: userId, deletedAt: null }, _count: { _all: true } }),
    prisma.subscription.count({ where: subscriptionWhere(userId) }),
    prisma.zonePost.count({ where: zoneDraftWhere }),
    prisma.voteActivity.count({ where: voteDraftWhere }),
  ]);

  // An outdated subscription older than the cap is still in the list: the tab
  // badge and the 待处理 row both point at #ws-subscriptions.
  const listed = new Set(subRows.map((r) => r.skillId));
  const missingOutdated = outdatedSkillIds.filter((id) => !listed.has(id));
  const outdatedRows = missingOutdated.length
    ? await prisma.subscription.findMany({
        where: { ...subscriptionWhere(userId), skillId: { in: missingOutdated } },
        orderBy: { createdAt: 'desc' },
        select: SUBSCRIPTION_ROW_SELECT,
      })
    : [];
  const skillTally = tallyByStatus(skillStatus);
  const docTally = tallyByStatus(docStatus);

  const skillPending = new Map(attention.skills.map((i) => [i.ref, i.count]));
  const docPending = new Map(attention.docs.map((i) => [i.ref, i.count]));
  const votePending = new Map(attention.votes.map((i) => [i.ref, i.count]));

  const subscriptions = sortSubscriptions(
    unionSubscriptionRows(subRows, outdatedRows).map((s) => ({
      skillId: s.skillId,
      slug: s.skill.slug,
      name: s.skill.name,
      sourceType: s.skill.sourceType,
      authorName: s.skill.author.displayName,
      installed: s.installedVersion?.version ?? null,
      latest: s.skill.currentVersion?.version ?? null,
      hasUpdate: hasSubscriptionUpdate({
        installedVersionId: s.installedVersionId,
        currentVersionId: s.skill.currentVersionId,
      }),
    })),
  );

  const skillDrafts = skillRows.filter((s) => s.status === 'draft');

  const toEventRow = (event: PublicEventItem): WsEventRow => ({
    event,
    dayKey: eventLocalDayKey(event.startAt, event.timezone, event.allDay),
  });

  const draftCounts = { skill: skillTally.by.draft ?? 0, zonePost: zoneDraftTotal, vote: voteDraftTotal };

  return {
    attention,
    totals: {
      skills: skillTally.total,
      skillsPublished: skillTally.by.published ?? 0,
      docs: docTally.total,
      docsReady: docTally.by.ready ?? 0,
      docsProcessing: (docTally.by.pending ?? 0) + (docTally.by.processing ?? 0),
      subscriptions: subscriptionTotal,
      drafts: draftCounts.skill + draftCounts.zonePost + draftCounts.vote,
    },
    skills: skillRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      summary: s.summary,
      status: s.status,
      visibility: s.visibility,
      sourceType: s.sourceType,
      version: s.currentVersion?.version ?? null,
      downloads: s.downloadCount,
      likes: s.likeCount,
      updatedAt: s.updatedAt,
      pendingRequests: skillPending.get(s.slug) ?? 0,
    })),
    docs: docRows.map((d) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
      docType: d.docType,
      coverUrl: d.coverUrl,
      status: d.status,
      visibility: d.visibility,
      shelfCount: d.shelfCount,
      viewCount: d.viewCount,
      commentCount: d.commentCount,
      ratingCount: d.ratingCount,
      avgRating: d.avgRating,
      createdAt: d.createdAt,
      pendingRequests: docPending.get(d.slug) ?? 0,
    })),
    subscriptions,
    favorites: favRows.map(({ skill: s }) => ({
      slug: s.slug,
      name: s.name,
      summary: s.summary,
      sourceType: s.sourceType,
      visibility: s.visibility,
      author: s.author,
      updatedAt: s.updatedAt,
      stats: {
        downloads: s.downloadCount,
        likes: s.likeCount,
        rating: s.avgRating,
        reviewCount: s.reviewCount,
        tokens: s.tokenCostEstimate,
      },
    })),
    favoriteTotal,
    drafts: mergeDrafts<WsDraftRow>(
      skillDrafts.map((s) => ({
        kind: 'skill',
        id: s.id,
        title: s.name,
        updatedAt: s.updatedAt,
        href: `/skills/${s.slug}/manage`,
        zone: null,
      })),
      zoneDraftRows.map((p) => ({
        kind: 'zonePost',
        id: p.id,
        title: p.title,
        updatedAt: p.updatedAt,
        href: `${zonePostHref(p.zone.slug, p.id)}/edit`,
        zone: p.zone,
      })),
      voteDraftRows.map((v) => ({
        kind: 'vote',
        id: v.id,
        title: v.title,
        updatedAt: v.updatedAt,
        href: `/votes/${v.id}/edit`,
        zone: null,
      })),
    ),
    draftCounts,
    votes: voteList.items.map((v) => ({
      id: v.id,
      title: v.title,
      coverUrl: v.coverUrl,
      state: voteRowState(v),
      entryCount: v.entryCount,
      voterCount: v.voterCount,
      pendingSubmissions: votePending.get(v.id) ?? 0,
      createdAt: v.createdAt,
    })),
    voteTotal: voteList.total,
    upcomingEvents: upcoming.items.map(toEventRow),
    upcomingEventTotal: upcoming.total,
    pastEvents: past.items.slice(0, WS_PAST_EVENTS).map(toEventRow),
    docComments: comments.map((c) => ({
      id: c.id,
      excerpt: excerptOf(c.bodyMd, 140),
      createdAt: c.createdAt,
      // The owner is not automatically an `identity` holder: a 隐私账号
      // commenter's 部门 stays trimmed here exactly as on the doc page.
      author: toPublicAuthor(c.author, canSeeIdentity),
      doc: c.doc,
    })),
  };
}

/**
 * Favourites worth showing: not deleted, and either discoverable or the
 * owner's own. A favourite of someone else's skill that later went private or
 * back to draft would only 404 on click.
 */
function favoriteSkillWhere(userId: string) {
  return {
    OR: [{ ...DISCOVERABLE_SKILL_WHERE }, { authorId: userId, deletedAt: null }],
  };
}

