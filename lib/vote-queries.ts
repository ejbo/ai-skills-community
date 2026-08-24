// 投票活动 query layer — ALL reads live here (lib/event-queries.ts pattern).
// Every query filters deletedAt: null in one place; results visibility and
// identity trimming happen SERVER-side (counts/authors omitted from payloads,
// never shipped-then-hidden).

import type { Prisma } from '@prisma/client';
import type { Session } from 'next-auth';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import { domainViewer, type DomainViewer } from '@/lib/permissions';
import {
  competitionRanks,
  parseCustomFields,
  seededShuffle,
  voteDayKey,
  voteOver,
  voteStarted,
  votingOpen,
  type VoteCustomField,
} from '@/lib/votes/shared';

export const VOTE_PAGE_SIZE = 24;
export const MAX_FEATURED_VOTES = 6;

/** `canManage` = `votes` permission (creator-level power over ANY activity); `canSeeIdentity` = `identity`. */
export type VoteViewer = DomainViewer;

export function voteViewerFromSession(session: Session | null): VoteViewer {
  return domainViewer(session?.user, 'votes');
}

const BASE_WHERE: Prisma.VoteActivityWhereInput = { deletedAt: null };

export type VoteTab = 'active' | 'ended' | 'mine';

// ─── Hub cards ──────────────────────────────────────────────────────────────

export interface PublicVoteCard {
  id: string;
  title: string;
  coverUrl: string | null; // stored cover or first-entry thumb (root-relative)
  coverIsVideo: boolean; // thumb came from a video entry without poster
  status: 'draft' | 'published';
  startAt: string | null;
  endAt: string | null;
  closedAt: string | null;
  over: boolean;
  started: boolean;
  entryCount: number;
  voterCount: number;
  voteCount: number | null; // null when results are hidden for this viewer
  featured: boolean;
  isMine: boolean;
  creator: PublicAuthor;
  createdAt: string;
  winnerThumbUrl: string | null; // ended + results visible only
}

type ActivityRow = Prisma.VoteActivityGetPayload<{
  include: {
    creator: typeof AUTHOR_IDENTITY_SELECT;
    entries: {
      select: { fileUrl: true; posterUrl: true; kind: true };
      where: { hidden: false; status: 'approved' };
      orderBy: { entryNo: 'asc' };
      take: 1;
    };
  };
}>;

function resultsVisibleFor(
  row: { resultsMode: string; endAt: Date | null; closedAt: Date | null; creatorId: string },
  startAt: Date | null,
  viewer: VoteViewer,
): boolean {
  const isOwner = viewer.canManage || viewer.id === row.creatorId;
  if (isOwner) return true;
  if (row.resultsMode === 'realtime') return true;
  const over = voteOver({ startAt, endAt: row.endAt, closedAt: row.closedAt });
  return over && row.resultsMode !== 'creator_only';
}

function toVoteCard(row: ActivityRow, viewer: VoteViewer, winnerThumbUrl: string | null = null): PublicVoteCard {
  const over = voteOver(row);
  const resultsVisible = resultsVisibleFor(row, row.startAt, viewer);
  const first = row.entries[0] ?? null;
  const fallbackThumb = first ? (first.kind === 'video' ? first.posterUrl : first.fileUrl) : null;
  return {
    id: row.id,
    title: row.title,
    coverUrl: row.coverUrl ?? fallbackThumb,
    coverIsVideo: !row.coverUrl && first?.kind === 'video' && !first.posterUrl,
    status: row.status,
    startAt: row.startAt?.toISOString() ?? null,
    endAt: row.endAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    over,
    started: voteStarted(row),
    entryCount: row.entryCount,
    voterCount: row.voterCount,
    voteCount: resultsVisible ? row.voteCount : null,
    featured: row.featured,
    isMine: Boolean(viewer.id) && viewer.id === row.creatorId,
    creator: toPublicAuthor(row.creator, viewer.canSeeIdentity),
    createdAt: row.createdAt.toISOString(),
    winnerThumbUrl: resultsVisible && over ? winnerThumbUrl : null,
  };
}

const CARD_INCLUDE = {
  creator: AUTHOR_IDENTITY_SELECT,
  entries: {
    select: { fileUrl: true, posterUrl: true, kind: true },
    where: { hidden: false as const, status: 'approved' as const },
    orderBy: { entryNo: 'asc' as const },
    take: 1,
  },
} satisfies Prisma.VoteActivityInclude;

/** Winner (top-voted, non-hidden) entry thumb per activity, one query. */
async function winnerThumbsFor(activityIds: string[]): Promise<Map<string, string>> {
  if (activityIds.length === 0) return new Map();
  const rows = await prisma.voteEntry.findMany({
    where: { activityId: { in: activityIds }, hidden: false, status: 'approved' },
    orderBy: [{ voteCount: 'desc' }, { entryNo: 'asc' }],
    distinct: ['activityId'],
    select: { activityId: true, fileUrl: true, posterUrl: true, kind: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) {
    const thumb = r.kind === 'video' ? r.posterUrl : r.fileUrl;
    if (thumb) map.set(r.activityId, thumb);
  }
  return map;
}

export interface VoteListResult {
  items: PublicVoteCard[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listVoteActivities(
  tab: VoteTab,
  viewer: VoteViewer,
  page = 1,
): Promise<VoteListResult> {
  const now = new Date();
  let where: Prisma.VoteActivityWhereInput;
  let orderBy: Prisma.VoteActivityOrderByWithRelationInput[];

  if (tab === 'mine') {
    if (!viewer.id) return { items: [], total: 0, page: 1, pageCount: 1 };
    where = { ...BASE_WHERE, creatorId: viewer.id };
    orderBy = [{ createdAt: 'desc' }];
  } else if (tab === 'ended') {
    where = {
      ...BASE_WHERE,
      status: 'published',
      OR: [{ closedAt: { not: null } }, { endAt: { lte: now } }],
    };
    orderBy = [
      { closedAt: { sort: 'desc', nulls: 'last' } },
      { endAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
    ];
  } else {
    // active: published and not over (即将开始 included, badge 由 started 区分).
    where = {
      ...BASE_WHERE,
      status: 'published',
      closedAt: null,
      OR: [{ endAt: null }, { endAt: { gt: now } }],
    };
    orderBy = [{ endAt: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }];
  }

  const total = await prisma.voteActivity.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / VOTE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const rows = await prisma.voteActivity.findMany({
    where,
    orderBy,
    skip: (safePage - 1) * VOTE_PAGE_SIZE,
    take: VOTE_PAGE_SIZE,
    include: CARD_INCLUDE,
  });

  // Winner thumbs only for rows that are over AND results-visible to this viewer.
  const winnerIds = rows
    .filter((r) => voteOver(r) && resultsVisibleFor(r, r.startAt, viewer))
    .map((r) => r.id);
  const winners = await winnerThumbsFor(winnerIds);

  return {
    items: rows.map((r) => toVoteCard(r, viewer, winners.get(r.id) ?? null)),
    total,
    page: safePage,
    pageCount,
  };
}

/** Admin-featured published votes for the hub's 精选 band (newest featured first). */
export async function listFeaturedVoteActivities(viewer: VoteViewer): Promise<PublicVoteCard[]> {
  const rows = await prisma.voteActivity.findMany({
    where: { ...BASE_WHERE, status: 'published', featured: true },
    orderBy: [{ featuredAt: 'desc' }],
    take: MAX_FEATURED_VOTES,
    include: CARD_INCLUDE,
  });
  const winnerIds = rows
    .filter((r) => voteOver(r) && resultsVisibleFor(r, r.startAt, viewer))
    .map((r) => r.id);
  const winners = await winnerThumbsFor(winnerIds);
  return rows.map((r) => toVoteCard(r, viewer, winners.get(r.id) ?? null));
}

// ─── Detail view ────────────────────────────────────────────────────────────

export interface VoteEntryView {
  id: string;
  entryNo: number;
  kind: 'image' | 'video';
  fileUrl: string;
  posterUrl: string | null;
  posterAspect: 'landscape' | 'portrait'; // 卡片版式（横版 4:3 / 竖版 3:4）
  posterPos: string; // '' 居中 | 'contain' 完整显示 | '50% 30%' 选区
  mimeType: string;
  durationSec: number;
  title: string | null; // null = hidden by showTitles for this viewer
  description: string | null; // 作品描述 — gated with titles (作品自述属于展示信息)
  customAnswers: { id: string; label: string; value: string }[] | null; // 自定义表单答案（同上）
  authorName: string | null; // null = hidden by showAuthors (匿名评选) for this viewer
  authorNo: string | null;
  voteCount: number | null; // null = results hidden for this viewer
  rank: number | null; // competition rank, only when results visible
  commentCount: number;
  myVotes: number; // my votes on this entry in the CURRENT budget bucket
}

export type VoteFormFieldMode = 'required' | 'optional' | 'off';

/** The viewer's own submissions (all statuses — pending/rejected are theirs to see). */
export interface VoteMySubmission {
  id: string;
  entryNo: number;
  kind: 'image' | 'video';
  fileUrl: string;
  posterUrl: string | null;
  title: string;
  status: 'approved' | 'pending' | 'rejected';
  reviewNote: string;
  voteCount: number | null; // gated exactly like the gallery
  createdAt: string;
}

export interface VoteActivityView {
  id: string;
  title: string;
  descriptionMd: string;
  announcement: string;
  coverUrl: string | null;
  status: 'draft' | 'published';
  publishedAt: string | null;
  startAt: string | null;
  endAt: string | null;
  closedAt: string | null;
  votesPerUser: number;
  budgetPeriod: 'total' | 'daily';
  maxPerEntry: number;
  allowRevoke: boolean;
  resultsMode: 'realtime' | 'after_end' | 'creator_only';
  showTitles: boolean;
  showAuthors: boolean;
  entryOrder: 'random' | 'upload' | 'votes';
  featured: boolean;
  over: boolean;
  started: boolean;
  open: boolean; // votingOpen for this instant
  resultsVisible: boolean;
  authorsVisible: boolean;
  titlesVisible: boolean;
  entryCount: number;
  voterCount: number;
  voteCount: number | null;
  creator: PublicAuthor;
  isOwner: boolean; // creator or admin — sees hidden info + manage entry points
  isCreator: boolean;
  entries: VoteEntryView[];
  // ── 成员投稿 ──
  allowSubmissions: boolean;
  submissionReview: boolean;
  submissionMedia: 'image' | 'video' | 'both';
  maxSubmissionsPerUser: number;
  maxSubmissionMb: number | null;
  submitTitle: VoteFormFieldMode;
  submitAuthorName: VoteFormFieldMode;
  submitAuthorNo: VoteFormFieldMode;
  submitDescription: VoteFormFieldMode;
  customFields: VoteCustomField[]; // 自定义投稿表单字段定义
  submissionNote: string;
  allowComments: boolean;
  // 投稿窗口 = published 且未结束（startAt 只挡投票 ⇒ 先征集后投票天然成立）。
  submissionsOpen: boolean;
  mySubmissions: VoteMySubmission[];
  viewer: {
    id: string | null; // the viewer's own id (draft-ballot storage key; never another user's)
    loggedIn: boolean;
    // 投票要求华为 W3 身份（SSO 部署下）；密码账号只能围观。
    canVote: boolean;
    budgetUsed: number;
    budgetRemaining: number;
    dayKey: string;
    displayName: string; // 投稿表单预填
    authorNo: string; // huaweiW3Id（小写）— 投稿时锁定为本人，不可改
    submissionCount: number; // 非 rejected 的投稿数（配额口径）
  };
}

/**
 * Full gallery payload for /votes/[id]. Null when missing/deleted, or a draft
 * viewed by someone other than the creator/admin.
 */
export async function getVoteActivityView(
  id: string,
  viewer: VoteViewer,
): Promise<VoteActivityView | null> {
  const row = await prisma.voteActivity.findUnique({
    where: { id },
    include: { creator: AUTHOR_IDENTITY_SELECT },
  });
  if (!row || row.deletedAt) return null;
  const isCreator = Boolean(viewer.id) && viewer.id === row.creatorId;
  const isOwner = isCreator || viewer.canManage;
  if (row.status === 'draft' && !isOwner) return null;

  const over = voteOver(row);
  const started = voteStarted(row);
  const open = votingOpen(row.status, row);
  const resultsVisible = isOwner || row.resultsMode === 'realtime' || (over && row.resultsMode !== 'creator_only');
  const titlesVisible = row.showTitles || isOwner;
  const authorsVisible = row.showAuthors || over || isOwner;

  const entryRows = await prisma.voteEntry.findMany({
    where: { activityId: row.id, hidden: false, status: 'approved' },
    orderBy: { entryNo: 'asc' },
    select: {
      id: true,
      entryNo: true,
      kind: true,
      fileUrl: true,
      posterUrl: true,
      posterAspect: true,
      posterPos: true,
      mimeType: true,
      durationSec: true,
      title: true,
      description: true,
      formData: true,
      authorName: true,
      authorNo: true,
      voteCount: true,
      commentCount: true,
    },
  });

  const fieldDefs = parseCustomFields(row.submissionFields) ?? [];
  const answersFor = (formData: unknown): { id: string; label: string; value: string }[] => {
    if (!formData || typeof formData !== 'object' || fieldDefs.length === 0) return [];
    const data = formData as Record<string, unknown>;
    const out: { id: string; label: string; value: string }[] = [];
    for (const f of fieldDefs) {
      const v = typeof data[f.id] === 'string' ? (data[f.id] as string) : '';
      if (v) out.push({ id: f.id, label: f.label, value: v });
    }
    return out;
  };

  const dayKey = voteDayKey(row.budgetPeriod);
  let myBallots = new Map<string, number>();
  let budgetUsed = 0;
  if (viewer.id) {
    const ballots = await prisma.voteBallot.findMany({
      where: { activityId: row.id, userId: viewer.id, day: dayKey },
      select: { entryId: true, count: true },
    });
    myBallots = new Map(ballots.map((b) => [b.entryId, b.count]));
    budgetUsed = ballots.reduce((sum, b) => sum + b.count, 0);
  }

  // 成员投稿: the viewer's own rows (all statuses) + profile prefill for the
  // submit form. Fetched whenever the viewer is logged in — turning
  // allowSubmissions off later must NOT hide members' existing pending/rejected
  // rows (or their withdraw entry point).
  const resultsVisiblePre =
    isOwner || row.resultsMode === 'realtime' || (over && row.resultsMode !== 'creator_only');
  let mySubmissions: VoteMySubmission[] = [];
  let submissionCount = 0;
  let profileName = '';
  let profileNo = '';
  if (viewer.id) {
    const [subs, profile] = await Promise.all([
      prisma.voteEntry.findMany({
        where: { activityId: row.id, submitterId: viewer.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          entryNo: true,
          kind: true,
          fileUrl: true,
          posterUrl: true,
          title: true,
          status: true,
          reviewNote: true,
          voteCount: true,
          createdAt: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: viewer.id },
        select: { displayName: true, huaweiW3Id: true },
      }),
    ]);
    mySubmissions = subs.map((s) => ({
      id: s.id,
      entryNo: s.entryNo,
      kind: s.kind,
      fileUrl: s.fileUrl,
      posterUrl: s.posterUrl,
      title: s.title,
      status: s.status,
      reviewNote: s.reviewNote,
      voteCount: resultsVisiblePre ? s.voteCount : null,
      createdAt: s.createdAt.toISOString(),
    }));
    submissionCount = subs.filter((s) => s.status !== 'rejected').length;
    profileName = profile?.displayName ?? '';
    profileNo = (profile?.huaweiW3Id ?? '').toLowerCase();
  }

  // Ranks from the authoritative counts (only meaningful when visible).
  const byVotes = entryRows.slice().sort((a, b) => b.voteCount - a.voteCount || a.entryNo - b.entryNo);
  const ranks = competitionRanks(byVotes.map((e) => e.voteCount));
  const rankById = new Map(byVotes.map((e, i) => [e.id, ranks[i]]));

  // Display order: results state sorts by votes; otherwise the creator's pick,
  // with 随机 seeded per viewer (stable across reloads, distinct across users).
  let ordered = entryRows;
  if (over && resultsVisible) {
    ordered = byVotes;
  } else if (row.entryOrder === 'votes' && resultsVisible) {
    ordered = byVotes;
  } else if (row.entryOrder === 'random') {
    ordered = seededShuffle(entryRows, `${viewer.id ?? 'anon'}:${row.id}`);
  }

  const entries: VoteEntryView[] = ordered.map((e) => ({
    id: e.id,
    entryNo: e.entryNo,
    kind: e.kind,
    fileUrl: e.fileUrl,
    posterUrl: e.posterUrl,
    posterAspect: e.posterAspect,
    posterPos: e.posterPos,
    mimeType: e.mimeType,
    durationSec: e.durationSec,
    title: titlesVisible ? e.title : null,
    description: titlesVisible && e.description ? e.description : null,
    customAnswers: titlesVisible ? answersFor(e.formData) : null,
    authorName: authorsVisible ? e.authorName : null,
    authorNo: authorsVisible ? e.authorNo : null,
    voteCount: resultsVisible ? e.voteCount : null,
    rank: resultsVisible ? (rankById.get(e.id) ?? null) : null,
    commentCount: e.commentCount,
    myVotes: myBallots.get(e.id) ?? 0,
  }));

  return {
    id: row.id,
    title: row.title,
    descriptionMd: row.descriptionMd,
    announcement: row.announcement,
    coverUrl: row.coverUrl,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    startAt: row.startAt?.toISOString() ?? null,
    endAt: row.endAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    votesPerUser: row.votesPerUser,
    budgetPeriod: row.budgetPeriod,
    maxPerEntry: row.maxPerEntry,
    allowRevoke: row.allowRevoke,
    resultsMode: row.resultsMode,
    showTitles: row.showTitles,
    showAuthors: row.showAuthors,
    entryOrder: row.entryOrder,
    featured: row.featured,
    over,
    started,
    open,
    resultsVisible,
    authorsVisible,
    titlesVisible,
    entryCount: row.entryCount,
    voterCount: row.voterCount,
    voteCount: resultsVisible ? row.voteCount : null,
    creator: toPublicAuthor(row.creator, viewer.canSeeIdentity),
    isOwner,
    isCreator,
    entries,
    allowSubmissions: row.allowSubmissions,
    submissionReview: row.submissionReview,
    submissionMedia: row.submissionMedia,
    maxSubmissionsPerUser: row.maxSubmissionsPerUser,
    maxSubmissionMb: row.maxSubmissionMb,
    submitTitle: row.submitTitle,
    submitAuthorName: row.submitAuthorName,
    submitAuthorNo: row.submitAuthorNo,
    submitDescription: row.submitDescription,
    customFields: fieldDefs,
    submissionNote: row.submissionNote,
    allowComments: row.allowComments,
    submissionsOpen: row.allowSubmissions && row.status === 'published' && !over,
    mySubmissions,
    viewer: {
      id: viewer.id,
      loggedIn: Boolean(viewer.id),
      canVote: Boolean(viewer.id) && (!env.ENABLE_SSO || profileNo !== ''),
      budgetUsed,
      budgetRemaining: Math.max(0, row.votesPerUser - budgetUsed),
      dayKey,
      displayName: profileName,
      authorNo: profileNo,
      submissionCount,
    },
  };
}

// ─── Edit view (creator/admin) ──────────────────────────────────────────────

export interface VoteEntryEditRow {
  id: string;
  entryNo: number;
  kind: 'image' | 'video';
  fileUrl: string;
  posterUrl: string | null;
  posterAspect: 'landscape' | 'portrait';
  posterPos: string;
  originalName: string;
  title: string;
  authorName: string;
  authorNo: string;
  titleEdited: boolean;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  hidden: boolean;
  status: 'approved' | 'pending' | 'rejected';
  reviewNote: string;
  submitterName: string | null; // 成员投稿的投稿人；发起人代传为 null
  voteCount: number;
}

export interface VoteActivityEdit {
  id: string;
  title: string;
  descriptionMd: string;
  announcement: string;
  coverUrl: string | null;
  status: 'draft' | 'published';
  startAt: string | null;
  endAt: string | null;
  closedAt: string | null;
  votesPerUser: number;
  budgetPeriod: 'total' | 'daily';
  maxPerEntry: number;
  allowRevoke: boolean;
  resultsMode: 'realtime' | 'after_end' | 'creator_only';
  showTitles: boolean;
  showAuthors: boolean;
  entryOrder: 'random' | 'upload' | 'votes';
  nameRule: unknown;
  over: boolean;
  entryCount: number;
  voteCount: number;
  voterCount: number;
  allowSubmissions: boolean;
  submissionReview: boolean;
  submissionMedia: 'image' | 'video' | 'both';
  maxSubmissionsPerUser: number;
  maxSubmissionMb: number | null;
  submitTitle: VoteFormFieldMode;
  submitAuthorName: VoteFormFieldMode;
  submitAuthorNo: VoteFormFieldMode;
  submitDescription: VoteFormFieldMode;
  customFields: VoteCustomField[];
  submissionNote: string;
  allowComments: boolean;
  pendingCount: number; // 待审核投稿数（entries 里也带 status，这里是快捷徽标）
  entries: VoteEntryEditRow[];
}

/** Full editable payload (incl. hidden entries + rule). Creator/admin only. */
export async function getVoteActivityForEdit(
  id: string,
  viewer: VoteViewer,
): Promise<VoteActivityEdit | null> {
  if (!viewer.id) return null;
  const row = await prisma.voteActivity.findUnique({
    where: { id },
    include: {
      entries: {
        orderBy: { entryNo: 'asc' },
        select: {
          id: true,
          entryNo: true,
          kind: true,
          fileUrl: true,
          posterUrl: true,
          posterAspect: true,
          posterPos: true,
          originalName: true,
          title: true,
          authorName: true,
          authorNo: true,
          titleEdited: true,
          mimeType: true,
          sizeBytes: true,
          durationSec: true,
          hidden: true,
          status: true,
          reviewNote: true,
          submitter: { select: { displayName: true } },
          voteCount: true,
        },
      },
    },
  });
  if (!row || row.deletedAt) return null;
  if (row.creatorId !== viewer.id && !viewer.canManage) return null;

  return {
    id: row.id,
    title: row.title,
    descriptionMd: row.descriptionMd,
    announcement: row.announcement,
    coverUrl: row.coverUrl,
    status: row.status,
    startAt: row.startAt?.toISOString() ?? null,
    endAt: row.endAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    votesPerUser: row.votesPerUser,
    budgetPeriod: row.budgetPeriod,
    maxPerEntry: row.maxPerEntry,
    allowRevoke: row.allowRevoke,
    resultsMode: row.resultsMode,
    showTitles: row.showTitles,
    showAuthors: row.showAuthors,
    entryOrder: row.entryOrder,
    nameRule: row.nameRule ?? null,
    over: voteOver(row),
    entryCount: row.entryCount,
    voteCount: row.voteCount,
    voterCount: row.voterCount,
    allowSubmissions: row.allowSubmissions,
    submissionReview: row.submissionReview,
    submissionMedia: row.submissionMedia,
    maxSubmissionsPerUser: row.maxSubmissionsPerUser,
    maxSubmissionMb: row.maxSubmissionMb,
    submitTitle: row.submitTitle,
    submitAuthorName: row.submitAuthorName,
    submitAuthorNo: row.submitAuthorNo,
    submitDescription: row.submitDescription,
    customFields: parseCustomFields(row.submissionFields) ?? [],
    submissionNote: row.submissionNote,
    allowComments: row.allowComments,
    pendingCount: row.entries.filter((e) => e.status === 'pending').length,
    entries: row.entries.map(({ submitter, ...e }) => ({
      ...e,
      submitterName: submitter?.displayName ?? null,
    })),
  };
}

/** Guard used by mutation routes: activity row if the user may manage it. */
export async function findManagedActivity(id: string, viewer: VoteViewer) {
  if (!viewer.id) return null;
  const row = await prisma.voteActivity.findUnique({ where: { id } });
  if (!row || row.deletedAt) return null;
  if (row.creatorId !== viewer.id && !viewer.canManage) return null;
  return row;
}

/**
 * Recompute the denormalized entryCount (= visible gallery size: non-hidden,
 * approved). Call inside the SAME tx as any entry create/delete/hide/review
 * mutation so the counter can never drift.
 */
export async function recountVisibleEntries(
  tx: Prisma.TransactionClient,
  activityId: string,
): Promise<number> {
  const visible = await tx.voteEntry.count({
    where: { activityId, hidden: false, status: 'approved' },
  });
  await tx.voteActivity.update({ where: { id: activityId }, data: { entryCount: visible } });
  return visible;
}
