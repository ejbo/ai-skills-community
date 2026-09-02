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
// key format alone does not prove ownership). Counts are unlimited (product
// decision 2026-09-01); only the hidden MAX_ATTACHMENT_ROWS_PER_POST sanity cap
// bounds one request. Edits replace the attachment set wholesale and unlink
// the files (plus their PDF previews / posters) that no row references any
// more. Every `[embed:file:<storage key>]` token in the body is UNIONED into
// the attachment set before validation (`resolvePostAttachments`), so a file
// dropped into the 正文 is never an orphan — a body key another post already
// owns (or that is not on disk) is simply not claimed, never a save failure.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Session } from 'next-auth';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { extractMentionHandles, newMentionHandles } from '@/lib/mentions';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import type { ZoneAccessRow, ZoneSiteViewer } from './access';
import { getOrCreateColumn, recountZoneColumns } from './columns';
import { resolveEmbeds } from './embeds';
import { ZoneError } from './errors';
import { scheduleOfficePreview } from './office-preview';
import type { ZoneAccess, ZoneVisibilityValue } from './permissions';
import {
  decideZonePostAccess,
  isZonePostAuthor,
  zonePostAccessContext,
  type ZonePostAccessDecision,
} from './post-access';
import { readableZoneWhere, zoneOrgTree } from './queries';
import {
  ACCESS_CODE_ALPHABET,
  ACCESS_CODE_LENGTH,
  MAX_ATTACHMENT_ROWS_PER_POST,
  MAX_ZONE_POST_TAGS,
  UNCATEGORIZED_COLUMN_PARAM,
  ZONE_LIMITS,
  ZONE_POST_TYPES,
  ZONE_POST_VISIBILITIES,
  bodyFileKeys,
  collectEmbedRefs,
  decodeOffsetCursor,
  decodeTimeCursor,
  encodeTimeCursor,
  estimateReadMinutes,
  excerptOf,
  extOfName,
  extractHeadings,
  isOfficePreviewable,
  isValidAccessCode,
  mergeBodyFileKeys,
  normalizeAccessCode,
  normalizeHttpUrl,
  normalizeTags,
  zonePostHref,
  type ZoneFeedSort,
  type ZonePostSort,
  type ZonePostTypeValue,
  type ZonePostVisibilityValue,
} from './shared';
import {
  deleteZoneMediaFile,
  isValidZoneMediaKey,
  statZoneMediaAsync,
  zoneMediaKeyFromUrl,
  zoneMediaPublicUrl,
} from './storage';
import type {
  EmbedData,
  ZoneAttachmentKindView,
  ZoneAttachmentView,
  ZoneCommentView,
  ZoneFeedResult,
  ZoneHubFacets,
  ZonePostCardView,
  ZonePostDetailView,
  ZonePreviewStatusView,
  ZoneThreadView,
} from './types';

// `readableZoneWhere` lives in ./queries (so that module needs no import back
// from here); re-exported because lib/zones/embeds.ts imports it from this one.
export { readableZoneWhere };

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
  editedById: true,
  editedBy: AUTHOR_IDENTITY_SELECT,
  pinned: true,
  locked: true,
  likeCount: true,
  commentCount: true,
  viewCount: true,
  bookmarkCount: true,
  // Only for readMinutes — cards never ship the body.
  bodyMd: true,
  visibility: true,
  columnId: true,
  column: { select: { id: true, slug: true, name: true, official: true } },
  authorId: true,
  author: AUTHOR_IDENTITY_SELECT,
  coauthors: {
    orderBy: { sortOrder: 'asc' as const },
    select: { userId: true, sortOrder: true, user: AUTHOR_IDENTITY_SELECT },
  },
  attachments: { orderBy: { sortOrder: 'asc' as const }, select: { kind: true } },
  // `iconUrl` is PUBLIC zone metadata (the hub shows every readable zone's
  // icon) — the only zone field beyond identity a feed row ships.
  zone: { select: { id: true, slug: true, name: true, iconUrl: true } },
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
  // Privileged-only in the payload (see toZonePostDetailView) — never mapped
  // into a view for a viewer who is not the author / a co-author / 版主.
  accessCode: true,
  attachments: { orderBy: { sortOrder: 'asc' as const }, select: ZONE_ATTACHMENT_SELECT },
} satisfies Prisma.ZonePostSelect;

const PUBLISHED_WHERE = { status: 'published', deletedAt: null } satisfies Prisma.ZonePostWhereInput;

// ── 帖子可见性 (the SQL half of lib/zones/post-access.ts) ─────────────────────
//
// LIST surfaces must EXCLUDE what a viewer may not see instead of fetching and
// filtering afterwards — a post dropped after the query breaks `hasMore`, the
// keyset cursor and every count. `decideZonePostAccess` is the same policy for
// a single row; keep the two in step.

/** Zones where the viewer is the owner or an active member. */
function viewerZoneMemberWhere(userId: string): Prisma.ZoneWhereInput {
  return { OR: [{ ownerId: userId }, { members: { some: { userId, status: 'active' } } }] };
}

/** Zones the viewer moderates: 主版主 (implicit `*`) or a role carrying `moderate`. */
function viewerZoneModeratorWhere(userId: string): Prisma.ZoneWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { members: { some: { userId, status: 'active', role: { is: { permissions: { has: 'moderate' } } } } } },
    ],
  };
}

/**
 * Narrows a post query to what this viewer may see.
 *
 * - `zoneAccess` given (single-zone surfaces): the zone gate was already decided,
 *   so a moderator/site admin gets `{}` (they see drafts too) and a viewer
 *   without `canRead` gets an impossible clause.
 * - `zoneAccess` null (cross-zone surfaces: the hub feed, bookmarks, profiles):
 *   membership and moderation are resolved per zone IN SQL. Pair it with
 *   `zone: readableZoneWhere(viewer)` — this half never widens the zone gate.
 */
export function zonePostVisibilityWhere(
  zoneAccess: ZoneAccess | null,
  viewer: ZoneSiteViewer,
): Prisma.ZonePostWhereInput {
  if (viewer.siteAdmin) return {};
  const uid = viewer.id;

  if (zoneAccess) {
    if (zoneAccess.canModerate) return {};
    if (!zoneAccess.canRead || !uid) return { id: { in: [] } };
    const or: Prisma.ZonePostWhereInput[] = [
      { visibility: 'zone' },
      // Own rows stay visible whatever the visibility says.
      { authorId: uid },
      { coauthors: { some: { userId: uid } } },
      { visibility: 'restricted', viewers: { some: { userId: uid } } },
    ];
    if (zoneAccess.isMember) or.push({ visibility: 'members' });
    return { OR: or };
  }

  if (!uid) return { id: { in: [] } };
  return {
    OR: [
      { visibility: 'zone' },
      { authorId: uid },
      { coauthors: { some: { userId: uid } } },
      { visibility: 'restricted', viewers: { some: { userId: uid } } },
      { visibility: 'members', zone: viewerZoneMemberWhere(uid) },
      // 版主 of that zone: privileged on every post inside it.
      { zone: viewerZoneModeratorWhere(uid) },
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
  /**
   * Post ids rendered as a LOCKED stub (`restricted`, viewer holds no grant).
   * List queries exclude those rows outright, so this is only ever filled on
   * the detail / direct-link path.
   */
  lockedIds?: ReadonlySet<string>;
}

export function toZonePostCardView(row: ZonePostCardRow, ctx: PostCardContext): ZonePostCardView {
  const viewerId = ctx.viewerId;
  const isAuthor = !!viewerId && (viewerId === row.authorId || row.coauthors.some((c) => c.userId === viewerId));
  const accessLocked = ctx.lockedIds?.has(row.id) ?? false;
  return {
    id: row.id,
    zone: { id: row.zone.id, slug: row.zone.slug, name: row.zone.name, iconUrl: row.zone.iconUrl ?? null },
    type: row.type,
    title: row.title,
    // A locked stub never carries content: the summary is an excerpt of the
    // body when the author wrote none, and a `link` post IS its URL.
    summary: accessLocked ? '' : row.summary,
    coverUrl: accessLocked ? null : row.coverUrl,
    linkUrl: accessLocked ? null : row.linkUrl,
    tags: row.tags,
    column: row.column
      ? { id: row.column.id, slug: row.column.slug, name: row.column.name, official: row.column.official }
      : null,
    visibility: row.visibility,
    accessLocked,
    status: row.status,
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    editedAt: iso(row.editedAt),
    // Who last touched the CONTENT — surfaced so a 版主 editing someone else's
    // post is visible rather than silent. Falls back to null before any edit.
    editedBy: row.editedBy ? toPublicAuthor(row.editedBy, ctx.canSeeIdentity) : null,
    pinned: row.pinned,
    locked: row.locked,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    viewCount: row.viewCount,
    bookmarkCount: row.bookmarkCount,
    readMinutes: accessLocked ? 0 : estimateReadMinutes(row.bodyMd),
    author: toPublicAuthor(row.author, ctx.canSeeIdentity),
    coauthors: row.coauthors.map((c) => toPublicAuthor(c.user, ctx.canSeeIdentity)),
    attachmentCount: accessLocked ? 0 : row.attachments.length,
    attachmentKinds: accessLocked ? [] : [...new Set(row.attachments.map((a) => a.kind))],
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
  /**
   * 栏目 filter — the column's slug (what `?column=` carries), its id, or
   * `UNCATEGORIZED_COLUMN_PARAM` (`_none`) for the 未归栏 posts (columnId IS NULL).
   */
  column?: string;
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
  const column = (o.column ?? '').trim().slice(0, 64);

  const cursor = sort === 'new' ? decodeTimeCursor(o.cursor) : null;
  const offset = sort === 'hot' ? decodeOffsetCursor(o.cursor) : 0;
  const firstPage = sort === 'new' ? !cursor : offset === 0;
  // Pinned rows are hoisted on the first page (and hidden from later pages)
  // unless a search is active — search results are a flat ranking.
  const pinnedMode = !q;

  const and: Prisma.ZonePostWhereInput[] = [
    { zoneId: o.zone.id, ...PUBLISHED_WHERE },
    // Exclude, never post-filter: a row dropped after the query would break
    // `hasMore`, the cursor and the pinned/normal split below.
    zonePostVisibilityWhere(o.access, o.viewer),
  ];
  if (o.type) and.push({ type: o.type });
  if (tag) and.push({ tags: { has: tag } });
  // `_none` is collision-proof (COLUMN_SLUG_RE admits no `_`), so it can never
  // shadow a real column — and it must be tested BEFORE the slug/id OR-clause.
  if (column === UNCATEGORIZED_COLUMN_PARAM) and.push({ columnId: null });
  else if (column) and.push({ OR: [{ column: { is: { slug: column } } }, { columnId: column }] });
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

/**
 * The post detail payload. Three outcomes, decided by `decideZonePostAccess`:
 * `hidden` ⇒ null (404 upstream), `locked` ⇒ the stub a `restricted` post shows
 * to someone who has not unlocked it (title + author only — never the body,
 * attachments or embeds; comments are fetched separately and the caller must
 * skip them), otherwise the full view. `accessCode` / `designatedViewers` are
 * shipped ONLY to the author, a co-author, 版主 or site staff.
 */
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

  const decision = await resolveZonePostDecision(row, access, viewer);
  if (decision === 'hidden') return null;
  const locked = decision === 'locked';
  const privileged = decision === 'privileged';
  const restricted = row.visibility === 'restricted';

  const [sets, embeds, designatedViewers] = await Promise.all([
    viewerPostSets(viewer.id, [row.id]),
    locked
      ? Promise.resolve<Record<string, EmbedData>>({})
      : resolveEmbeds(collectEmbedRefs(row.bodyMd), { viewer, session: opts.session ?? null, locale: opts.locale }),
    privileged && restricted ? listDesignatedViewers(row.id, viewer.canSeeIdentity) : Promise.resolve<PublicAuthor[]>([]),
  ]);
  const card = toZonePostCardView(row, {
    viewerId: viewer.id,
    canSeeIdentity: viewer.canSeeIdentity,
    ...sets,
    ...(locked ? { lockedIds: new Set([row.id]) } : {}),
  });
  return {
    ...card,
    bodyMd: locked ? '' : row.bodyMd,
    designatedViewers,
    accessCode: privileged && restricted ? (row.accessCode ?? null) : null,
    attachments: locked ? [] : row.attachments.map(toAttachmentView),
    headings: locked ? [] : extractHeadings(row.bodyMd),
    embeds,
  };
}

/**
 * The minimum a caller must select to run the post gate. Every route that
 * already loads a post row can widen its select to this shape and call
 * `canSeeZonePost` / `assertCanSeeZonePost`.
 */
export type ZonePostAccessSource = {
  id: string;
  authorId: string;
  status: 'draft' | 'published';
  deletedAt?: Date | null;
  visibility: ZonePostVisibilityValue;
  coauthors: { userId: string }[];
};

/** Select fragment matching `ZonePostAccessSource` (spread it into an existing select). */
export const ZONE_POST_ACCESS_SELECT = {
  id: true,
  authorId: true,
  status: true,
  deletedAt: true,
  visibility: true,
  coauthors: { select: { userId: true } },
} satisfies Prisma.ZonePostSelect;

/** `decideZonePostAccess` + the single grant lookup it needs (only for `restricted`). */
async function resolveZonePostDecision(
  row: ZonePostAccessSource,
  access: ZoneAccess,
  viewer: ZoneSiteViewer,
): Promise<ZonePostAccessDecision> {
  const post = {
    authorId: row.authorId,
    coauthorIds: row.coauthors.map((c) => c.userId),
    status: row.status,
    deletedAt: row.deletedAt ?? null,
    visibility: row.visibility,
  };
  const first = decideZonePostAccess(post, zonePostAccessContext(access, false));
  // Only a `restricted` post the viewer has not otherwise earned can flip on a grant.
  if (first !== 'locked' || !viewer.id) return first;
  const granted = await hasZonePostGrant(row.id, viewer.id);
  return granted ? decideZonePostAccess(post, zonePostAccessContext(access, true)) : first;
}

/**
 * Single-row gate for anything hanging off a post (comments, likes, bookmarks,
 * attachments, embeds). `true` means READABLE — a locked `restricted` post
 * answers `false`, because a viewer who only sees the stub must not reach its
 * comments. `assertCanSeeZonePost` throws the house 404 instead.
 */
export async function canSeeZonePost(
  post: ZonePostAccessSource,
  access: ZoneAccess,
  viewer: ZoneSiteViewer,
): Promise<boolean> {
  const decision = await resolveZonePostDecision(post, access, viewer);
  return decision === 'privileged' || decision === 'visible';
}

export async function assertCanSeeZonePost(
  post: ZonePostAccessSource,
  access: ZoneAccess,
  viewer: ZoneSiteViewer,
): Promise<void> {
  if (!(await canSeeZonePost(post, access, viewer))) throw new ZoneError('not_found', 404);
}

/** The full decision (including `locked`) for a post id inside a zone; null when the row is gone. */
export async function zonePostAccessFor(
  postId: string,
  zone: ZoneAccessRow,
  access: ZoneAccess,
  viewer: ZoneSiteViewer,
): Promise<ZonePostAccessDecision | null> {
  const row = await prisma.zonePost.findFirst({
    where: { id: postId, zoneId: zone.id },
    select: ZONE_POST_ACCESS_SELECT,
  });
  if (!row) return null;
  if (row.deletedAt && !viewer.siteAdmin) return null;
  return resolveZonePostDecision(row, access, viewer);
}

// ── 访问授权 (restricted posts) ───────────────────────────────────────────────
//
// A `restricted` post is opened by exactly one thing: a ZonePostViewer row.
// The author designates members directly, or hands out the 访问密码 — redeeming
// it WRITES that same row (`via: 'code'`), so every later check is uniform and
// the author can see who came in through the code.

export type ZonePostGrantViaValue = 'designated' | 'code';

/** Designated viewers a single post may carry (the picker caps the UI at the same number). */
export const MAX_DESIGNATED_VIEWERS = 50;

const GRANT_SELECT = {
  userId: true,
  via: true,
  createdAt: true,
  user: AUTHOR_IDENTITY_SELECT,
} satisfies Prisma.ZonePostViewerSelect;

export interface ZonePostGrantView {
  userId: string;
  user: PublicAuthor;
  via: ZonePostGrantViaValue;
  createdAt: string;
}

async function hasZonePostGrant(postId: string, userId: string): Promise<boolean> {
  const row = await prisma.zonePostViewer.findUnique({
    where: { postId_userId: { postId, userId } },
    select: { postId: true },
  });
  return !!row;
}

async function listDesignatedViewers(postId: string, canSeeIdentity: boolean): Promise<PublicAuthor[]> {
  const rows = await prisma.zonePostViewer.findMany({
    where: { postId, via: 'designated' },
    orderBy: { createdAt: 'asc' },
    take: MAX_DESIGNATED_VIEWERS,
    select: GRANT_SELECT,
  });
  return rows.map((r) => toPublicAuthor(r.user, canSeeIdentity));
}

/** Everyone who may open the post — designated AND code-redeemed (privileged surfaces only). */
export async function listZonePostGrants(postId: string, canSeeIdentity: boolean): Promise<ZonePostGrantView[]> {
  const rows = await prisma.zonePostViewer.findMany({
    where: { postId },
    orderBy: [{ via: 'asc' }, { createdAt: 'asc' }],
    take: 500,
    select: GRANT_SELECT,
  });
  return rows.map((r) => ({
    userId: r.userId,
    user: toPublicAuthor(r.user, canSeeIdentity),
    via: r.via,
    createdAt: iso(r.createdAt),
  }));
}

/** Idempotent (composite PK + skipDuplicates): granting twice is a no-op, never an error. */
export async function grantZonePostAccess(
  postId: string,
  userId: string,
  via: ZonePostGrantViaValue = 'designated',
  grantedById: string | null = null,
): Promise<{ ok: boolean }> {
  if (!postId || !userId) return { ok: false };
  try {
    await prisma.zonePostViewer.createMany({
      data: [{ postId, userId, via, grantedById }],
      skipDuplicates: true,
    });
    return { ok: true };
  } catch (e) {
    // The post or the user vanished under us — nothing was granted.
    if (isForeignKeyViolation(e)) return { ok: false };
    throw e;
  }
}

export async function revokeZonePostAccess(postId: string, userId: string): Promise<{ ok: boolean }> {
  const r = await prisma.zonePostViewer.deleteMany({ where: { postId, userId } });
  return { ok: r.count > 0 };
}

/** 6 chars over ACCESS_CODE_ALPHABET, rejection-sampled so every letter is equally likely. */
function generateAccessCode(): string {
  const n = ACCESS_CODE_ALPHABET.length;
  const limit = Math.floor(256 / n) * n; // 248 for the 31-char alphabet
  let out = '';
  while (out.length < ACCESS_CODE_LENGTH) {
    for (const b of randomBytes(ACCESS_CODE_LENGTH * 2)) {
      if (b >= limit) continue;
      out += ACCESS_CODE_ALPHABET[b % n];
      if (out.length === ACCESS_CODE_LENGTH) break;
    }
  }
  return out;
}

function codesMatch(stored: string, given: string): boolean {
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * 访问密码 → a `via: 'code'` grant. Neutral `{ ok: false }` on every failure
 * (unknown post, wrong code, post no longer restricted) so the route can answer
 * one error and never confirm that a code exists. The ZONE gate is the caller's
 * job — `access.canRead` must already be true, exactly as for any other read.
 */
export async function redeemAccessCode(postId: string, userId: string, code: string): Promise<{ ok: boolean }> {
  const given = normalizeAccessCode(code ?? '');
  if (!userId || !isValidAccessCode(given)) return { ok: false };
  const post = await prisma.zonePost.findFirst({
    where: { id: postId, deletedAt: null, status: 'published', visibility: 'restricted' },
    select: { id: true, accessCode: true },
  });
  if (!post?.accessCode || !codesMatch(post.accessCode, given)) return { ok: false };
  return grantZonePostAccess(post.id, userId, 'code');
}

/**
 * The 访问 panel's write path (`PUT …/access`, privileged callers only).
 * Designated viewers are replaced WHOLESALE, but code-redeemed grants survive —
 * they are a different relationship. Returns the authoritative state.
 */
export async function setZonePostAccess(
  postId: string,
  patch: { designatedUserIds?: string[]; regenerateAccessCode?: boolean; clearAccessCode?: boolean },
  actorId: string,
  canSeeIdentity = false,
): Promise<{ accessCode: string | null; designatedViewers: PublicAuthor[] }> {
  const post = await prisma.zonePost.findUnique({
    where: { id: postId },
    select: { id: true, zoneId: true, visibility: true, accessCode: true, deletedAt: true, zone: { select: { ownerId: true } } },
  });
  if (!post || post.deletedAt) throw new ZoneError('not_found', 404);
  if (post.visibility !== 'restricted') throw new ZoneError('post_not_restricted', 400);

  const designated =
    patch.designatedUserIds !== undefined
      ? await validateDesignatedViewers({ id: post.zoneId, ownerId: post.zone.ownerId }, patch.designatedUserIds)
      : null;

  let accessCode: string | null = post.accessCode ?? null;
  if (patch.clearAccessCode) accessCode = null;
  else if (patch.regenerateAccessCode || !accessCode) accessCode = generateAccessCode();

  await prisma.$transaction(async (tx) => {
    if (accessCode !== (post.accessCode ?? null)) {
      await tx.zonePost.update({ where: { id: post.id }, data: { accessCode } });
      // A rotated (or cleared) code must not leave the people who used the old
      // one inside — designated grants are untouched.
      await tx.zonePostViewer.deleteMany({ where: { postId: post.id, via: 'code' } });
    }
    if (designated) await replaceDesignatedViewers(tx, post.id, designated, actorId);
  });

  return { accessCode, designatedViewers: await listDesignatedViewers(post.id, canSeeIdentity) };
}

/** Designated viewers must be active members of the zone (the owner always is). */
async function validateDesignatedViewers(zone: { id: string; ownerId: string }, ids: string[]): Promise<string[]> {
  const unique = [...new Set((ids ?? []).map((s) => (s ?? '').trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  if (unique.length > MAX_DESIGNATED_VIEWERS) throw new ZoneError('designated_too_many', 400);
  const needMembership = unique.filter((id) => id !== zone.ownerId);
  if (needMembership.length > 0) {
    const n = await prisma.zoneMember.count({
      where: { zoneId: zone.id, status: 'active', userId: { in: needMembership } },
    });
    if (n !== needMembership.length) throw new ZoneError('designated_not_member', 400);
  }
  return unique;
}

async function replaceDesignatedViewers(
  tx: Prisma.TransactionClient,
  postId: string,
  userIds: string[],
  grantedById: string | null,
): Promise<void> {
  await tx.zonePostViewer.deleteMany({
    where: { postId, via: 'designated', ...(userIds.length > 0 ? { userId: { notIn: userIds } } : {}) },
  });
  if (userIds.length === 0) return;
  await tx.zonePostViewer.createMany({
    data: userIds.map((userId) => ({ postId, userId, via: 'designated' as const, grantedById })),
    skipDuplicates: true,
  });
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
  /**
   * Hidden from the UI (2026-09): the column stays, the schema defaults it to
   * `article`, and `announcement` is a moderator flag flipped from the ⋯ menu.
   */
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
  /** 栏目: an existing column id, or null for 未归栏. */
  columnId: string | null;
  /** …or a name typed in the composer — created on the fly when allowed (wins over `columnId`). */
  columnName: string | null;
  visibility: ZonePostVisibilityValue;
  /** `restricted` only: the members who may open it (replaced wholesale). */
  designatedUserIds: string[];
  /** `restricted` only: rotate the 访问密码 on this save. */
  regenerateAccessCode: boolean;
}

export const zonePostInputSchema = z.object({
  type: z.enum(ZONE_POST_TYPES).default('article'),
  title: z.string().trim().min(ZONE_LIMITS.postTitleMin).max(ZONE_LIMITS.postTitleMax),
  summary: z.string().trim().max(ZONE_LIMITS.postSummaryMax).default(''),
  bodyMd: z.string().max(ZONE_LIMITS.postBodyMax).default(''),
  coverKey: z.string().trim().max(200).nullable().default(null),
  linkUrl: z.string().trim().max(2048).nullable().default(null),
  tags: z.array(z.string().max(64)).max(MAX_ZONE_POST_TAGS * 2).default([]),
  coauthorIds: z.array(z.string().min(1).max(64)).max(ZONE_LIMITS.maxCoauthors).default([]),
  attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENT_ROWS_PER_POST).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  columnId: z.string().trim().max(64).nullable().default(null),
  columnName: z.string().trim().max(ZONE_LIMITS.columnNameMax * 2).nullable().default(null),
  visibility: z.enum(ZONE_POST_VISIBILITIES).default('zone'),
  designatedUserIds: z.array(z.string().min(1).max(64)).max(MAX_DESIGNATED_VIEWERS).default([]),
  regenerateAccessCode: z.boolean().default(false),
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
 * files on disk, and — since keys are visible in every URL — not already
 * attached to a different post. Sizes come from the disk stat, not the client.
 * No per-kind count caps (unlimited by product decision); the only bound is
 * the hidden MAX_ATTACHMENT_ROWS_PER_POST sanity cap on one request. Returns
 * null on ANY invalid item (the route 400s).
 */
export async function resolveAttachmentInputs(
  items: AttachmentInput[],
  opts: { excludePostId?: string } = {},
): Promise<ResolvedAttachment[] | null> {
  if (items.length > MAX_ATTACHMENT_ROWS_PER_POST) return null;
  const out: ResolvedAttachment[] = [];
  const seen = new Set<string>();
  const posterKeys: string[] = [];

  for (const item of items) {
    const key = (item.key ?? '').trim();
    if (!isValidZoneMediaKey(key)) return null;
    const kind = kindOfKey(key);
    if (!kind) return null;
    if (seen.has(key)) return null;
    seen.add(key);

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

/**
 * 合著者 = 站内任何在职账号 (owner ask, 2026-09-02: 「添加合著者我希望是可以整个
 * 平台的人都可以添加」). The zone-membership requirement is GONE — the picker
 * searches the whole site through `GET /api/users/search`.
 *
 * What survives, because each one is load-bearing: the `maxCoauthors` cap, the
 * self-exclusion (you are already the 主作者), the dedupe, the picker's order
 * (it is the byline order) and — new — the existence + `isActive` check, which
 * is what keeps a bogus id out of `coauthors.create` (an unknown user id would
 * otherwise surface as a raw P2003 500).
 *
 * Unknown / disabled ids are DROPPED, never thrown on: the only way to send one
 * is a stale chip (the person was disabled between picking and saving) or a
 * hand-crafted body, and failing the whole save for either is worse than a
 * byline that quietly matches reality. `coauthor_not_member` is dead as a
 * result — the api_errors key stays for old clients / a rollback.
 *
 * A co-author who is not a member of the zone can READ the post they are on
 * (decideZonePostAccess treats an author as privileged before the zone gate —
 * that is what a byline means) but NOT edit it: see `canEditZonePostContent`.
 */
async function validateCoauthors(authorId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((s) => s.trim()).filter((id) => id && id !== authorId))].slice(0, ZONE_LIMITS.maxCoauthors);
  if (unique.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: unique }, isActive: true },
    select: { id: true },
  });
  const known = new Set(rows.map((r) => r.id));
  return unique.filter((id) => known.has(id));
}

/**
 * May this viewer edit the post's CONTENT? The single rule, shared by the PATCH
 * route and the composer page so the two can never disagree.
 *
 * Co-authorship is a per-post byline, site-wide by owner decision — it must
 * never become a WRITE grant inside a 版块 the person cannot even read. So a
 * co-author edits only while the zone gate lets them in; the 主作者 keeps the pen
 * on their own post, and `moderate` is the usual override. (Publishing a draft
 * needs `canPost` on top — the route applies that separately.)
 */
export function canEditZonePostContent(o: {
  viewerId: string | null;
  authorId: string;
  coauthorIds: readonly string[];
  canRead: boolean;
  canModerate: boolean;
}): boolean {
  if (o.canModerate) return true;
  if (!o.viewerId) return false;
  if (o.viewerId === o.authorId) return true;
  return o.canRead && o.coauthorIds.includes(o.viewerId);
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

/** A URL is always optional (types are hidden, so `link_required` is gone); a non-empty one must parse. */
function resolveLinkUrl(raw: string | null): string | null {
  const url = normalizeHttpUrl(raw);
  if (raw && raw.trim() && !url) throw new ZoneError('link_invalid', 400);
  return url;
}

/**
 * Body-key union: every `[embed:file:<storage key>]` token in the body joins
 * the attachment set BEFORE validation, so a file dropped into the 正文 is never
 * an orphan the attachments panel cannot list — and never a file that
 * `deleteUnreferencedZoneFiles` reclaims out from under a rendering token. A
 * stub row carries only the key: `cleanName` falls back to the key's file name
 * and the disk stat supplies the size, exactly as for a ledger row the client
 * sent with blanks. Row-id tokens (`[embed:file:<id>]`) are skipped — they
 * already prove a row exists.
 *
 * A body key is a REFERENCE, not a claim. The ledger is validated strictly
 * (any bad row ⇒ `attachments_invalid`), but a key that only the body names is
 * unioned ONLY when this post can actually own it: not attached to another
 * post (a block pasted out of that post's editor carries its key-form tokens)
 * and present on disk. Anything else is left out and the token simply renders
 * under the embed gate as 无权访问 / 内容不可用 — one pasted card must never
 * fail the whole save with an error that names none of it. The hidden row cap
 * is re-checked AFTER the union (zod only saw the ledger) under its own code.
 */
export async function resolvePostAttachments(
  items: AttachmentInput[],
  bodyMd: string,
  opts: { excludePostId?: string } = {},
): Promise<ResolvedAttachment[]> {
  const ledgerKeys = new Set(items.map((i) => (i.key ?? '').trim()));
  const candidates = bodyFileKeys(bodyMd).filter((k) => !ledgerKeys.has(k) && isValidZoneMediaKey(k));
  const claimable = new Set<string>();
  if (candidates.length > 0) {
    const [foreign, stats] = await Promise.all([
      prisma.zonePostAttachment.findMany({
        where: {
          key: { in: candidates },
          ...(opts.excludePostId ? { postId: { not: opts.excludePostId } } : {}),
        },
        select: { key: true },
      }),
      Promise.all(candidates.map((k) => statZoneMediaAsync(k))),
    ]);
    const taken = new Set(foreign.map((f) => f.key));
    candidates.forEach((k, i) => {
      if (!taken.has(k) && stats[i]) claimable.add(k);
    });
  }
  const merged = mergeBodyFileKeys(items, bodyMd, (key) => ({ key, name: '', mimeType: '', sizeBytes: 0 })).filter(
    (i) => ledgerKeys.has((i.key ?? '').trim()) || claimable.has(i.key),
  );
  if (merged.length > MAX_ATTACHMENT_ROWS_PER_POST) throw new ZoneError('attachments_too_many', 400);
  const resolved = await resolveAttachmentInputs(merged, opts);
  if (!resolved) throw new ZoneError('attachments_invalid', 400);
  return resolved;
}

/**
 * 栏目 for a create/update. A typed `columnName` wins over `columnId` (the
 * composer sends one or the other) and is created on the fly when the zone
 * allows it — `allowCreate` is policy decided by the caller (`canModerate`)
 * plus `Zone.allowMemberColumns`, never re-derived inside the column service.
 * `undefined` ⇒ the patch does not touch the post's 栏目; `null` ⇒ 未归栏.
 */
async function resolvePostColumn(
  zone: ZoneAccessRow,
  input: { columnId?: string | null; columnName?: string | null },
  opts: { userId: string; canModerate?: boolean },
): Promise<string | null | undefined> {
  const name = (input.columnName ?? '').trim();
  if (name) {
    const row = await prisma.zone.findUnique({ where: { id: zone.id }, select: { allowMemberColumns: true } });
    const allowCreate = !!opts.canModerate || !!row?.allowMemberColumns;
    const { id } = await getOrCreateColumn(zone.id, name, { userId: opts.userId, allowCreate });
    return id;
  }
  if (input.columnId === undefined) return undefined;
  const id = (input.columnId ?? '').trim();
  if (!id) return null;
  const column = await prisma.zoneColumn.findFirst({ where: { id, zoneId: zone.id }, select: { id: true } });
  if (!column) throw new ZoneError('column_not_found', 400);
  return column.id;
}

// ── 通知：合著者 + @人 ────────────────────────────────────────────────────────
//
// Both fire on PUBLISH, never on a draft save: a draft's co-author list and its
// @人 churn while the author is still writing, and being told about a post you
// cannot open yet is noise. Everything below is best-effort — the block is
// wrapped, and `notifyCoauthor` / `notifyMentions` swallow their own errors
// too: a notification may never fail the write that triggered it.

/** House Chinese copy for a mention's location (notification bodies are stored data, not UI). */
const MENTION_WHAT = '帖子';

interface PostNotifyInput {
  postId: string;
  zone: { id: string; slug: string; ownerId: string; visibility: ZoneVisibilityValue };
  post: { authorId: string; coauthorIds: string[]; visibility: ZonePostVisibilityValue };
  actorId: string;
  title: string;
  bodyMd: string;
  /**
   * The body as it was BEFORE this save, or `undefined` when the post is
   * appearing for the first time (create-published / draft→published) — then
   * everyone it @s is pinged, because nobody was pinged while it was a draft.
   */
  prevBodyMd?: string;
  /** Co-authors to ping: everyone on a fresh publish, only the ADDED ones on an edit. */
  newCoauthorIds: string[];
}

async function notifyPostPeople(o: PostNotifyInput): Promise<void> {
  try {
    const newCoauthors = [...new Set(o.newCoauthorIds)].filter((id) => id && id !== o.actorId);
    // Same switch `notifyMentions` applies internally — computed here only to
    // decide whether this save has anything to announce at all (both helpers
    // are pure and the body is already in memory).
    const handles =
      o.prevBodyMd === undefined ? extractMentionHandles(o.bodyMd) : newMentionHandles(o.bodyMd, o.prevBodyMd);
    if (newCoauthors.length === 0 && handles.length === 0) return;

    // Imported HERE, not at module scope, on purpose: lib/notifications reaches
    // the mailer and lib/mention-notify reaches lib/auth, and BOTH validate the
    // whole env at import time. post-queries is imported by every 技术专区 RSC
    // and by pure unit tests, so the notification chain stays out of its import
    // graph — this best-effort path runs at most once per publish and Node
    // caches the module after the first load.
    const [{ notifyCoauthor }, { notifyMentions, zonePostMentionGate }] = await Promise.all([
      import('@/lib/notifications'),
      import('@/lib/mention-notify'),
    ]);

    const link = zonePostHref(o.zone.slug, o.postId);
    const actor = await prisma.user.findUnique({
      where: { id: o.actorId },
      select: { displayName: true, handle: true },
    });
    const actorName = actor?.displayName?.trim() || actor?.handle || '';
    const alreadyToldAsCoauthor = new Set(newCoauthors);
    // The zone's own gate, batch-loaded: a 仅成员可见 版块 or a 指定成员可见 帖子
    // must not ping an outsider. It rebuilds `decideZonePostAccess`, so a
    // co-author (or the 主版主, or a site admin) is reachable wherever they
    // could open the post.
    const readable = zonePostMentionGate({
      zone: o.zone,
      post: {
        id: o.postId,
        authorId: o.post.authorId,
        coauthorIds: o.post.coauthorIds,
        status: 'published',
        deletedAt: null,
        visibility: o.post.visibility,
      },
    });

    await Promise.all([
      newCoauthors.length > 0
        ? notifyCoauthor({ recipientIds: newCoauthors, actorId: o.actorId, actorName, title: o.title, link })
        : Promise.resolve(),
      handles.length > 0
        ? notifyMentions({
            bodyMd: o.bodyMd,
            ...(o.prevBodyMd !== undefined ? { prevMd: o.prevBodyMd } : {}),
            actorId: o.actorId,
            actorName,
            site: { what: MENTION_WHAT, title: o.title, link },
            gate: async (candidates) =>
              // Being told you are now a 合著者 already carries this save's news:
              // one event, one notification.
              (await readable(candidates)).filter((c) => !alreadyToldAsCoauthor.has(c.id)),
          })
        : Promise.resolve(),
    ]);
  } catch (e) {
    console.error('[zones] post notifications failed:', e);
  }
}

export async function createZonePost(
  zone: ZoneAccessRow,
  authorId: string,
  input: ZonePostInput,
  opts: { canModerate?: boolean } = {},
): Promise<{ id: string }> {
  const title = input.title.trim();
  if (title.length < ZONE_LIMITS.postTitleMin) throw new ZoneError('title_required', 400);
  const bodyMd = input.bodyMd ?? '';
  const visibility: ZonePostVisibilityValue = input.visibility ?? 'zone';
  const [coauthorIds, attachments, cover, columnId] = await Promise.all([
    validateCoauthors(authorId, input.coauthorIds ?? []),
    resolvePostAttachments(input.attachments ?? [], bodyMd),
    validateCover(input.coverKey),
    resolvePostColumn(zone, input, { userId: authorId, canModerate: opts.canModerate }),
  ]);
  const linkUrl = resolveLinkUrl(input.linkUrl);
  const publish = input.status === 'published';
  const now = new Date();
  // 指定成员可见: the grants and the share code are born with the post.
  const designated =
    visibility === 'restricted' ? await validateDesignatedViewers(zone, input.designatedUserIds ?? []) : [];
  const accessCode = visibility === 'restricted' ? generateAccessCode() : null;

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
        columnId: columnId ?? null,
        visibility,
        accessCode,
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
    if (designated.length > 0) {
      await tx.zonePostViewer.createMany({
        data: designated.map((userId) => ({ postId: post.id, userId, via: 'designated' as const, grantedById: authorId })),
        skipDuplicates: true,
      });
    }
    if (publish) {
      await tx.zone.update({ where: { id: zone.id }, data: { postCount: { increment: 1 }, lastActivityAt: now } });
      // postCount moves WITH the post, inside the same transaction.
      await recountZoneColumns(zone.id, tx, [columnId]);
    }
    return post;
  });

  for (const a of created.attachments) if (a.previewStatus === 'pending') scheduleOfficePreview(a.id);
  // Published straight away ⇒ every co-author and everyone @-ed in the body
  // hears about it now. A draft tells nobody (notifyPostPeople is never called).
  if (publish) {
    await notifyPostPeople({
      postId: created.id,
      zone: { id: zone.id, slug: zone.slug, ownerId: zone.ownerId, visibility: zone.visibility },
      post: { authorId, coauthorIds, visibility },
      actorId: authorId,
      title,
      bodyMd,
      newCoauthorIds: coauthorIds,
    });
  }
  return { id: created.id };
}

export async function updateZonePost(
  postId: string,
  patch: Partial<ZonePostInput>,
  opts: { canModerate?: boolean; actorId?: string } = {},
): Promise<void> {
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
      columnId: true,
      visibility: true,
      accessCode: true,
      status: true,
      publishedAt: true,
      deletedAt: true,
      // Who was ALREADY on the byline — an edit pings only who it ADDED.
      coauthors: { select: { userId: true } },
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
  const actorId = opts.actorId ?? existing.authorId;

  // Backstop for the route gate: the stored type only ever changes by a
  // moderator's 设为公告 / 取消公告 (the composer never sends it).
  if (patch.type !== undefined && patch.type !== existing.type && !opts.canModerate) {
    throw new ZoneError('announcement_forbidden', 403);
  }
  const type = patch.type ?? existing.type;
  const title = patch.title !== undefined ? patch.title.trim() : existing.title;
  if (title.length < ZONE_LIMITS.postTitleMin) throw new ZoneError('title_required', 400);
  const bodyMd = patch.bodyMd !== undefined ? patch.bodyMd : existing.bodyMd;

  const [coauthorIds, attachments, cover, nextColumnId] = await Promise.all([
    patch.coauthorIds !== undefined ? validateCoauthors(existing.authorId, patch.coauthorIds) : Promise.resolve(null),
    // The composer always sends the WHOLE ledger, so that is when the body's
    // file keys are unioned in. A patch carrying `bodyMd` but no `attachments`
    // (API / CLI clients editing only the text) leaves the rows untouched.
    patch.attachments !== undefined
      ? resolvePostAttachments(patch.attachments, bodyMd, { excludePostId: existing.id })
      : Promise.resolve(undefined),
    patch.coverKey !== undefined ? validateCover(patch.coverKey) : Promise.resolve(null),
    resolvePostColumn(existing.zone, patch, { userId: actorId, canModerate: opts.canModerate }),
  ]);

  // 可见性: switching AWAY from `restricted` drops the code AND every grant —
  // a post that later comes back to 指定成员可见 starts from a clean sheet.
  const nextVisibility: ZonePostVisibilityValue = patch.visibility ?? existing.visibility;
  const restricted = nextVisibility === 'restricted';
  const designated =
    restricted && patch.designatedUserIds !== undefined
      ? await validateDesignatedViewers(existing.zone, patch.designatedUserIds)
      : null;
  const accessCode = restricted
    ? patch.regenerateAccessCode || !existing.accessCode
      ? generateAccessCode()
      : existing.accessCode
    : null;
  const codeChanged = accessCode !== (existing.accessCode ?? null);
  // A URL is optional whatever the (hidden) type says, so only a patch that
  // carries `linkUrl` re-validates it; otherwise the stored one stays.
  const linkUrl = patch.linkUrl !== undefined ? resolveLinkUrl(patch.linkUrl) : undefined;

  const contentChanged = title !== existing.title || bodyMd !== existing.bodyMd;
  const now = new Date();
  const nextStatus = patch.status ?? existing.status;
  const publishing = existing.status === 'draft' && nextStatus === 'published';
  const unpublishing = existing.status === 'published' && nextStatus === 'draft';
  const staysPublished = existing.status === 'published' && nextStatus === 'published';
  // Set by the GUARDED flip below, so a publish that lost the race (someone
  // else's PATCH already moved the row) notifies nobody — that request did.
  let publishedNow = false;

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
    ...(nextColumnId !== undefined ? { column: nextColumnId ? { connect: { id: nextColumnId } } : { disconnect: true } } : {}),
    ...(patch.visibility !== undefined ? { visibility: nextVisibility } : {}),
    ...(codeChanged ? { accessCode } : {}),
    // Stamp WHO edited alongside WHEN. Drafts are not marked as "edited" (the
    // author is still writing), so the editor rides the same condition.
    ...(contentChanged && existing.status === 'published'
      ? { editedAt: now, ...(opts.actorId ? { editedBy: { connect: { id: opts.actorId } } } : {}) }
      : {}),
  };

  await prisma.$transaction(async (tx) => {
    await tx.zonePost.update({ where: { id: existing.id }, data });

    // 指定成员可见 bookkeeping. Leaving `restricted` clears every grant; rotating
    // the code evicts whoever came in through the OLD one (designated members
    // are a different relationship and survive); a designated list that was sent
    // replaces the previous one wholesale.
    if (existing.visibility === 'restricted' && !restricted) {
      await tx.zonePostViewer.deleteMany({ where: { postId: existing.id } });
    } else if (restricted) {
      if (codeChanged && existing.accessCode) {
        await tx.zonePostViewer.deleteMany({ where: { postId: existing.id, via: 'code' } });
      }
      if (designated) await replaceDesignatedViewers(tx, existing.id, designated, actorId);
    }

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
        publishedNow = true;
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

    // 栏目 counts move with the post: the column it left AND the one it joined,
    // in the same transaction as the write that moved it.
    if (nextColumnId !== undefined || publishing || unpublishing) {
      await recountZoneColumns(existing.zoneId, tx, [existing.columnId, nextColumnId ?? existing.columnId]);
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

  // 通知 — published rows only. A draft going LIVE pings its whole co-author
  // list and everyone it @s (nobody was told while it was a draft); an edit of
  // an already-published post pings only the people it ADDED, so re-saving a
  // typo never re-pings the byline. Unpublishing pings nobody.
  if (publishedNow || staysPublished) {
    const before = new Set(existing.coauthors.map((c) => c.userId));
    const finalCoauthorIds = coauthorIds ?? [...before];
    await notifyPostPeople({
      postId: existing.id,
      zone: {
        id: existing.zone.id,
        slug: existing.zone.slug,
        ownerId: existing.zone.ownerId,
        visibility: existing.zone.visibility,
      },
      post: { authorId: existing.authorId, coauthorIds: finalCoauthorIds, visibility: nextVisibility },
      actorId,
      title,
      bodyMd,
      newCoauthorIds: publishedNow ? finalCoauthorIds : finalCoauthorIds.filter((id) => !before.has(id)),
      // A draft going live has told nobody yet ⇒ no `prevBodyMd`, everyone it
      // @s is pinged; an edit of a live post pings only the @s it ADDED.
      ...(publishedNow ? {} : { prevBodyMd: existing.bodyMd }),
    });
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function isForeignKeyViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
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
      select: { id: true, zoneId: true, columnId: true, deletedAt: true },
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
      await recountZoneColumns(post.zoneId, tx, [post.columnId]);
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
    where: {
      userId: viewer.id,
      post: {
        AND: [{ ...PUBLISHED_WHERE, zone: readableZoneWhere(viewer) }, zonePostVisibilityWhere(null, viewer)],
      },
    },
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
    where: { AND: [{ ...PUBLISHED_WHERE, zone: readableZoneWhere(viewer) }, zonePostVisibilityWhere(null, viewer)] },
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
      AND: [
        { ...PUBLISHED_WHERE, zone: readableZoneWhere(viewer) },
        { OR: [{ authorId: userId }, { coauthors: { some: { userId } } }] },
        zonePostVisibilityWhere(null, viewer),
      ],
    },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: clampLimit(take, 20, 100),
    select: ZONE_POST_CARD_SELECT,
  });
  return toCardViews(rows, viewer);
}

// ── 技术专区首页动态 (cross-zone feed, asks 6 + 7) ─────────────────────────────
//
// The /zones landing feed: every post the viewer may see, across every zone
// they may read, filtered by the zone's 研究所 / 部门, by 栏目, by type and by a
// free-text query. Two orderings, two cursor shapes — the house pattern:
// `new` is a keyset on `publishedAt|id` (stable under inserts), `hot` is an
// engagement ordering paged by the `o:<n>` offset cursor (its ranking shifts
// under new likes, so a keyset would skip rows).

export interface ZoneFeedFilters {
  viewer: ZoneSiteViewer;
  sort?: ZoneFeedSort;
  /** 研究所 (multi-select) — matches the ZONE's lab. */
  labs?: string[];
  /** 部门 (multi-select) — matches the ZONE's department. */
  departments?: string[];
  /** 栏目 names or slugs. */
  columns?: string[];
  types?: ZonePostTypeValue[];
  q?: string;
  cursor?: string | null;
  limit?: number;
  /** Narrow to one 版块 (its slug). */
  zoneSlug?: string | null;
}

const FEED_MAX_FILTER_VALUES = 20;

function cleanList(values: string[] | undefined, max = 64): string[] {
  return [...new Set((values ?? []).map((v) => (v ?? '').trim()).filter(Boolean))]
    .slice(0, FEED_MAX_FILTER_VALUES)
    .map((v) => v.slice(0, max));
}

export async function listZoneFeed(f: ZoneFeedFilters): Promise<ZoneFeedResult> {
  const limit = clampLimit(f.limit);
  const sort: ZoneFeedSort = f.sort === 'hot' ? 'hot' : 'new';
  const q = (f.q ?? '').trim().slice(0, 100);
  const labs = cleanList(f.labs, ZONE_LIMITS.labMax);
  const departments = cleanList(f.departments, ZONE_LIMITS.departmentMax);
  const columns = cleanList(f.columns, ZONE_LIMITS.columnNameMax * 2);
  const types = [...new Set(f.types ?? [])];
  const zoneSlug = (f.zoneSlug ?? '').trim().toLowerCase().slice(0, 64);

  // AND of independent OR-groups — never assign `where.OR` twice.
  const and: Prisma.ZonePostWhereInput[] = [
    { ...PUBLISHED_WHERE, zone: readableZoneWhere(f.viewer) },
    zonePostVisibilityWhere(null, f.viewer),
  ];
  if (zoneSlug) and.push({ zone: { slug: zoneSlug } });
  if (labs.length > 0) and.push({ zone: { lab: { in: labs } } });
  if (departments.length > 0) and.push({ zone: { department: { in: departments } } });
  if (columns.length > 0) {
    and.push({ OR: [{ column: { is: { name: { in: columns } } } }, { column: { is: { slug: { in: columns } } } }] });
  }
  if (types.length > 0) and.push({ type: { in: types } });
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        // tags is a String[]: `has` is an exact member match, not a substring.
        { tags: { has: q } },
      ],
    });
  }

  const cursor = sort === 'new' ? decodeTimeCursor(f.cursor) : null;
  const offset = sort === 'hot' ? decodeOffsetCursor(f.cursor) : 0;
  const where: Prisma.ZonePostWhereInput = {
    AND: [
      ...and,
      ...(cursor
        ? [
            {
              OR: [
                { publishedAt: { lt: cursor.at } },
                { publishedAt: cursor.at, id: { lt: cursor.id } },
              ],
            } satisfies Prisma.ZonePostWhereInput,
          ]
        : []),
    ],
  };

  const orderBy: Prisma.ZonePostOrderByWithRelationInput[] =
    sort === 'hot'
      ? [{ likeCount: 'desc' }, { commentCount: 'desc' }, { viewCount: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }]
      : [{ publishedAt: 'desc' }, { id: 'desc' }];

  const [total, rows] = await Promise.all([
    prisma.zonePost.count({ where: { AND: and } }),
    prisma.zonePost.findMany({
      where,
      orderBy,
      ...(sort === 'hot' ? { skip: offset } : {}),
      take: limit + 1,
      select: ZONE_POST_CARD_SELECT,
    }),
  ]);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = await toCardViews(page, f.viewer);
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
    total,
  };
}

/**
 * The hub filter panel's facets: the 研究所 → 部门 tree over readable zones plus
 * the busiest 栏目 names. Column names repeat across zones on purpose — the
 * hub filters by NAME, so "推理优化" in three 版块 is one filter chip.
 */
export async function zoneHubFacets(viewer: ZoneSiteViewer): Promise<ZoneHubFacets> {
  const [org, columns] = await Promise.all([
    zoneOrgTree(viewer),
    prisma.zoneColumn.groupBy({
      by: ['name'],
      where: { zone: readableZoneWhere(viewer) },
      _sum: { postCount: true },
      orderBy: { _sum: { postCount: 'desc' } },
      take: 20,
    }),
  ]);
  return {
    org,
    columns: columns
      .map((c) => ({ name: c.name, postCount: c._sum.postCount ?? 0 }))
      .filter((c) => c.postCount > 0),
  };
}
