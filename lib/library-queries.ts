import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isDocType, type AiOverview } from '@/lib/library/types';

// Member reads only ever surface docs that finished extraction and were not
// soft-deleted; drafts/failures stay visible to their uploader and admins.
export const READY_DOC_WHERE = {
  status: 'ready',
  deletedAt: null,
} satisfies Prisma.LibraryDocWhereInput;

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
  createdAt: true,
  uploader: AUTHOR_SELECT,
} satisfies Prisma.LibraryDocSelect;

export interface DocCardData {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  docType: string;
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
  createdAt: Date;
  uploader: { handle: string; displayName: string; avatarUrl: string | null };
  /** Present in shelf queries. */
  progressPercent?: number;
}

export interface BrowseDocFilters {
  q?: string;
  type?: string;
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

  const where: Prisma.LibraryDocWhereInput = { ...READY_DOC_WHERE };
  if (isDocType(filters.type)) where.docType = filters.type;
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
    where: { ...READY_DOC_WHERE, featured: true },
    orderBy: [{ featuredAt: 'desc' }],
    take,
    select: DOC_CARD_SELECT,
  });
}

const DOC_DETAIL_SELECT = {
  id: true,
  slug: true,
  title: true,
  author: true,
  language: true,
  docType: true,
  docTypePinned: true,
  format: true,
  status: true,
  processingError: true,
  summary: true,
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
    select: { chapterIndex: true, title: true, charCount: true },
  },
} satisfies Prisma.LibraryDocSelect;

/**
 * Detail page load. Returns null unless the doc is publicly visible
 * (ready && not deleted) OR the viewer is the uploader / an admin.
 */
export async function getDocBySlug(slug: string, viewer: { id: string; isAdmin: boolean } | null) {
  const doc = await prisma.libraryDoc.findUnique({ where: { slug }, select: DOC_DETAIL_SELECT });
  if (!doc) return null;

  const publiclyVisible = doc.status === 'ready' && !doc.deletedAt;
  const privileged = !!viewer && (viewer.isAdmin || viewer.id === doc.uploaderId);
  if (!publiclyVisible && !privileged) return null;

  let shelvedByMe = false;
  let likedByMe = false;
  let progressPercent = 0;
  if (viewer) {
    const pair = { userId: viewer.id, docId: doc.id };
    const [shelf, like, progress] = await Promise.all([
      prisma.libraryShelfItem.findUnique({ where: { userId_docId: pair }, select: { userId: true } }),
      prisma.libraryLike.findUnique({ where: { userId_docId: pair }, select: { userId: true } }),
      prisma.libraryProgress.findUnique({ where: { userId_docId: pair }, select: { percent: true } }),
    ]);
    shelvedByMe = !!shelf;
    likedByMe = !!like;
    progressPercent = progress?.percent ?? 0;
  }

  return {
    ...doc,
    aiOverview: doc.aiOverview as AiOverview | null,
    shelvedByMe,
    likedByMe,
    progressPercent,
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
    aiOverview: AiOverview | null;
    aiIndexState: string;
    language: string | null;
  };
  chapter: { chapterIndex: number; title: string | null; html: string } | null;
  toc: { chapterIndex: number; title: string | null; charCount: number }[];
  progress: { chapterIndex: number; scrollRatio: number; percent: number } | null;
  highlights: HighlightRow[];
}

/**
 * Everything the reader shell needs in one call. `chapterIndex` is clamped to
 * the doc's range; pass a negative / non-finite value to resume from the
 * viewer's saved progress (fallback chapter 0).
 */
export async function getDocReaderData(
  slug: string,
  userId: string,
  chapterIndex: number,
): Promise<ReaderData | null> {
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
      aiOverview: true,
      aiIndexState: true,
      language: true,
      status: true,
      deletedAt: true,
    },
  });
  if (!doc || doc.status !== 'ready' || doc.deletedAt) return null;

  const progress = await prisma.libraryProgress.findUnique({
    where: { userId_docId: { userId, docId: doc.id } },
    select: { chapterIndex: true, scrollRatio: true, percent: true },
  });

  const maxIndex = Math.max(0, doc.chapterCount - 1);
  const requested =
    Number.isFinite(chapterIndex) && chapterIndex >= 0
      ? Math.trunc(chapterIndex)
      : (progress?.chapterIndex ?? 0);
  const resolved = Math.min(Math.max(0, requested), maxIndex);

  const [chapter, toc, highlights] = await Promise.all([
    prisma.libraryChapter.findUnique({
      where: { docId_chapterIndex: { docId: doc.id, chapterIndex: resolved } },
      select: { chapterIndex: true, title: true, html: true },
    }),
    prisma.libraryChapter.findMany({
      where: { docId: doc.id },
      orderBy: { chapterIndex: 'asc' },
      select: { chapterIndex: true, title: true, charCount: true },
    }),
    prisma.libraryHighlight.findMany({
      where: { docId: doc.id, userId, chapterIndex: resolved },
      orderBy: { charStart: 'asc' },
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
      aiOverview: doc.aiOverview as AiOverview | null,
      aiIndexState: doc.aiIndexState,
      language: doc.language,
    },
    chapter: chapter ?? null,
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
