import { Prisma } from '@prisma/client';
import { hasPermission, type PermissionHolder } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_FIELDS, AUTHOR_IDENTITY_SELECT } from '@/lib/user-identity';
import { isDocType, type AiOverview } from '@/lib/library/types';
import { listLibraryCategories } from '@/lib/library/categories';
import { HOT_HALF_LIFE_DAYS, HOT_WEIGHTS, HOT_WINDOW_DAYS } from '@/lib/library/hot-shared';
import { activityHref, type ActivityItem } from '@/lib/library/activity-shared';
import { pickDocTitle } from '@/lib/library/translation-shared';
import { markdownToPlainText } from '@/lib/markdown-text';
import { toPublicAuthor } from '@/lib/user-identity';
import { asAiOverview, pickOverview, pickText } from '@/lib/library/i18n-content';
import { effectivePassState, isFreshChapterTranslation } from '@/lib/library/translation-state';
import {
  isTargetLang,
  targetLangsFor,
  translatedTitle,
  type TargetLang,
} from '@/lib/library/translation-shared';

// Member reads only ever surface docs that finished extraction and were not
// soft-deleted; drafts/failures stay visible to their uploader and admins.
export const READY_DOC_WHERE = {
  status: 'ready',
  deletedAt: null,
} satisfies Prisma.LibraryDocWhereInput;

// Browse/discovery additionally hides private docs (skills model: restricted
// docs stay discoverable, reading is gated behind an approved access request).
export const BROWSABLE_DOC_WHERE = {
  ...READY_DOC_WHERE,
  visibility: { not: 'private' },
} satisfies Prisma.LibraryDocWhereInput;

/**
 * Library viewer: `canManage` = the `library` permission — the admin bypass for
 * private/restricted/unready/soft-deleted docs and for editing others' docs.
 * Identity trimming is NOT decided here (routes pass `can(user, 'identity')` to
 * toPublicAuthor themselves).
 */
export interface LibraryViewer {
  id: string;
  canManage: boolean;
}

export function libraryViewerFromSession(
  session: { user?: { id: string } & PermissionHolder } | null,
): LibraryViewer | null {
  if (!session?.user) return null;
  return { id: session.user.id, canManage: hasPermission(session.user, 'library') };
}

/**
 * Whether the viewer may READ (reader/chat/file) this doc. Detail-page
 * discoverability is looser — restricted docs show their metadata to everyone.
 */
export async function canReadDoc(
  doc: { id: string; uploaderId: string; visibility: string },
  viewer: LibraryViewer | null,
): Promise<boolean> {
  if (doc.visibility === 'public') return !!viewer;
  if (!viewer) return false;
  if (viewer.canManage || viewer.id === doc.uploaderId) return true;
  if (doc.visibility === 'private') return false;
  const granted = await prisma.libraryAccessRequest.findUnique({
    where: { docId_userId: { docId: doc.id, userId: viewer.id } },
    select: { status: true },
  });
  return granted?.status === 'approved';
}

export const LIBRARY_SORTS = ['newest', 'featured', 'shelved', 'views'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export function isLibrarySort(v: unknown): v is LibrarySort {
  return typeof v === 'string' && (LIBRARY_SORTS as readonly string[]).includes(v);
}

// 已读完 threshold — scroll-ratio progress rarely lands on exactly 100.
const FINISHED_PERCENT = 98;

const AUTHOR_SELECT = { select: { handle: true, displayName: true, avatarUrl: true } };

/** Fields a `DocCard` needs — exported so the 个人主页 docs tab renders the same card as browse. */
export const DOC_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  language: true,
  titleTranslations: true,
  author: true,
  docType: true,
  categories: true,
  visibility: true,
  format: true,
  summary: true,
  summaryEn: true,
  siteName: true,
  sourceUrl: true,
  coverUrl: true,
  estReadMinutes: true,
  wordCount: true,
  chapterCount: true,
  featured: true,
  shelfCount: true,
  likeCount: true,
  viewCount: true,
  readerCount: true,
  commentCount: true,
  ratingCount: true,
  avgRating: true,
  createdAt: true,
  uploader: AUTHOR_SELECT,
} satisfies Prisma.LibraryDocSelect;

export interface DocCardData {
  id: string;
  slug: string;
  /** ORIGINAL title — render through pickDocTitle(locale, doc) (translation-shared.ts). */
  title: string;
  language: string | null;
  /** { source, zh?, en? } JSON — see LibraryDoc.titleTranslations. */
  titleTranslations: unknown;
  author: string | null;
  docType: string;
  categories: string[];
  visibility: string;
  format: string;
  summary: string;
  /** English card blurb; empty ⇒ the card falls back to `summary` (中文). */
  summaryEn: string;
  siteName: string | null;
  /** Web docs only — cards derive the 来源 kind (公众号 / 知乎 / …) from it; null for uploaded files. */
  sourceUrl: string | null;
  coverUrl: string | null;
  estReadMinutes: number;
  wordCount: number;
  chapterCount: number;
  featured: boolean;
  shelfCount: number;
  likeCount: number;
  viewCount: number;
  /** Distinct members who opened the reader (kept as a counter; cards show `viewCount`, owner's call 2026-10-09). */
  readerCount: number;
  commentCount: number;
  ratingCount: number;
  avgRating: number;
  createdAt: Date;
  uploader: { handle: string; displayName: string; avatarUrl: string | null };
  /** Present in shelf queries. */
  progressPercent?: number;
}

export interface BrowseDocFilters {
  q?: string;
  type?: string;
  cat?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  /** Topic slugs of one 版块 (used when no single `cat` is chosen). */
  cats?: string[];
}

export async function browseDocs(filters: BrowseDocFilters): Promise<{
  items: DocCardData[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}> {
  // Query params arrive unvalidated (?page=abc / ?page=1.5): sanitize so
  // NaN/floats never reach Prisma's skip/take.
  const rawPage = Number(filters.page ?? 1);
  const requested = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
  const rawSize = Number(filters.pageSize ?? 20);
  const pageSize = Number.isFinite(rawSize) ? Math.min(50, Math.max(1, Math.trunc(rawSize))) : 20;

  const where: Prisma.LibraryDocWhereInput = { ...BROWSABLE_DOC_WHERE };
  if (isDocType(filters.type)) where.docType = filters.type;
  if (filters.cat) {
    // Member-created topics are not in the code constant — validate against the live list.
    const known = new Set((await listLibraryCategories()).map((c) => c.slug));
    if (known.has(filters.cat)) where.categories = { has: filters.cat };
  } else if (filters.cats) {
    // A 版块: any of its topics. An empty section matches nothing, correctly.
    where.categories = { hasSome: filters.cats };
  }
  if (filters.q) {
    const q = filters.q.trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { author: { contains: q, mode: 'insensitive' } },
        { siteName: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
      ];
    }
  }

  const sort: LibrarySort = isLibrarySort(filters.sort) ? filters.sort : 'newest';
  const orderBy: Prisma.LibraryDocOrderByWithRelationInput[] =
    sort === 'featured'
      ? [{ featured: 'desc' }, { featuredAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]
      : sort === 'shelved'
        ? [{ shelfCount: 'desc' }, { createdAt: 'desc' }]
        : sort === 'views'
          ? [{ viewCount: 'desc' }, { createdAt: 'desc' }]
          : [{ createdAt: 'desc' }];

  // Count first so an out-of-range ?page= clamps to the last real page.
  const total = await prisma.libraryDoc.count({ where });
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));

  const items: DocCardData[] = await prisma.libraryDoc.findMany({
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: DOC_CARD_SELECT,
  });

  return { items, total, page, pageSize, hasMore: page * pageSize < total };
}

/** 精选推荐 rail on /library. */
export async function getFeaturedDocs(limit = 8): Promise<DocCardData[]> {
  const take = Number.isFinite(limit) ? Math.min(24, Math.max(1, Math.trunc(limit))) : 8;
  return prisma.libraryDoc.findMany({
    where: { ...BROWSABLE_DOC_WHERE, featured: true },
    orderBy: [{ featuredAt: 'desc' }],
    take,
    select: DOC_CARD_SELECT,
  });
}

/**
 * 相似文档 — up to `limit` OTHER public+ready docs that share this doc's type
 * or at least one category, newest first. Public-only mirrors the profile/shelf
 * visibility rule so the reader never surfaces a doc the viewer couldn't open.
 */
export async function getRelatedDocs(docId: string, limit = 6): Promise<DocCardData[]> {
  const take = Math.min(12, Math.max(1, Math.trunc(limit) || 6));
  const src = await prisma.libraryDoc.findUnique({
    where: { id: docId },
    select: { docType: true, categories: true },
  });
  if (!src) return [];
  const or: Prisma.LibraryDocWhereInput[] = [{ docType: src.docType }];
  if (src.categories.length > 0) or.push({ categories: { hasSome: src.categories } });
  return prisma.libraryDoc.findMany({
    where: { ...READY_DOC_WHERE, visibility: 'public', id: { not: docId }, OR: or },
    orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    take,
    select: DOC_CARD_SELECT,
  });
}

/**
 * Browse counts for the 版块 rail and the topic chips (ready, non-private docs).
 * A doc counts once per section however many of that section's topics it carries.
 */
export async function getBrowseCounts(): Promise<{
  byTopic: Record<string, number>;
  bySection: Record<string, number>;
}> {
  const [rows, categories] = await Promise.all([
    prisma.libraryDoc.findMany({ where: BROWSABLE_DOC_WHERE, select: { categories: true } }),
    listLibraryCategories(),
  ]);
  const sectionOf = new Map(categories.map((c) => [c.slug, c.section ?? 'other']));
  const byTopic: Record<string, number> = {};
  const bySection: Record<string, number> = {};
  for (const row of rows) {
    const sections = new Set<string>();
    for (const cat of row.categories) {
      byTopic[cat] = (byTopic[cat] ?? 0) + 1;
      sections.add(sectionOf.get(cat) ?? 'other');
    }
    for (const sec of sections) bySection[sec] = (bySection[sec] ?? 0) + 1;
  }
  return { byTopic, bySection };
}

/**
 * 最热 — docs ranked by time-decayed engagement inside the last HOT_WINDOW_DAYS
 * (lib/library/hot-shared.ts has the model and the constants). One SQL pass over
 * the six event tables + the doc's own creation; browsable docs only.
 */
export async function getHotDocs(limit = 5): Promise<DocCardData[]> {
  const since = new Date(Date.now() - HOT_WINDOW_DAYS * 86_400_000);
  const halfLifeSec = HOT_HALF_LIFE_DAYS * 86_400;
  const rows = await prisma.$queryRaw<{ docId: string; score: number }[]>`
    SELECT e."docId", SUM(e.w)::float AS score
    FROM (
      SELECT "docId", ${HOT_WEIGHTS.view}::float * POWER(0.5, EXTRACT(EPOCH FROM (now() - "createdAt")) / ${halfLifeSec}) AS w
        FROM "LibraryView" WHERE "createdAt" >= ${since}
      UNION ALL
      SELECT "docId", ${HOT_WEIGHTS.read}::float * POWER(0.5, EXTRACT(EPOCH FROM (now() - "updatedAt")) / ${halfLifeSec})
        FROM "LibraryProgress" WHERE "updatedAt" >= ${since}
      UNION ALL
      SELECT "docId", ${HOT_WEIGHTS.shelf}::float * POWER(0.5, EXTRACT(EPOCH FROM (now() - "createdAt")) / ${halfLifeSec})
        FROM "LibraryShelfItem" WHERE "createdAt" >= ${since}
      UNION ALL
      SELECT "docId", ${HOT_WEIGHTS.like}::float * POWER(0.5, EXTRACT(EPOCH FROM (now() - "createdAt")) / ${halfLifeSec})
        FROM "LibraryLike" WHERE "createdAt" >= ${since}
      UNION ALL
      SELECT "docId", ${HOT_WEIGHTS.comment}::float * POWER(0.5, EXTRACT(EPOCH FROM (now() - "createdAt")) / ${halfLifeSec})
        FROM "LibraryComment" WHERE "createdAt" >= ${since} AND "status" = 'visible'
      UNION ALL
      SELECT "docId", ${HOT_WEIGHTS.note}::float * POWER(0.5, EXTRACT(EPOCH FROM (now() - "createdAt")) / ${halfLifeSec})
        FROM "LibraryHighlight" WHERE "createdAt" >= ${since}
      UNION ALL
      SELECT "id" AS "docId", ${HOT_WEIGHTS.fresh}::float * POWER(0.5, EXTRACT(EPOCH FROM (now() - "createdAt")) / ${halfLifeSec})
        FROM "LibraryDoc" WHERE "createdAt" >= ${since}
    ) e
    JOIN "LibraryDoc" d ON d."id" = e."docId"
    WHERE d."status" = 'ready' AND d."deletedAt" IS NULL AND d."visibility" <> 'private'
    GROUP BY e."docId"
    ORDER BY score DESC
    LIMIT ${limit}`;
  if (rows.length === 0) return [];
  const docs = await prisma.libraryDoc.findMany({
    where: { id: { in: rows.map((r) => r.docId) } },
    select: DOC_CARD_SELECT,
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  return rows.flatMap((r) => byId.get(r.docId) ?? []);
}

/** 7 日评论 — docs with the most visible comments in the window, with that count. */
export async function getTopCommentedDocs(
  days = HOT_WINDOW_DAYS,
  limit = 5,
): Promise<(DocCardData & { windowComments: number })[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const groups = await prisma.libraryComment.groupBy({
    by: ['docId'],
    where: { status: 'visible', createdAt: { gte: since }, doc: BROWSABLE_DOC_WHERE },
    _count: { _all: true },
    orderBy: { _count: { docId: 'desc' } },
    take: limit,
  });
  if (groups.length === 0) return [];
  const docs = await prisma.libraryDoc.findMany({
    where: { id: { in: groups.map((g) => g.docId) } },
    select: DOC_CARD_SELECT,
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  return groups.flatMap((g) => {
    const d = byId.get(g.docId);
    return d ? [{ ...d, windowComments: g._count._all }] : [];
  });
}

const ACTIVITY_DOC_SELECT = { slug: true, title: true, language: true, titleTranslations: true } as const;
const ACTIVITY_EXCERPT = 160;

/**
 * 最新评论与批注 — newest visible comments and SHARED notes on public docs,
 * merged by time. A note is shared when its owner turned on 公开我的笔记 for that
 * doc (LibraryProgress.shareNotes — per user per doc, so it is correlated in SQL).
 * Identity is trimmed HERE with the viewer's permission; public docs only, so an
 * anonymous visitor sees nothing they could not open.
 */
export async function getRecentActivity(opts: {
  limit: number;
  locale: string;
  canSeeIdentity: boolean;
}): Promise<ActivityItem[]> {
  const publicDoc = { ...READY_DOC_WHERE, visibility: 'public' as const };
  const [comments, noteIds] = await Promise.all([
    prisma.libraryComment.findMany({
      where: { status: 'visible', doc: publicDoc },
      orderBy: { createdAt: 'desc' },
      take: opts.limit,
      select: { id: true, bodyMd: true, createdAt: true, doc: { select: ACTIVITY_DOC_SELECT }, author: AUTHOR_IDENTITY_SELECT },
    }),
    prisma.$queryRaw<{ id: string }[]>`
      SELECT h."id"
      FROM "LibraryHighlight" h
      JOIN "LibraryProgress" p ON p."userId" = h."userId" AND p."docId" = h."docId" AND p."shareNotes" = true
      JOIN "LibraryDoc" d ON d."id" = h."docId"
      WHERE h."noteText" IS NOT NULL AND h."noteText" <> ''
        AND d."status" = 'ready' AND d."deletedAt" IS NULL AND d."visibility" = 'public'
      ORDER BY h."createdAt" DESC
      LIMIT ${opts.limit}`,
  ]);
  const notes = noteIds.length
    ? await prisma.libraryHighlight.findMany({
        where: { id: { in: noteIds.map((r) => r.id) } },
        select: {
          id: true,
          quote: true,
          noteText: true,
          chapterIndex: true,
          createdAt: true,
          doc: { select: ACTIVITY_DOC_SELECT },
          user: AUTHOR_IDENTITY_SELECT,
        },
      })
    : [];

  const items: ActivityItem[] = [
    ...comments.map((c) => ({
      kind: 'comment' as const,
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      author: toPublicAuthor(c.author, opts.canSeeIdentity),
      text: markdownToPlainText(c.bodyMd, { max: ACTIVITY_EXCERPT }),
      quote: null,
      doc: { slug: c.doc.slug, title: pickDocTitle(opts.locale, c.doc) },
      href: activityHref({ kind: 'comment', id: c.id, slug: c.doc.slug }),
    })),
    ...notes.map((n) => ({
      kind: 'note' as const,
      id: n.id,
      createdAt: n.createdAt.toISOString(),
      author: toPublicAuthor(n.user, opts.canSeeIdentity),
      text: (n.noteText ?? '').slice(0, ACTIVITY_EXCERPT),
      quote: n.quote,
      doc: { slug: n.doc.slug, title: pickDocTitle(opts.locale, n.doc) },
      href: activityHref({ kind: 'note', id: n.id, slug: n.doc.slug, chapterIndex: n.chapterIndex }),
    })),
  ];
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return items.slice(0, opts.limit);
}

/** 继续阅读 rail — the viewer's most recently touched, unfinished docs. */
export async function getContinueReading(
  userId: string,
  limit = 3,
): Promise<{ doc: DocCardData; percent: number }[]> {
  const rows = await prisma.libraryProgress.findMany({
    where: { userId, percent: { gt: 0, lt: FINISHED_PERCENT }, doc: READY_DOC_WHERE },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { percent: true, doc: { select: DOC_CARD_SELECT } },
  });
  return rows.map((r) => ({ doc: r.doc, percent: r.percent }));
}

const DOC_DETAIL_SELECT = {
  id: true,
  slug: true,
  title: true,
  titleTranslations: true,
  author: true,
  language: true,
  docType: true,
  docTypePinned: true,
  categories: true,
  visibility: true,
  metaPinned: true,
  commentCount: true,
  ratingCount: true,
  avgRating: true,
  format: true,
  status: true,
  processingError: true,
  summary: true,
  summaryEn: true,
  abstractMd: true,
  abstractMdEn: true,
  sourceUrl: true,
  siteName: true,
  publishedAt: true,
  coverUrl: true,
  fileUrl: true,
  mimeType: true,
  fileSizeBytes: true,
  wordCount: true,
  estReadMinutes: true,
  chapterCount: true,
  featured: true,
  featuredAt: true,
  uploaderId: true,
  viewCount: true,
  likeCount: true,
  shelfCount: true,
  aiOverview: true,
  aiOverviewEn: true,
  aiModel: true,
  aiIndexedAt: true,
  aiIndexState: true,
  aiError: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  uploader: AUTHOR_SELECT,
  chapters: {
    orderBy: { chapterIndex: 'asc' },
    select: { chapterIndex: true, title: true, charCount: true, aiSummary: true, aiSummaryEn: true },
  },
} satisfies Prisma.LibraryDocSelect;

/**
 * Detail page load. Returns null unless the doc is discoverable
 * (ready && not deleted && not private) OR the viewer is the uploader / admin.
 * `canRead` gates the reading affordances for restricted docs.
 */
export async function getDocBySlug(slug: string, viewer: LibraryViewer | null) {
  const doc = await prisma.libraryDoc.findUnique({ where: { slug }, select: DOC_DETAIL_SELECT });
  if (!doc) return null;

  const discoverable = doc.status === 'ready' && !doc.deletedAt && doc.visibility !== 'private';
  const privileged = !!viewer && (viewer.canManage || viewer.id === doc.uploaderId);
  if (!discoverable && !privileged) return null;

  let shelvedByMe = false;
  let likedByMe = false;
  let progressPercent = 0;
  let myRating = 0;
  let myAccessStatus: string | null = null;
  if (viewer) {
    const pair = { userId: viewer.id, docId: doc.id };
    const [shelf, like, progress, rating, access] = await Promise.all([
      prisma.libraryShelfItem.findUnique({ where: { userId_docId: pair }, select: { userId: true } }),
      prisma.libraryLike.findUnique({ where: { userId_docId: pair }, select: { userId: true } }),
      prisma.libraryProgress.findUnique({ where: { userId_docId: pair }, select: { percent: true } }),
      prisma.libraryRating.findUnique({ where: { userId_docId: pair }, select: { rating: true } }),
      prisma.libraryAccessRequest.findUnique({
        where: { docId_userId: { docId: doc.id, userId: viewer.id } },
        select: { status: true },
      }),
    ]);
    shelvedByMe = !!shelf;
    likedByMe = !!like;
    progressPercent = progress?.percent ?? 0;
    myRating = rating?.rating ?? 0;
    myAccessStatus = access?.status ?? null;
  }

  const canRead =
    privileged || doc.visibility === 'public'
      ? !!viewer
      : doc.visibility === 'restricted' && myAccessStatus === 'approved';

  // 公开笔记数 — readers whose per-doc shareNotes toggle is on.
  const sharedNoteCount = await prisma.libraryHighlight.count({
    where: {
      docId: doc.id,
      user: { libraryProgress: { some: { docId: doc.id, shareNotes: true } } },
    },
  });

  return {
    ...doc,
    aiOverview: asAiOverview(doc.aiOverview),
    aiOverviewEn: asAiOverview(doc.aiOverviewEn),
    shelvedByMe,
    likedByMe,
    progressPercent,
    myRating,
    myAccessStatus,
    canRead: privileged || canRead,
    sharedNoteCount,
  };
}

export type DocDetail = NonNullable<Awaited<ReturnType<typeof getDocBySlug>>>;

export interface HighlightRow {
  id: string;
  chapterIndex: number;
  charStart: number;
  charEnd: number;
  quote: string;
  color: string;
  noteText: string | null;
  createdAt: Date;
}

/** One chapter's 译文 in one language (only FRESH ones — built from the current html). */
export interface ReaderChapterTranslation {
  html: string;
  title: string | null;
}

export interface ReaderChapterPayload {
  chapterIndex: number;
  title: string | null;
  html: string;
  /** Whole-chapter 译文 per language that has one. At most two (a doc never translates into its own language). */
  translations: Partial<Record<TargetLang, ReaderChapterTranslation>>;
}

/** Per-language whole-document pass status, as the reader needs it. */
export interface ReaderTranslationStatus {
  /** 'none' = never started (or a crashed pass past its stale window). */
  state: 'none' | 'running' | 'ready' | 'partial' | 'failed';
  error: string | null;
}

export interface ReaderData {
  doc: {
    id: string;
    slug: string;
    title: string;
    author: string | null;
    docType: string;
    format: string;
    sourceUrl: string | null;
    siteName: string | null;
    fileUrl: string | null;
    chapterCount: number;
    wordCount: number;
    aiOverview: AiOverview | null;
    aiIndexState: string;
    language: string | null;
    commentCount: number;
    /** Languages this doc can be translated into (never its own). */
    targetLangs: TargetLang[];
    /** Translated title per language, for the CURRENT title only. */
    titles: Partial<Record<TargetLang, string>>;
    translations: Partial<Record<TargetLang, ReaderTranslationStatus>>;
  };
  /** 'flow' = whole doc stacked for continuous scrolling; 'paged' = one chapter. */
  mode: 'paged' | 'flow';
  /** Whether continuous mode is offered at all (small enough docs only). */
  flowAvailable: boolean;
  chapters: ReaderChapterPayload[];
  initialChapter: number;
  toc: {
    chapterIndex: number;
    title: string | null;
    charCount: number;
    aiSummary: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    /** Translated chapter title per language (目录 follows the reading language). */
    titles: Partial<Record<TargetLang, string>>;
  }[];
  progress: { chapterIndex: number; scrollRatio: number; percent: number; shareNotes: boolean } | null;
  highlights: HighlightRow[];
}

// Continuous mode ships every chapter's HTML in one payload — cap it so a
// full-length book can't produce a multi-MB page.
const FLOW_MAX_CHARS = 400_000;

/**
 * Everything the reader shell needs in one call. `chapterIndex` is clamped to
 * the doc's range; pass a negative / non-finite value to resume from the
 * viewer's saved progress (fallback chapter 0). `view` picks 连续/分章 —
 * undefined defaults to continuous for web articles (原格式一直读完), paged
 * otherwise. Returns 'no_access' when the doc exists but the viewer may not
 * read it (restricted/private).
 */
export async function getDocReaderData(
  slug: string,
  viewer: LibraryViewer,
  chapterIndex: number,
  view?: 'flow' | 'paged',
  /** Viewer's UI locale — picks the stored language of 导读 / 章节摘要 (both
   *  are resolved HERE so the client payload carries one language, not two). */
  locale?: string,
): Promise<ReaderData | 'no_access' | null> {
  const userId = viewer.id;
  const doc = await prisma.libraryDoc.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      author: true,
      docType: true,
      format: true,
      sourceUrl: true,
      siteName: true,
      fileUrl: true,
      chapterCount: true,
      wordCount: true,
      aiOverview: true,
      aiOverviewEn: true,
      aiIndexState: true,
      language: true,
      commentCount: true,
      titleTranslations: true,
      status: true,
      visibility: true,
      uploaderId: true,
      deletedAt: true,
      docTranslations: { select: { targetLang: true, state: true, error: true, heartbeatAt: true } },
    },
  });
  if (!doc || doc.status !== 'ready' || doc.deletedAt) return null;
  if (!(await canReadDoc(doc, viewer))) return 'no_access';

  const targetLangs = targetLangsFor(doc.language);
  const [progress, toc, tocTitles] = await Promise.all([
    prisma.libraryProgress.findUnique({
      where: { userId_docId: { userId, docId: doc.id } },
      select: { chapterIndex: true, scrollRatio: true, percent: true, shareNotes: true },
    }),
    prisma.libraryChapter.findMany({
      where: { docId: doc.id },
      orderBy: { chapterIndex: 'asc' },
      select: {
        chapterIndex: true,
        title: true,
        charCount: true,
        aiSummary: true,
        aiSummaryEn: true,
        pageStart: true,
        pageEnd: true,
      },
    }),
    prisma.libraryChapterTranslation.findMany({
      where: { chapter: { docId: doc.id }, targetLang: { in: targetLangs }, title: { not: null } },
      select: { targetLang: true, title: true, chapter: { select: { chapterIndex: true } } },
    }),
  ]);

  const maxIndex = Math.max(0, doc.chapterCount - 1);
  const requested =
    Number.isFinite(chapterIndex) && chapterIndex >= 0
      ? Math.trunc(chapterIndex)
      : (progress?.chapterIndex ?? 0);
  const resolved = Math.min(Math.max(0, requested), maxIndex);

  const totalChars = toc.reduce((n, c) => n + c.charCount, 0);
  const flowAvailable = totalChars > 0 && totalChars <= FLOW_MAX_CHARS;
  const mode: 'paged' | 'flow' =
    view === 'flow'
      ? flowAvailable
        ? 'flow'
        : 'paged'
      : view === 'paged'
        ? 'paged'
        : doc.format === 'url' && flowAvailable
          ? 'flow'
          : 'paged';

  const chapterSelect = {
    chapterIndex: true,
    title: true,
    html: true,
    translations: {
      where: { targetLang: { in: targetLangs } },
      select: { targetLang: true, html: true, title: true, sourceHash: true },
    },
  } satisfies Prisma.LibraryChapterSelect;
  const [chapterRows, highlights] = await Promise.all([
    mode === 'flow'
      ? prisma.libraryChapter.findMany({
          where: { docId: doc.id },
          orderBy: { chapterIndex: 'asc' },
          select: chapterSelect,
        })
      : prisma.libraryChapter
          .findUnique({
            where: { docId_chapterIndex: { docId: doc.id, chapterIndex: resolved } },
            select: chapterSelect,
          })
          .then((c) => (c ? [c] : [])),
    prisma.libraryHighlight.findMany({
      where: {
        docId: doc.id,
        userId,
        // flow renders every chapter; the 原版 pdf.js view paints highlights
        // across arbitrary pages — both need the full set.
        ...(mode === 'flow' || doc.format === 'pdf' ? {} : { chapterIndex: resolved }),
      },
      orderBy: [{ chapterIndex: 'asc' }, { charStart: 'asc' }],
      select: {
        id: true,
        chapterIndex: true,
        charStart: true,
        charEnd: true,
        quote: true,
        color: true,
        noteText: true,
        createdAt: true,
      },
    }),
  ]);

  const tocTitlesByChapter = new Map<number, Partial<Record<TargetLang, string>>>();
  for (const t of tocTitles) {
    if (!isTargetLang(t.targetLang) || !t.title) continue;
    const entry = tocTitlesByChapter.get(t.chapter.chapterIndex) ?? {};
    entry[t.targetLang] = t.title;
    tocTitlesByChapter.set(t.chapter.chapterIndex, entry);
  }

  return {
    doc: {
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      author: doc.author,
      docType: doc.docType,
      format: doc.format,
      sourceUrl: doc.sourceUrl,
      siteName: doc.siteName,
      fileUrl: doc.fileUrl,
      chapterCount: doc.chapterCount,
      wordCount: doc.wordCount,
      aiOverview: pickOverview(locale, asAiOverview(doc.aiOverview), asAiOverview(doc.aiOverviewEn)),
      aiIndexState: doc.aiIndexState,
      language: doc.language,
      commentCount: doc.commentCount,
      targetLangs,
      titles: Object.fromEntries(
        targetLangs.flatMap((l) => {
          const t = translatedTitle(doc.title, doc.titleTranslations, l);
          return t ? [[l, t]] : [];
        }),
      ),
      translations: Object.fromEntries(
        doc.docTranslations
          .filter((r) => isTargetLang(r.targetLang) && targetLangs.includes(r.targetLang))
          .map((r) => [
            r.targetLang,
            { state: effectivePassState(r) as ReaderTranslationStatus['state'], error: r.error },
          ]),
      ),
    },
    mode,
    flowAvailable,
    chapters: chapterRows.map((c) => ({
      chapterIndex: c.chapterIndex,
      title: c.title,
      html: c.html,
      translations: Object.fromEntries(
        c.translations
          .filter((t) => isTargetLang(t.targetLang) && isFreshChapterTranslation(t, c.html))
          .map((t) => [t.targetLang, { html: t.html, title: t.title }]),
      ),
    })),
    initialChapter: resolved,
    toc: toc.map(({ aiSummaryEn, ...c }) => ({
      ...c,
      aiSummary: pickText(locale, c.aiSummary, aiSummaryEn) || null,
      titles: tocTitlesByChapter.get(c.chapterIndex) ?? {},
    })),
    progress: progress ?? null,
    highlights,
  };
}

/** 我的书架 — the viewer's shelved (still-ready) docs with reading progress. */
export async function getShelfDocs(
  userId: string,
  opts: { type?: string; sort?: 'recent' | 'added' },
): Promise<DocCardData[]> {
  const docWhere: Prisma.LibraryDocWhereInput = { ...READY_DOC_WHERE };
  if (isDocType(opts.type)) docWhere.docType = opts.type;

  const items = await prisma.libraryShelfItem.findMany({
    where: { userId, doc: docWhere },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { createdAt: true, doc: { select: DOC_CARD_SELECT } },
  });
  if (items.length === 0) return [];

  const progressRows = await prisma.libraryProgress.findMany({
    where: { userId, docId: { in: items.map((i) => i.doc.id) } },
    select: { docId: true, percent: true, updatedAt: true },
  });
  const progressByDoc = new Map(progressRows.map((p) => [p.docId, p]));

  const sorted = [...items];
  if (opts.sort === 'recent') {
    // 最近阅读: progress recency first, shelf-add time for never-opened docs.
    sorted.sort((a, b) => {
      const ta = progressByDoc.get(a.doc.id)?.updatedAt.getTime() ?? a.createdAt.getTime();
      const tb = progressByDoc.get(b.doc.id)?.updatedAt.getTime() ?? b.createdAt.getTime();
      return tb - ta;
    });
  }

  return sorted.map((item) => ({
    ...item.doc,
    progressPercent: progressByDoc.get(item.doc.id)?.percent ?? 0,
  }));
}

export async function getShelfStats(
  userId: string,
): Promise<{ total: number; reading: number; finished: number }> {
  const items = await prisma.libraryShelfItem.findMany({
    where: { userId, doc: READY_DOC_WHERE },
    select: { docId: true },
  });
  if (items.length === 0) return { total: 0, reading: 0, finished: 0 };

  const progressRows = await prisma.libraryProgress.findMany({
    where: { userId, docId: { in: items.map((i) => i.docId) } },
    select: { percent: true },
  });

  let reading = 0;
  let finished = 0;
  for (const p of progressRows) {
    if (p.percent >= FINISHED_PERCENT) finished++;
    else if (p.percent > 0) reading++;
  }
  return { total: items.length, reading, finished };
}

// ── 评论（详情页讨论，2-level flat threads — feedback board contract）──────

// Includes department/lab/isPrivate — consumers MUST trim via toPublicAuthor().
const COMMENT_AUTHOR_SELECT = AUTHOR_IDENTITY_SELECT;

const COMMENT_SELECT = {
  id: true,
  bodyMd: true,
  status: true,
  replyCount: true,
  likeCount: true,
  createdAt: true,
  author: COMMENT_AUTHOR_SELECT,
} as const;

/**
 * All comments of a doc as 2-level threads (hard render caps, no pagination).
 * `viewerId` adds `likedByMe` — resolved with ONE batched read over the whole
 * page of comments rather than a correlated subquery per row.
 */
export async function getDocComments(docId: string, viewerId?: string | null) {
  const threads = await prisma.libraryComment.findMany({
    where: { docId, parentId: null },
    orderBy: { createdAt: 'asc' },
    take: 300,
    select: {
      ...COMMENT_SELECT,
      replies: {
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: COMMENT_SELECT,
      },
    },
  });

  const ids = threads.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]);
  const liked =
    viewerId && ids.length
      ? new Set(
          (
            await prisma.libraryCommentLike.findMany({
              where: { userId: viewerId, commentId: { in: ids } },
              select: { commentId: true },
            })
          ).map((r) => r.commentId),
        )
      : new Set<string>();

  return threads.map((c) => ({
    ...c,
    likedByMe: liked.has(c.id),
    replies: c.replies.map((r) => ({ ...r, likedByMe: liked.has(r.id) })),
  }));
}

// ── 共享笔记（阅读器社区侧栏）────────────────────────────────────────────

/**
 * Shared highlights/notes of a doc: rows whose owner turned on the per-doc
 * shareNotes toggle. Includes single-level reply threads. Authors carry the
 * full identity select — API routes MUST map through toPublicAuthor().
 */
export const ANNOTATION_SORTS = ['position', 'recent', 'hot'] as const;
export type AnnotationSort = (typeof ANNOTATION_SORTS)[number];

export function isAnnotationSort(v: unknown): v is AnnotationSort {
  return typeof v === 'string' && (ANNOTATION_SORTS as readonly string[]).includes(v);
}

/** Author select for annotations — identity fields PLUS the role, which is what
 *  marks an annotation as coming from a 专家 in the list. `permissions` rides
 *  along because `publicRoleBadge` needs it to drop STAFF roles before the
 *  payload leaves the server. Kept local so the site-wide PublicAuthor contract
 *  (lib/user-identity.ts) stays untouched. */
const ANNOTATION_AUTHOR_SELECT = {
  select: {
    ...AUTHOR_IDENTITY_FIELDS,
    role: { select: { key: true, name: true, permissions: true } },
  },
} as const;

const ANNOTATION_REPLY_SELECT = {
  id: true,
  parentId: true,
  bodyMd: true,
  createdAt: true,
  replyCount: true,
  likeCount: true,
  author: ANNOTATION_AUTHOR_SELECT,
} as const;

export interface SharedNoteFilters {
  chapterIndex?: number;
  sort?: AnnotationSort;
  /** Free-text index over the quoted passage, the note and the author name. */
  q?: string;
}

/**
 * 共享批注 for a document — every annotation whose owner turned on 公开我的笔记,
 * with its 2-level comment thread, 有用 count and whether THIS viewer liked it.
 *
 * Sorting happens in SQL so it stays correct under the row cap: 'position' is
 * reading order (the in-text markers), 'recent' is newest first, 'hot' ranks by
 * 有用 then discussion. Author filtering is deliberately NOT done here — the
 * panel toggles people client-side so it feels instant.
 */
export async function getSharedNotes(docId: string, filters: SharedNoteFilters = {}) {
  const q = filters.q?.trim();
  const orderBy: Prisma.LibraryHighlightOrderByWithRelationInput[] =
    filters.sort === 'recent'
      ? [{ createdAt: 'desc' }]
      : filters.sort === 'hot'
        ? [{ likeCount: 'desc' }, { replyCount: 'desc' }, { createdAt: 'desc' }]
        : [{ chapterIndex: 'asc' }, { charStart: 'asc' }];

  return prisma.libraryHighlight.findMany({
    where: {
      docId,
      ...(filters.chapterIndex !== undefined ? { chapterIndex: filters.chapterIndex } : {}),
      user: { libraryProgress: { some: { docId, shareNotes: true } } },
      ...(q
        ? {
            OR: [
              { quote: { contains: q, mode: 'insensitive' } },
              { noteText: { contains: q, mode: 'insensitive' } },
              { user: { displayName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    orderBy,
    take: 500,
    select: {
      id: true,
      userId: true,
      chapterIndex: true,
      charStart: true,
      charEnd: true,
      quote: true,
      color: true,
      noteText: true,
      replyCount: true,
      likeCount: true,
      createdAt: true,
      user: ANNOTATION_AUTHOR_SELECT,
      replies: {
        // Top-level comments only; their own replies ride along below.
        where: { status: 'visible', parentId: null },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
          ...ANNOTATION_REPLY_SELECT,
          children: {
            where: { status: 'visible' },
            orderBy: { createdAt: 'asc' },
            take: 50,
            select: ANNOTATION_REPLY_SELECT,
          },
        },
      },
    },
  });
}

/** Which of these annotations the viewer has marked 有用. */
export async function getMyNoteLikes(userId: string, highlightIds: string[]): Promise<Set<string>> {
  if (highlightIds.length === 0) return new Set();
  const rows = await prisma.libraryNoteLike.findMany({
    where: { userId, highlightId: { in: highlightIds } },
    select: { highlightId: true },
  });
  return new Set(rows.map((r) => r.highlightId));
}

/** Same, for the REPLIES under those annotations (a separate join table). */
export async function getMyNoteReplyLikes(userId: string, replyIds: string[]): Promise<Set<string>> {
  if (replyIds.length === 0) return new Set();
  const rows = await prisma.libraryNoteReplyLike.findMany({
    where: { userId, replyId: { in: replyIds } },
    select: { replyId: true },
  });
  return new Set(rows.map((r) => r.replyId));
}

// ── Dashboard（我的发布 / 我的互动）──────────────────────────────────────

/** All docs the user uploaded, every status, for dashboard + edit lists. */
export async function getMyLibraryDocs(userId: string) {
  return prisma.libraryDoc.findMany({
    where: { uploaderId: userId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      slug: true,
      title: true,
      docType: true,
      format: true,
      status: true,
      visibility: true,
      featured: true,
      shelfCount: true,
      likeCount: true,
      viewCount: true,
      commentCount: true,
      ratingCount: true,
      avgRating: true,
      aiIndexState: true,
      createdAt: true,
    },
  });
}

/** Latest comments other people left on the viewer's docs (dashboard). */
export async function getCommentsOnMyDocs(userId: string, limit = 6) {
  return prisma.libraryComment.findMany({
    where: {
      status: 'visible',
      authorId: { not: userId },
      doc: { uploaderId: userId, deletedAt: null },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(20, Math.max(1, limit)),
    select: {
      id: true,
      bodyMd: true,
      parentId: true,
      createdAt: true,
      author: COMMENT_AUTHOR_SELECT,
      doc: { select: { slug: true, title: true } },
    },
  });
}
