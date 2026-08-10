import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT } from '@/lib/user-identity';
import { isDocType, isLibraryCategory, type AiOverview } from '@/lib/library/types';

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
 * Whether the viewer may READ (reader/chat/file) this doc. Detail-page
 * discoverability is looser — restricted docs show their metadata to everyone.
 */
export async function canReadDoc(
  doc: { id: string; uploaderId: string; visibility: string },
  viewer: { id: string; isAdmin: boolean } | null,
): Promise<boolean> {
  if (doc.visibility === 'public') return !!viewer;
  if (!viewer) return false;
  if (viewer.isAdmin || viewer.id === doc.uploaderId) return true;
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

const DOC_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  author: true,
  docType: true,
  categories: true,
  visibility: true,
  format: true,
  summary: true,
  siteName: true,
  coverUrl: true,
  estReadMinutes: true,
  wordCount: true,
  chapterCount: true,
  featured: true,
  shelfCount: true,
  likeCount: true,
  viewCount: true,
  commentCount: true,
  ratingCount: true,
  avgRating: true,
  createdAt: true,
  uploader: AUTHOR_SELECT,
} satisfies Prisma.LibraryDocSelect;

export interface DocCardData {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  docType: string;
  categories: string[];
  visibility: string;
  format: string;
  summary: string;
  siteName: string | null;
  coverUrl: string | null;
  estReadMinutes: number;
  wordCount: number;
  chapterCount: number;
  featured: boolean;
  shelfCount: number;
  likeCount: number;
  viewCount: number;
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
  if (isLibraryCategory(filters.cat)) where.categories = { has: filters.cat };
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

/** Per-category doc counts for the browse sidebar (ready, non-private docs). */
export async function getCategoryCounts(): Promise<Record<string, number>> {
  const rows = await prisma.libraryDoc.findMany({
    where: BROWSABLE_DOC_WHERE,
    select: { categories: true },
  });
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const cat of row.categories) counts[cat] = (counts[cat] ?? 0) + 1;
  }
  return counts;
}

const DOC_DETAIL_SELECT = {
  id: true,
  slug: true,
  title: true,
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
  abstractMd: true,
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
    select: { chapterIndex: true, title: true, charCount: true, aiSummary: true },
  },
} satisfies Prisma.LibraryDocSelect;

/**
 * Detail page load. Returns null unless the doc is discoverable
 * (ready && not deleted && not private) OR the viewer is the uploader / admin.
 * `canRead` gates the reading affordances for restricted docs.
 */
export async function getDocBySlug(slug: string, viewer: { id: string; isAdmin: boolean } | null) {
  const doc = await prisma.libraryDoc.findUnique({ where: { slug }, select: DOC_DETAIL_SELECT });
  if (!doc) return null;

  const discoverable = doc.status === 'ready' && !doc.deletedAt && doc.visibility !== 'private';
  const privileged = !!viewer && (viewer.isAdmin || viewer.id === doc.uploaderId);
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
    aiOverview: doc.aiOverview as AiOverview | null,
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

export interface ReaderChapterPayload {
  chapterIndex: number;
  title: string | null;
  html: string;
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
  viewer: { id: string; isAdmin: boolean },
  chapterIndex: number,
  view?: 'flow' | 'paged',
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
      aiIndexState: true,
      language: true,
      status: true,
      visibility: true,
      uploaderId: true,
      deletedAt: true,
    },
  });
  if (!doc || doc.status !== 'ready' || doc.deletedAt) return null;
  if (!(await canReadDoc(doc, viewer))) return 'no_access';

  const [progress, toc] = await Promise.all([
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
        pageStart: true,
        pageEnd: true,
      },
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

  const [chapters, highlights] = await Promise.all([
    mode === 'flow'
      ? prisma.libraryChapter.findMany({
          where: { docId: doc.id },
          orderBy: { chapterIndex: 'asc' },
          select: { chapterIndex: true, title: true, html: true },
        })
      : prisma.libraryChapter
          .findUnique({
            where: { docId_chapterIndex: { docId: doc.id, chapterIndex: resolved } },
            select: { chapterIndex: true, title: true, html: true },
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
      aiOverview: doc.aiOverview as AiOverview | null,
      aiIndexState: doc.aiIndexState,
      language: doc.language,
    },
    mode,
    flowAvailable,
    chapters,
    initialChapter: resolved,
    toc,
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
  createdAt: true,
  author: COMMENT_AUTHOR_SELECT,
} as const;

/** All comments of a doc as 2-level threads (hard render caps, no pagination). */
export async function getDocComments(docId: string) {
  return prisma.libraryComment.findMany({
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
}

// ── 共享笔记（阅读器社区侧栏）────────────────────────────────────────────

/**
 * Shared highlights/notes of a doc: rows whose owner turned on the per-doc
 * shareNotes toggle. Includes single-level reply threads. Authors carry the
 * full identity select — API routes MUST map through toPublicAuthor().
 */
export async function getSharedNotes(docId: string, chapterIndex?: number) {
  return prisma.libraryHighlight.findMany({
    where: {
      docId,
      ...(chapterIndex !== undefined ? { chapterIndex } : {}),
      user: { libraryProgress: { some: { docId, shareNotes: true } } },
    },
    orderBy: [{ chapterIndex: 'asc' }, { charStart: 'asc' }],
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
      createdAt: true,
      user: COMMENT_AUTHOR_SELECT,
      replies: {
        where: { status: 'visible' },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
          id: true,
          bodyMd: true,
          createdAt: true,
          author: COMMENT_AUTHOR_SELECT,
        },
      },
    },
  });
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
