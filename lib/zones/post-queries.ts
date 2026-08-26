// 技术专区 — posts, attachments and comments query layer.
//
// Server-only. Every author crosses the boundary through toPublicAuthor with
// the viewer's `identity` permission, dates leave as ISO strings, and viewer
// state (liked / bookmarked) is annotated in TWO IN-queries per page — never
// per row. Post listing follows the discussion feed: pinned rows first on the
// first page (no search), keyset `publishedAt|id` for 最新, `o:<n>` offset for
// 热门. Comments are the site-wide 2-level flat contract (parentId = thread
// root; a reply's `replyToId` is transient and never stored).
//
// Attachments live in `<LOCAL_STORAGE_DIR>/zone-media` (lib/zones/storage.ts);
// a key is accepted only when it has the right shape, exists on disk and is not
// already attached to ANOTHER post (keys are visible in every download URL, so
// key format alone does not prove ownership). Edits replace the attachment set
// wholesale and unlink the files (plus their PDF previews / posters) that no
// row references any more.

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Session } from 'next-auth';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import type { ZoneAccessRow, ZoneSiteViewer } from './access';
import { resolveEmbeds } from './embeds';
import { scheduleOfficePreview } from './office-preview';
import type { ZoneAccess } from './permissions';
import { ZoneError } from './queries';
import {
  MAX_ZONE_ATTACHMENTS,
  MAX_ZONE_POST_TAGS,
  ZONE_ATTACHMENT_LIMITS,
  ZONE_LIMITS,
  ZONE_POST_TYPES,
  collectEmbedRefs,
  decodeOffsetCursor,
  decodeTimeCursor,
  encodeTimeCursor,
  estimateReadMinutes,
  excerptOf,
  extOfName,
  extractHeadings,
  isOfficePreviewable,
  normalizeHttpUrl,
  normalizeTags,
  type ZonePostSort,
  type ZonePostTypeValue,
} from './shared';
import {
  deleteZoneMediaFile,
  isValidZoneMediaKey,
  statZoneMediaAsync,
  zoneMediaKeyFromUrl,
  zoneMediaPublicUrl,
} from './storage';
import type {
  ZoneAttachmentKindView,
  ZoneAttachmentView,
  ZoneCommentView,
  ZonePostCardView,
  ZonePostDetailView,
  ZonePreviewStatusView,
  ZoneThreadView,
} from './types';

const INT32_MAX = 2_147_483_647;
const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;

function iso(d: Date): string;
function iso(d: Date | null | undefined): string | null;
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ── Selects ──────────────────────────────────────────────────────────────────

export const ZONE_POST_CARD_SELECT = {
  id: true,
  zoneId: true,
  type: true,
  title: true,
  summary: true,
  coverUrl: true,
  linkUrl: true,
  tags: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
  pinned: true,
  locked: true,
  likeCount: true,
  commentCount: true,
  viewCount: true,
  bookmarkCount: true,
  // Only for readMinutes — cards never ship the body.
  bodyMd: true,
  authorId: true,
  author: AUTHOR_IDENTITY_SELECT,
  coauthors: {
    orderBy: { sortOrder: 'asc' as const },
    select: { userId: true, sortOrder: true, user: AUTHOR_IDENTITY_SELECT },
  },
  attachments: { orderBy: { sortOrder: 'asc' as const }, select: { kind: true } },
  zone: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.ZonePostSelect;

export type ZonePostCardRow = Prisma.ZonePostGetPayload<{ select: typeof ZONE_POST_CARD_SELECT }>;

export const ZONE_ATTACHMENT_SELECT = {
  id: true,
  postId: true,
  kind: true,
  key: true,
  url: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  posterUrl: true,
  previewStatus: true,
  previewKey: true,
  previewUrl: true,
  previewError: true,
  sortOrder: true,
  createdAt: true,
} satisfies Prisma.ZonePostAttachmentSelect;

export type ZoneAttachmentRow = Prisma.ZonePostAttachmentGetPayload<{ select: typeof ZONE_ATTACHMENT_SELECT }>;

const ZONE_POST_DETAIL_SELECT = {
  ...ZONE_POST_CARD_SELECT,
  deletedAt: true,
  attachments: { orderBy: { sortOrder: 'asc' as const }, select: ZONE_ATTACHMENT_SELECT },
} satisfies Prisma.ZonePostSelect;

const PUBLISHED_WHERE = { status: 'published', deletedAt: null } satisfies Prisma.ZonePostWhereInput;

/** Zones whose CONTENT the viewer may read (mirrors buildZoneAccess#canRead in SQL). */
export function readableZoneWhere(viewer: ZoneSiteViewer): Prisma.ZoneWhereInput {
  if (viewer.siteAdmin) return { deletedAt: null };
  // /zones is login-walled; an anonymous viewer reads nothing (buildZoneAccess agrees).
  if (!viewer.id) return { id: { in: [] } };
  return {
    deletedAt: null,
    OR: [
      { visibility: 'public' },
      { ownerId: viewer.id },
      { members: { some: { userId: viewer.id, status: 'active' } } },
    ],
  };
}

// ── View mappers ─────────────────────────────────────────────────────────────

type AttachmentViewSource = Pick<
  ZoneAttachmentRow,
  'id' | 'kind' | 'key' | 'url' | 'name' | 'mimeType' | 'sizeBytes' | 'width' | 'height' | 'posterUrl' | 'previewStatus' | 'previewUrl'
>;

function extFromMime(mime: string): string {
  switch (mime.split(';')[0].trim().toLowerCase()) {
    case 'application/pdf':
      return 'pdf';
    case 'application/vnd.ms-powerpoint':
      return 'ppt';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'pptx';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'application/zip':
    case 'application/x-zip-compressed':
      return 'zip';
    case 'text/plain':
      return 'txt';
    case 'text/markdown':
      return 'md';
    case 'text/csv':
      return 'csv';
    case 'application/json':
      return 'json';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/avif':
      return 'avif';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    default:
      return '';
  }
}

function attachmentExt(a: { name: string; key: string; mimeType: string }): string {
  return extOfName(a.name) || extOfName(a.key) || extFromMime(a.mimeType);
}

export function toAttachmentView(row: AttachmentViewSource): ZoneAttachmentView {
  return {
    id: row.id,
    kind: row.kind,
    url: row.url,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width ?? null,
    height: row.height ?? null,
    posterUrl: row.posterUrl ?? null,
    ext: attachmentExt(row),
    previewStatus: row.previewStatus,
    previewUrl: row.previewStatus === 'ready' ? (row.previewUrl ?? null) : null,
  };
}

export interface PostCardContext {
  viewerId: string | null;
  canSeeIdentity: boolean;
  liked: Set<string>;
  bookmarked: Set<string>;
}

export function toZonePostCardView(row: ZonePostCardRow, ctx: PostCardContext): ZonePostCardView {
  const viewerId = ctx.viewerId;
  const isAuthor = !!viewerId && (viewerId === row.authorId || row.coauthors.some((c) => c.userId === viewerId));
  return {
    id: row.id,
    zone: { id: row.zone.id, slug: row.zone.slug, name: row.zone.name },
    type: row.type,
    title: row.title,
    summary: row.summary,
    coverUrl: row.coverUrl,
    linkUrl: row.linkUrl,
    tags: row.tags,
    status: row.status,
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    editedAt: iso(row.editedAt),
    pinned: row.pinned,
    locked: row.locked,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    viewCount: row.viewCount,
    bookmarkCount: row.bookmarkCount,
    readMinutes: estimateReadMinutes(row.bodyMd),
    author: toPublicAuthor(row.author, ctx.canSeeIdentity),
    coauthors: row.coauthors.map((c) => toPublicAuthor(c.user, ctx.canSeeIdentity)),
    attachmentCount: row.attachments.length,
    attachmentKinds: [...new Set(row.attachments.map((a) => a.kind))],
    likedByMe: ctx.liked.has(row.id),
    bookmarkedByMe: ctx.bookmarked.has(row.id),
    isAuthor,
  };
}

/** Per-viewer flags for a page of posts — two IN-queries, never per row. */
export async function viewerPostSets(
  viewerId: string | null,
  ids: string[],
): Promise<{ liked: Set<string>; bookmarked: Set<string> }> {
  if (!viewerId || ids.length === 0) return { liked: new Set(), bookmarked: new Set() };
  const [likes, marks] = await Promise.all([
    prisma.zonePostLike.findMany({ where: { userId: viewerId, postId: { in: ids } }, select: { postId: true } }),
    prisma.zonePostBookmark.findMany({ where: { userId: viewerId, postId: { in: ids } }, select: { postId: true } }),
  ]);
  return { liked: new Set(likes.map((l) => l.postId)), bookmarked: new Set(marks.map((b) => b.postId)) };
}

async function toCardViews(rows: ZonePostCardRow[], viewer: ZoneSiteViewer): Promise<ZonePostCardView[]> {
  if (rows.length === 0) return [];
  const sets = await viewerPostSets(
    viewer.id,
    rows.map((r) => r.id),
  );
  const ctx: PostCardContext = { viewerId: viewer.id, canSeeIdentity: viewer.canSeeIdentity, ...sets };
  return rows.map((r) => toZonePostCardView(r, ctx));
}

// ── Listing ──────────────────────────────────────────────────────────────────

export interface ListZonePostsOptions {
  zone: ZoneAccessRow;
  access: ZoneAccess;
  viewer: ZoneSiteViewer;
  type?: ZonePostTypeValue;
  tag?: string;
  q?: string;
  sort?: ZonePostSort;
  cursor?: string | null;
  limit?: number;
  /** Primary author OR co-author handle. */
  authorHandle?: string;
}

function clampLimit(raw: number | undefined, def = DEFAULT_PAGE, max = MAX_PAGE): number {
  const n = Number(raw ?? def);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.trunc(n))) : def;
}

export async function listZonePosts(
  o: ListZonePostsOptions,
): Promise<{ items: ZonePostCardView[]; hasMore: boolean; nextCursor: string | null }> {
  if (!o.access.canRead) return { items: [], hasMore: false, nextCursor: null };
  const limit = clampLimit(o.limit);
  const sort: ZonePostSort = o.sort === 'hot' ? 'hot' : 'new';
  const q = (o.q ?? '').trim().slice(0, 64);
  const tag = (o.tag ?? '').trim().slice(0, 24);
  const authorHandle = (o.authorHandle ?? '').trim();

  const cursor = sort === 'new' ? decodeTimeCursor(o.cursor) : null;
  const offset = sort === 'hot' ? decodeOffsetCursor(o.cursor) : 0;
  const firstPage = sort === 'new' ? !cursor : offset === 0;
  // Pinned rows are hoisted on the first page (and hidden from later pages)
  // unless a search is active — search results are a flat ranking.
  const pinnedMode = !q;

  const and: Prisma.ZonePostWhereInput[] = [{ zoneId: o.zone.id, ...PUBLISHED_WHERE }];
  if (o.type) and.push({ type: o.type });
  if (tag) and.push({ tags: { has: tag } });
  if (authorHandle) {
    and.push({ OR: [{ author: { handle: authorHandle } }, { coauthors: { some: { user: { handle: authorHandle } } } }] });
  }
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { bodyMd: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  const filters: Prisma.ZonePostWhereInput = { AND: and };

  const pinned =
    pinnedMode && firstPage
      ? await prisma.zonePost.findMany({
          where: { AND: [...and, { pinned: true }] },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: ZONE_LIMITS.maxPinnedPosts,
          select: ZONE_POST_CARD_SELECT,
        })
      : [];

  const orderBy: Prisma.ZonePostOrderByWithRelationInput[] =
    sort === 'hot'
      ? [{ likeCount: 'desc' }, { commentCount: 'desc' }, { viewCount: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }]
      : [{ publishedAt: 'desc' }, { id: 'desc' }];

  const rows = await prisma.zonePost.findMany({
    where: {
      AND: [
        filters,
        ...(pinnedMode ? [{ pinned: false }] : []),
        ...(cursor
          ? [
              {
                OR: [
                  { publishedAt: { lt: cursor.at } },
                  { publishedAt: cursor.at, id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy,
    ...(sort === 'hot' ? { skip: offset } : {}),
    take: limit + 1,
    select: ZONE_POST_CARD_SELECT,
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = await toCardViews([...pinned, ...page], o.viewer);
  const last = page[page.length - 1];
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? sort === 'hot'
          ? `o:${offset + limit}`
          : encodeTimeCursor({ at: last.publishedAt ?? last.createdAt, id: last.id })
        : null,
  };
}

export async function listMyDrafts(zoneId: string, viewer: ZoneSiteViewer, access: ZoneAccess): Promise<ZonePostCardView[]> {
  // Gated on READ + own authorship (the where clause below), never on `post`:
  // a member who lost `post` must still see and clean up their own drafts.
  if (!viewer.id || !access.canRead) return [];
  const rows = await prisma.zonePost.findMany({
    where: {
      zoneId,
      status: 'draft',
      deletedAt: null,
      OR: [{ authorId: viewer.id }, { coauthors: { some: { userId: viewer.id } } }],
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: ZONE_POST_CARD_SELECT,
  });
  return toCardViews(rows, viewer);
}

export async function getZonePostDetail(
  postId: string,
  zone: ZoneAccessRow,
  access: ZoneAccess,
  viewer: ZoneSiteViewer,
  opts: { session?: Session | null; locale?: string } = {},
): Promise<ZonePostDetailView | null> {
  const row = await prisma.zonePost.findFirst({
    where: { id: postId, zoneId: zone.id },
    select: ZONE_POST_DETAIL_SELECT,
  });
  if (!row) return null;
  // A soft-deleted post is gone for everyone but site staff (restore path).
  if (row.deletedAt && !viewer.siteAdmin) return null;
  const isAuthor = !!viewer.id && (viewer.id === row.authorId || row.coauthors.some((c) => c.userId === viewer.id));
  const published = row.status === 'published' && !row.deletedAt;
  if (!((published && access.canRead) || isAuthor || access.canModerate)) return null;

  const [sets, embeds] = await Promise.all([
    viewerPostSets(viewer.id, [row.id]),
    resolveEmbeds(collectEmbedRefs(row.bodyMd), { viewer, session: opts.session ?? null, locale: opts.locale }),
  ]);
  const card = toZonePostCardView(row, { viewerId: viewer.id, canSeeIdentity: viewer.canSeeIdentity, ...sets });
  return {
    ...card,
    bodyMd: row.bodyMd,
    attachments: row.attachments.map(toAttachmentView),
    headings: extractHeadings(row.bodyMd),
    embeds,
  };
}

// ── Input schemas ────────────────────────────────────────────────────────────

export interface AttachmentInput {
  key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  posterKey?: string | null;
}

export const attachmentInputSchema = z.object({
  key: z.string().trim().min(1).max(200),
  name: z.string().max(200).default(''),
  mimeType: z.string().max(100).default(''),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  posterKey: z.string().max(200).nullish(),
}) satisfies z.ZodType<AttachmentInput, z.ZodTypeDef, unknown>;

export interface ZonePostInput {
  type: ZonePostTypeValue;
  title: string;
  summary: string;
  bodyMd: string;
  coverKey: string | null;
  linkUrl: string | null;
  tags: string[];
  coauthorIds: string[];
  attachments: AttachmentInput[];
  status: 'draft' | 'published';
}

export const zonePostInputSchema = z.object({
  type: z.enum(ZONE_POST_TYPES),
  title: z.string().trim().min(ZONE_LIMITS.postTitleMin).max(ZONE_LIMITS.postTitleMax),
  summary: z.string().trim().max(ZONE_LIMITS.postSummaryMax).default(''),
  bodyMd: z.string().max(ZONE_LIMITS.postBodyMax).default(''),
  coverKey: z.string().trim().max(200).nullable().default(null),
  linkUrl: z.string().trim().max(2048).nullable().default(null),
  tags: z.array(z.string().max(64)).max(MAX_ZONE_POST_TAGS * 2).default([]),
  coauthorIds: z.array(z.string().min(1).max(64)).max(ZONE_LIMITS.maxCoauthors).default([]),
  attachments: z.array(attachmentInputSchema).max(MAX_ZONE_ATTACHMENTS).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
}) satisfies z.ZodType<ZonePostInput, z.ZodTypeDef, unknown>;

// ── Attachments ──────────────────────────────────────────────────────────────

export interface ResolvedAttachment {
  kind: ZoneAttachmentKindView;
  key: string;
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  posterUrl: string | null;
  previewStatus: Extract<ZonePreviewStatusView, 'none' | 'pending' | 'unsupported'>;
  sortOrder: number;
  ext: string;
}

function kindOfKey(key: string): ZoneAttachmentKindView | null {
  if (key.startsWith('image/')) return 'image';
  if (key.startsWith('video/')) return 'video';
  if (key.startsWith('file/')) return 'file';
  return null;
}

function initialPreviewStatus(kind: ZoneAttachmentKindView, ext: string): ResolvedAttachment['previewStatus'] {
  if (kind !== 'file') return 'none';
  if (isOfficePreviewable(ext)) return 'pending';
  return ext === 'pdf' ? 'none' : 'unsupported';
}

function cleanName(raw: string, fallbackKey: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return cleaned || fallbackKey.split('/').pop() || 'attachment';
}

/**
 * Validate the attachments echoed by a composer: key shape (kind by prefix),
 * per-kind caps, files on disk, and — since keys are visible in every URL —
 * not already attached to a different post. Sizes come from the disk stat, not
 * the client. Returns null on ANY invalid item (the route 400s).
 */
export async function resolveAttachmentInputs(
  items: AttachmentInput[],
  opts: { excludePostId?: string } = {},
): Promise<ResolvedAttachment[] | null> {
  if (items.length > MAX_ZONE_ATTACHMENTS) return null;
  const out: ResolvedAttachment[] = [];
  const seen = new Set<string>();
  const posterKeys: string[] = [];
  const counts = { image: 0, video: 0, file: 0 };

  for (const item of items) {
    const key = (item.key ?? '').trim();
    if (!isValidZoneMediaKey(key)) return null;
    const kind = kindOfKey(key);
    if (!kind) return null;
    if (seen.has(key)) return null;
    seen.add(key);
    counts[kind]++;

    let posterUrl: string | null = null;
    const posterKey = (item.posterKey ?? '').trim();
    if (kind === 'video' && posterKey) {
      if (!isValidZoneMediaKey(posterKey, 'poster')) return null;
      posterKeys.push(posterKey);
      posterUrl = zoneMediaPublicUrl(posterKey);
    }

    const name = cleanName(item.name ?? '', key);
    const mimeType = (item.mimeType ?? '').trim().slice(0, 100);
    const ext = extOfName(name) || extOfName(key) || extFromMime(mimeType);
    const dims = kind === 'file' ? { width: null, height: null } : { width: item.width ?? null, height: item.height ?? null };
    out.push({
      kind,
      key,
      url: zoneMediaPublicUrl(key),
      name,
      mimeType,
      sizeBytes: 0,
      ...dims,
      posterUrl,
      previewStatus: initialPreviewStatus(kind, ext),
      sortOrder: out.length,
      ext,
    });
  }

  if (
    counts.image > ZONE_ATTACHMENT_LIMITS.images ||
    counts.video > ZONE_ATTACHMENT_LIMITS.videos ||
    counts.file > ZONE_ATTACHMENT_LIMITS.files
  ) {
    return null;
  }
  if (out.length === 0) return out;

  const [stats, posterStats] = await Promise.all([
    Promise.all(out.map((a) => statZoneMediaAsync(a.key))),
    Promise.all(posterKeys.map((k) => statZoneMediaAsync(k))),
  ]);
  if (stats.some((s) => !s) || posterStats.some((s) => !s)) return null;

  const taken = await prisma.zonePostAttachment.count({
    where: {
      key: { in: out.map((a) => a.key) },
      ...(opts.excludePostId ? { postId: { not: opts.excludePostId } } : {}),
    },
  });
  if (taken > 0) return null;

  return out.map((a, i) => {
    const stat = stats[i];
    return { ...a, sizeBytes: Math.min(stat ? stat.size : 0, INT32_MAX) };
  });
}

/** Unlink zone-media files that no attachment / preview / poster / post cover references any more. */
async function deleteUnreferencedZoneFiles(keys: (string | null | undefined)[]): Promise<void> {
  for (const key of new Set(keys.filter((k): k is string => !!k))) {
    try {
      const url = zoneMediaPublicUrl(key);
      const [attachments, covers] = await Promise.all([
        prisma.zonePostAttachment.count({ where: { OR: [{ key }, { previewKey: key }, { posterUrl: url }] } }),
        prisma.zonePost.count({ where: { coverKey: key } }),
      ]);
      if (attachments + covers === 0) await deleteZoneMediaFile(key);
    } catch {
      /* best-effort — orphans are reclaimed on the next delete touching the key */
    }
  }
}

// ── Create / update ──────────────────────────────────────────────────────────

async function validateCoauthors(zone: ZoneAccessRow, authorId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((s) => s.trim()).filter((id) => id && id !== authorId))].slice(0, ZONE_LIMITS.maxCoauthors);
  if (unique.length === 0) return [];
  const needMembership = unique.filter((id) => id !== zone.ownerId);
  if (needMembership.length > 0) {
    const n = await prisma.zoneMember.count({
      where: { zoneId: zone.id, status: 'active', userId: { in: needMembership } },
    });
    if (n !== needMembership.length) throw new ZoneError('coauthor_not_member', 400);
  }
  return unique;
}

async function validateCover(coverKey: string | null): Promise<{ coverKey: string | null; coverUrl: string | null }> {
  const key = (coverKey ?? '').trim();
  if (!key) return { coverKey: null, coverUrl: null };
  if (!isValidZoneMediaKey(key, 'image')) throw new ZoneError('cover_invalid', 400);
  const stat = await statZoneMediaAsync(key);
  if (!stat) throw new ZoneError('cover_invalid', 400);
  return { coverKey: key, coverUrl: zoneMediaPublicUrl(key) };
}

function summaryOf(summary: string, bodyMd: string): string {
  const s = summary.trim().slice(0, ZONE_LIMITS.postSummaryMax);
  return s || excerptOf(bodyMd, 200);
}

function resolveLinkUrl(type: ZonePostTypeValue, raw: string | null): string | null {
  const url = normalizeHttpUrl(raw);
  if (type === 'link' && !url) throw new ZoneError('link_required', 400);
  if (raw && raw.trim() && !url) throw new ZoneError('link_invalid', 400);
  return url;
}

export async function createZonePost(zone: ZoneAccessRow, authorId: string, input: ZonePostInput): Promise<{ id: string }> {
  const title = input.title.trim();
  if (title.length < ZONE_LIMITS.postTitleMin) throw new ZoneError('title_required', 400);
  const bodyMd = input.bodyMd ?? '';
  const [coauthorIds, attachments, cover] = await Promise.all([
    validateCoauthors(zone, authorId, input.coauthorIds ?? []),
    resolveAttachmentInputs(input.attachments ?? []),
    validateCover(input.coverKey),
  ]);
  if (!attachments) throw new ZoneError('attachments_invalid', 400);
  const linkUrl = resolveLinkUrl(input.type, input.linkUrl);
  const publish = input.status === 'published';
  const now = new Date();

  const created = await prisma.$transaction(async (tx) => {
    const post = await tx.zonePost.create({
      data: {
        zoneId: zone.id,
        authorId,
        type: input.type,
        title: title.slice(0, ZONE_LIMITS.postTitleMax),
        summary: summaryOf(input.summary ?? '', bodyMd),
        bodyMd,
        coverKey: cover.coverKey,
        coverUrl: cover.coverUrl,
        linkUrl,
        tags: normalizeTags(input.tags),
        status: publish ? 'published' : 'draft',
        publishedAt: publish ? now : null,
        coauthors: { create: coauthorIds.map((userId, i) => ({ userId, sortOrder: i })) },
        attachments: {
          create: attachments.map((a) => ({
            kind: a.kind,
            key: a.key,
            url: a.url,
            name: a.name,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            width: a.width,
            height: a.height,
            posterUrl: a.posterUrl,
            previewStatus: a.previewStatus,
            sortOrder: a.sortOrder,
          })),
        },
      },
      select: { id: true, attachments: { select: { id: true, previewStatus: true } } },
    });
    if (publish) {
      await tx.zone.update({ where: { id: zone.id }, data: { postCount: { increment: 1 }, lastActivityAt: now } });
    }
    return post;
  });

  for (const a of created.attachments) if (a.previewStatus === 'pending') scheduleOfficePreview(a.id);
  return { id: created.id };
}

export async function updateZonePost(postId: string, patch: Partial<ZonePostInput>): Promise<void> {
  const existing = await prisma.zonePost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      zoneId: true,
      authorId: true,
      type: true,
      title: true,
      summary: true,
      bodyMd: true,
      coverKey: true,
      linkUrl: true,
      status: true,
      publishedAt: true,
      deletedAt: true,
      zone: {
        select: {
          id: true,
          slug: true,
          name: true,
          ownerId: true,
          visibility: true,
          joinPolicy: true,
          allowGuestComments: true,
          deletedAt: true,
        },
      },
      attachments: { select: { id: true, key: true, previewKey: true, posterUrl: true } },
    },
  });
  if (!existing || existing.deletedAt) throw new ZoneError('not_found', 404);

  const type = patch.type ?? existing.type;
  const title = patch.title !== undefined ? patch.title.trim() : existing.title;
  if (title.length < ZONE_LIMITS.postTitleMin) throw new ZoneError('title_required', 400);
  const bodyMd = patch.bodyMd !== undefined ? patch.bodyMd : existing.bodyMd;

  const [coauthorIds, attachments, cover] = await Promise.all([
    patch.coauthorIds !== undefined ? validateCoauthors(existing.zone, existing.authorId, patch.coauthorIds) : Promise.resolve(null),
    patch.attachments !== undefined
      ? resolveAttachmentInputs(patch.attachments, { excludePostId: existing.id })
      : Promise.resolve(undefined),
    patch.coverKey !== undefined ? validateCover(patch.coverKey) : Promise.resolve(null),
  ]);
  if (attachments === null) throw new ZoneError('attachments_invalid', 400);
  // Re-validate the link whenever it or the type is part of the patch (a
  // switch TO `link` must bring a URL along); otherwise the stored one stays.
  const linkUrl =
    patch.linkUrl !== undefined || patch.type !== undefined
      ? resolveLinkUrl(type, patch.linkUrl !== undefined ? patch.linkUrl : existing.linkUrl)
      : undefined;

  const contentChanged = title !== existing.title || bodyMd !== existing.bodyMd;
  const now = new Date();
  const nextStatus = patch.status ?? existing.status;
  const publishing = existing.status === 'draft' && nextStatus === 'published';
  const unpublishing = existing.status === 'published' && nextStatus === 'draft';

  const existingKeys = new Set(existing.attachments.map((a) => a.key));
  const newKeys = attachments ? attachments.map((a) => a.key) : null;
  const removedRows = newKeys ? existing.attachments.filter((a) => !newKeys.includes(a.key)) : [];
  const brandNewKeys = newKeys ? newKeys.filter((k) => !existingKeys.has(k)) : [];

  const data: Prisma.ZonePostUpdateInput = {
    type,
    title: title.slice(0, ZONE_LIMITS.postTitleMax),
    bodyMd,
    ...(patch.summary !== undefined || patch.bodyMd !== undefined
      ? { summary: summaryOf(patch.summary !== undefined ? patch.summary : existing.summary, bodyMd) }
      : {}),
    ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    ...(linkUrl !== undefined ? { linkUrl } : {}),
    ...(cover ? { coverKey: cover.coverKey, coverUrl: cover.coverUrl } : {}),
    ...(contentChanged && existing.status === 'published' ? { editedAt: now } : {}),
  };

  await prisma.$transaction(async (tx) => {
    await tx.zonePost.update({ where: { id: existing.id }, data });

    if (coauthorIds) {
      await tx.zonePostAuthor.deleteMany({ where: { postId: existing.id } });
      if (coauthorIds.length > 0) {
        await tx.zonePostAuthor.createMany({
          data: coauthorIds.map((userId, i) => ({ postId: existing.id, userId, sortOrder: i })),
          skipDuplicates: true,
        });
      }
    }

    if (attachments && newKeys) {
      await tx.zonePostAttachment.deleteMany({
        where: { postId: existing.id, ...(newKeys.length > 0 ? { key: { notIn: newKeys } } : {}) },
      });
      for (const a of attachments) {
        // Update ONLY a row this post already owns — an upsert keyed on `key`
        // alone would silently rewrite the row of whichever post holds that key.
        const mine = await tx.zonePostAttachment.updateMany({
          where: { key: a.key, postId: existing.id },
          data: {
            name: a.name,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            width: a.width,
            height: a.height,
            posterUrl: a.posterUrl,
            sortOrder: a.sortOrder,
          },
        });
        if (mine.count > 0) continue;
        try {
          await tx.zonePostAttachment.create({
            data: {
              postId: existing.id,
              kind: a.kind,
              key: a.key,
              url: a.url,
              name: a.name,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              width: a.width,
              height: a.height,
              posterUrl: a.posterUrl,
              previewStatus: a.previewStatus,
              sortOrder: a.sortOrder,
            },
          });
        } catch (e) {
          // The `@unique key` index is the ownership backstop that
          // resolveAttachmentInputs' pre-check relies on: a key claimed by
          // another post is rejected, never stolen.
          if (isUniqueViolation(e)) throw new ZoneError('attachments_invalid', 400);
          throw e;
        }
      }
    }

    // The draft <-> published flip is a GUARDED write: `existing.status` was
    // read OUTSIDE this transaction, so only the statement that actually moves
    // the row may move `Zone.postCount` — two concurrent PATCHes, or a publish
    // racing a soft-delete, must never double-count.
    if (publishing) {
      const flipped = await tx.zonePost.updateMany({
        where: { id: existing.id, status: 'draft', deletedAt: null },
        data: { status: 'published', publishedAt: existing.publishedAt ?? now },
      });
      if (flipped.count > 0) {
        await tx.zone.update({ where: { id: existing.zoneId }, data: { postCount: { increment: 1 }, lastActivityAt: now } });
      }
    } else if (unpublishing) {
      const flipped = await tx.zonePost.updateMany({
        where: { id: existing.id, status: 'published', deletedAt: null },
        data: { status: 'draft', pinned: false },
      });
      if (flipped.count > 0) {
        await tx.zone.updateMany({ where: { id: existing.zoneId, postCount: { gt: 0 } }, data: { postCount: { decrement: 1 } } });
      }
    }
  });

  // Files no row references any more: removed attachments (+ their PDF
  // previews and posters) and a replaced cover. Refcounted — a key kept as the
  // cover or attached again survives.
  const doomed: (string | null | undefined)[] = [];
  for (const r of removedRows) doomed.push(r.key, r.previewKey, zoneMediaKeyFromUrl(r.posterUrl));
  if (cover && existing.coverKey && existing.coverKey !== cover.coverKey) doomed.push(existing.coverKey);
  if (doomed.length > 0) void deleteUnreferencedZoneFiles(doomed);

  if (brandNewKeys.length > 0) {
    const fresh = await prisma.zonePostAttachment.findMany({
      where: { postId: existing.id, key: { in: brandNewKeys }, previewStatus: 'pending' },
      select: { id: true },
    });
    for (const a of fresh) scheduleOfficePreview(a.id);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function isSerializationFailure(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
}

export async function setZonePostFlags(postId: string, flags: { pinned?: boolean; locked?: boolean }): Promise<void> {
  if (flags.pinned === undefined && flags.locked === undefined) return;
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const post = await tx.zonePost.findUnique({
            where: { id: postId },
            select: { id: true, zoneId: true, pinned: true, status: true, deletedAt: true },
          });
          if (!post || post.deletedAt) throw new ZoneError('not_found', 404);
          if (flags.pinned === true && !post.pinned) {
            if (post.status !== 'published') throw new ZoneError('not_published', 400);
            const n = await tx.zonePost.count({
              where: { zoneId: post.zoneId, pinned: true, deletedAt: null, id: { not: post.id } },
            });
            if (n >= ZONE_LIMITS.maxPinnedPosts) throw new ZoneError('too_many_pinned', 400);
          }
          await tx.zonePost.update({
            where: { id: post.id },
            data: {
              ...(flags.pinned !== undefined ? { pinned: flags.pinned } : {}),
              ...(flags.locked !== undefined ? { locked: flags.locked } : {}),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return;
    } catch (e) {
      if (isSerializationFailure(e) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 40));
        continue;
      }
      throw e;
    }
  }
}

export async function softDeleteZonePost(postId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const post = await tx.zonePost.findUnique({
      where: { id: postId },
      select: { id: true, zoneId: true, deletedAt: true },
    });
    if (!post || post.deletedAt) return;
    const now = new Date();
    // The status is part of the GUARD, not of a prior read: only the statement
    // that removes a row that is STILL published owns the decrement (a racing
    // unpublish, or a second delete, has already taken it).
    const wasPublished = await tx.zonePost.updateMany({
      where: { id: post.id, deletedAt: null, status: 'published' },
      data: { deletedAt: now, pinned: false },
    });
    if (wasPublished.count > 0) {
      await tx.zone.updateMany({ where: { id: post.zoneId, postCount: { gt: 0 } }, data: { postCount: { decrement: 1 } } });
      return;
    }
    // Draft (or already deleted) — delete it without touching the counter.
    await tx.zonePost.updateMany({
      where: { id: post.id, deletedAt: null },
      data: { deletedAt: now, pinned: false },
    });
  });
}

/** Day-bucketed view dedupe (array tx: a duplicate insert rolls the increment back). */
export async function recordZonePostView(postId: string, viewerKey: string): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const sessionHash = createHash('sha256').update(`${viewerKey}:${postId}:${day}`).digest('hex');
    await prisma.$transaction([
      prisma.zonePostView.create({ data: { postId, sessionHash } }),
      prisma.zonePost.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } }),
    ]);
  } catch {
    /* already viewed today, or post gone — fine */
  }
}

// ── Comments (2-level flat threads) ──────────────────────────────────────────

export const REPLY_PREVIEW_COUNT = 2;
const MAX_REPLIES_RENDER = 200;

export const ZONE_COMMENT_SELECT = {
  id: true,
  postId: true,
  parentId: true,
  bodyMd: true,
  status: true,
  likeCount: true,
  replyCount: true,
  createdAt: true,
  editedAt: true,
  authorId: true,
  author: AUTHOR_IDENTITY_SELECT,
} satisfies Prisma.ZonePostCommentSelect;

export type ZoneCommentRow = Prisma.ZonePostCommentGetPayload<{ select: typeof ZONE_COMMENT_SELECT }>;

export function toZoneCommentView(row: ZoneCommentRow, viewer: ZoneSiteViewer, liked: ReadonlySet<string>): ZoneCommentView {
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId,
    bodyMd: row.status === 'deleted' ? '' : row.bodyMd,
    status: row.status,
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    createdAt: iso(row.createdAt),
    editedAt: iso(row.editedAt),
    author: toPublicAuthor(row.author, viewer.canSeeIdentity),
    isMine: !!viewer.id && viewer.id === row.authorId,
    likedByMe: liked.has(row.id),
  };
}

export async function viewerCommentLikeSet(viewerId: string | null, ids: string[]): Promise<Set<string>> {
  if (!viewerId || ids.length === 0) return new Set();
  const rows = await prisma.zonePostCommentLike.findMany({
    where: { userId: viewerId, commentId: { in: ids } },
    select: { commentId: true },
  });
  return new Set(rows.map((r) => r.commentId));
}

const THREAD_SELECT = {
  ...ZONE_COMMENT_SELECT,
  replies: { orderBy: { createdAt: 'asc' as const }, take: REPLY_PREVIEW_COUNT, select: ZONE_COMMENT_SELECT },
} satisfies Prisma.ZonePostCommentSelect;

type ThreadRow = Prisma.ZonePostCommentGetPayload<{ select: typeof THREAD_SELECT }>;

async function toThreadViews(rows: ThreadRow[], viewer: ZoneSiteViewer): Promise<ZoneThreadView[]> {
  const ids = rows.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]);
  const liked = await viewerCommentLikeSet(viewer.id, ids);
  return rows.map((c) => ({
    ...toZoneCommentView(c, viewer, liked),
    replies: c.replies.map((r) => toZoneCommentView(r, viewer, liked)),
  }));
}

/** Offset paging on purpose — the 最热 ordering shifts under new likes, so a keyset would skip rows. */
export async function listZoneComments(
  postId: string,
  opts: { sort?: 'relevant' | 'recent'; skip?: number; take?: number; viewer: ZoneSiteViewer },
): Promise<{ items: ZoneThreadView[]; totalRoots: number; hasMore: boolean }> {
  const skip = Math.max(0, Math.trunc(Number(opts.skip ?? 0)) || 0);
  const take = clampLimit(opts.take, 10, 20);
  const orderBy: Prisma.ZonePostCommentOrderByWithRelationInput[] =
    opts.sort === 'recent'
      ? [{ createdAt: 'desc' }, { id: 'desc' }]
      : [{ likeCount: 'desc' }, { replyCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
  const where: Prisma.ZonePostCommentWhereInput = { postId, parentId: null };
  const [totalRoots, rows] = await Promise.all([
    prisma.zonePostComment.count({ where }),
    prisma.zonePostComment.findMany({ where, orderBy, skip, take, select: THREAD_SELECT }),
  ]);
  const items = await toThreadViews(rows, opts.viewer);
  return { items, totalRoots, hasMore: skip + rows.length < totalRoots };
}

export async function listZoneCommentReplies(commentId: string, viewer: ZoneSiteViewer): Promise<ZoneCommentView[]> {
  const rows = await prisma.zonePostComment.findMany({
    where: { parentId: commentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_REPLIES_RENDER,
    select: ZONE_COMMENT_SELECT,
  });
  const liked = await viewerCommentLikeSet(
    viewer.id,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toZoneCommentView(r, viewer, liked));
}

/** A thread ROOT with its reply preview; null for a reply id (resolve `parentId` first). */
export async function getZoneCommentThread(commentId: string, viewer: ZoneSiteViewer): Promise<ZoneThreadView | null> {
  const row = await prisma.zonePostComment.findFirst({ where: { id: commentId, parentId: null }, select: THREAD_SELECT });
  if (!row) return null;
  const [thread] = await toThreadViews([row], viewer);
  return thread ?? null;
}

// ── Cross-zone lists ─────────────────────────────────────────────────────────

/** The viewer's bookmarks, newest first, only from zones they may read. */
export async function listBookmarkedPosts(viewer: ZoneSiteViewer, take = 50): Promise<ZonePostCardView[]> {
  if (!viewer.id) return [];
  const rows = await prisma.zonePostBookmark.findMany({
    where: { userId: viewer.id, post: { ...PUBLISHED_WHERE, zone: readableZoneWhere(viewer) } },
    orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
    take: clampLimit(take, 50, 200),
    select: { post: { select: ZONE_POST_CARD_SELECT } },
  });
  return toCardViews(
    rows.map((r) => r.post),
    viewer,
  );
}

/** Hub band: newest published posts across public zones + the viewer's zones. */
export async function listRecentPostsAcrossZones(viewer: ZoneSiteViewer, take = 8): Promise<ZonePostCardView[]> {
  const rows = await prisma.zonePost.findMany({
    where: { ...PUBLISHED_WHERE, zone: readableZoneWhere(viewer) },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: clampLimit(take, 8, 50),
    select: ZONE_POST_CARD_SELECT,
  });
  return toCardViews(rows, viewer);
}

/** Profile use: posts authored or co-authored by a user, in zones the viewer may read. */
export async function listPostsByAuthorAcrossZones(userId: string, viewer: ZoneSiteViewer, take = 20): Promise<ZonePostCardView[]> {
  const rows = await prisma.zonePost.findMany({
    where: {
      ...PUBLISHED_WHERE,
      OR: [{ authorId: userId }, { coauthors: { some: { userId } } }],
      zone: readableZoneWhere(viewer),
    },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: clampLimit(take, 20, 100),
    select: ZONE_POST_CARD_SELECT,
  });
  return toCardViews(rows, viewer);
}
