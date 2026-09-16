// 技术专区 native embeds — `[embed:<kind>:<ref>]` resolver.
//
// Every kind is gated by the SOURCE domain's own visibility rule (the same
// helper its detail page uses), never by the zone's: a restricted 知识库 doc is
// discoverable but not readable, a private skill is invisible, an unlisted
// video plays, a members-only zone post only shows to that zone's members…
// Refs are batched per kind (one findMany each), the resolver never throws —
// a bad / missing / forbidden ref becomes `{ ok: false, reason }` so one dead
// token can never blank a whole post.

import type { Prisma } from '@prisma/client';
import type { Session } from 'next-auth';
import { prisma } from '@/lib/db';
import { eventViewerFromSession, getEventDetail, pastWhere, upcomingWhere } from '@/lib/event-queries';
import { eventLocalDayKey } from '@/lib/events/time';
import { EVENT_TIMEZONES } from '@/lib/events/types';
import { BROWSABLE_DOC_WHERE, canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';
import { asAiOverview, pickOverview, pickText } from '@/lib/library/i18n-content';
import { INSTALLABLE_SKILL_WHERE } from '@/lib/pack-queries';
import { DISCOVERABLE_SKILL_WHERE, SKILL_CARD_SELECT } from '@/lib/skill-queries';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { canViewVideo, videoActorFrom } from '@/lib/video/access';
import { VIDEO_DETAIL_INCLUDE } from '@/lib/video/queries';
import { SHORT_FEED_SELECT, annotateShortsViewer, toShortView } from '@/lib/video/shorts-queries';
import { ZONE_ACCESS_SELECT, resolveZoneAccess, type ZoneAccessRow, type ZoneSiteViewer } from './access';
import {
  EMBED_SEARCH_MAX_QUERY,
  EMBED_SEARCH_PAGE_SIZE,
  encodeEmbedSearchCursor,
  firstNonBlank,
  isKeysetPosition,
  paginateEmbedPhases,
  pagingForSort,
  phaseGroup,
  phaseSlice,
  phasesFor,
  type EmbedKeysetKey,
  type EmbedPhaseFetcher,
  type EmbedPhaseGroup,
  type EmbedPhasePosition,
  type EmbedSearchCursor,
  type EmbedSearchScope,
  type EmbedSearchSort,
  type SearchableEmbedKind,
} from './embed-search-shared';
import { getLinkPreview, linkPreviewHash } from './link-preview';
import { normalizePreviewUrl } from './og-parse';
import type { ZoneAccess } from './permissions';
import {
  ZONE_POST_ACCESS_SELECT,
  canSeeZonePost,
  readableZoneWhere,
  toAttachmentView,
  zonePostVisibilityWhere,
} from './post-queries';
import { embedKey, hostnameOf, isEmbedFileKey, normalizeEmbedRef, zonePostHref, type EmbedKind, type EmbedRef } from './shared';
import type {
  EmbedCandidate,
  EmbedData,
  EmbedEventData,
  EmbedFailReason,
  EmbedFileData,
  EmbedLibraryData,
  EmbedLibraryPreview,
  EmbedPackData,
  EmbedPostData,
  EmbedSearchPage,
  EmbedShortData,
  EmbedSkillData,
  EmbedVideoData,
} from './types';

export interface EmbedContext {
  viewer: ZoneSiteViewer;
  session: Session | null;
  locale?: string;
}

/**
 * A resolver's answers, keyed by normalized ref. `null` means "not decided in
 * this pass" — the token is left OUT of the result so the card fetches it
 * through the budgeted `/api/zones/embed` route (only `link` ever defers).
 */
type Resolved = Map<string, EmbedData | null>;

function fail(kind: EmbedKind, ref: string, reason: EmbedFailReason): EmbedData {
  return { kind, ref, ok: false, reason };
}

// ── library ──────────────────────────────────────────────────────────────────

const LIBRARY_EMBED_SELECT = {
  id: true,
  slug: true,
  title: true,
  author: true,
  docType: true,
  format: true,
  coverUrl: true,
  summary: true,
  summaryEn: true,
  estReadMinutes: true,
  chapterCount: true,
  status: true,
  deletedAt: true,
  visibility: true,
  uploaderId: true,
  uploader: { select: { handle: true, displayName: true, avatarUrl: true } },
} as const;

type LibraryEmbedRow = {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  docType: string;
  format: string;
  coverUrl: string | null;
  summary: string;
  summaryEn: string;
  estReadMinutes: number;
  chapterCount: number;
  status: string;
  deletedAt: Date | null;
  visibility: string;
  uploaderId: string;
  uploader: { handle: string; displayName: string; avatarUrl: string | null };
};

async function libraryDataFor(doc: LibraryEmbedRow, ctx: EmbedContext): Promise<EmbedLibraryData | EmbedFailReason> {
  const lv = libraryViewerFromSession(ctx.session);
  const discoverable = doc.status === 'ready' && !doc.deletedAt && doc.visibility !== 'private';
  const privileged = !!lv && (lv.canManage || lv.id === doc.uploaderId);
  if (!discoverable && !privileged) return 'not_found';
  const canRead = await canReadDoc(doc, lv);
  return {
    slug: doc.slug,
    title: doc.title,
    author: doc.author,
    docType: doc.docType,
    format: doc.format,
    coverUrl: doc.coverUrl,
    summary: pickText(ctx.locale, doc.summary, doc.summaryEn),
    estReadMinutes: doc.estReadMinutes,
    chapterCount: doc.chapterCount,
    uploader: { handle: doc.uploader.handle, displayName: doc.uploader.displayName, avatarUrl: doc.uploader.avatarUrl },
    canRead,
    href: `/library/${doc.slug}`,
  };
}

async function resolveLibrary(refs: string[], ctx: EmbedContext): Promise<Resolved> {
  const out: Resolved = new Map();
  const docs = await prisma.libraryDoc.findMany({ where: { slug: { in: refs } }, select: LIBRARY_EMBED_SELECT });
  await Promise.all(
    docs.map(async (doc) => {
      const data = await libraryDataFor(doc, ctx);
      out.set(doc.slug, typeof data === 'string' ? fail('library', doc.slug, data) : { kind: 'library', ref: doc.slug, ok: true, data });
    }),
  );
  return out;
}

// ── short ────────────────────────────────────────────────────────────────────

async function resolveShort(refs: string[], ctx: EmbedContext): Promise<Resolved> {
  const out: Resolved = new Map();
  const rows = await prisma.video.findMany({
    where: { id: { in: refs }, isShort: true, status: 'published', visibility: 'public', deletedAt: null },
    select: SHORT_FEED_SELECT,
  });
  const annotated = await annotateShortsViewer(rows, ctx.viewer.id);
  for (const row of annotated) {
    const v = toShortView(row, ctx.viewer.canSeeIdentity);
    const data: EmbedShortData = {
      id: v.id,
      slug: v.slug,
      title: v.title,
      summary: v.summary,
      videoUrl: v.videoUrl,
      posterUrl: v.posterUrl,
      width: v.width,
      height: v.height,
      durationSec: v.durationSec,
      likeCount: v.likeCount,
      viewCount: v.viewCount,
      uploader: v.uploader,
      href: `/videos/shorts?v=${encodeURIComponent(v.id)}`,
    };
    out.set(v.id, { kind: 'short', ref: v.id, ok: true, data });
  }
  return out;
}

// ── video ────────────────────────────────────────────────────────────────────

async function resolveVideo(refs: string[], ctx: EmbedContext): Promise<Resolved> {
  const out: Resolved = new Map();
  const actor = videoActorFrom(ctx.session?.user);
  const rows = await prisma.video.findMany({ where: { slug: { in: refs } }, include: VIDEO_DETAIL_INCLUDE });
  for (const v of rows) {
    if (v.isShort) continue; // shorts embed as `short:<id>`
    if (!canViewVideo(v, actor)) {
      out.set(v.slug, fail('video', v.slug, actor ? 'not_found' : 'forbidden'));
      continue;
    }
    const data: EmbedVideoData = {
      slug: v.slug,
      title: v.title,
      summary: v.summary,
      posterUrl: v.posterUrl,
      videoUrl: v.videoUrl,
      durationSec: v.durationSec,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      uploader: { handle: v.uploader.handle, displayName: v.uploader.displayName, avatarUrl: v.uploader.avatarUrl },
      href: `/videos/${v.slug}`,
    };
    out.set(v.slug, { kind: 'video', ref: v.slug, ok: true, data });
  }
  return out;
}

// ── skill ────────────────────────────────────────────────────────────────────

async function resolveSkill(refs: string[]): Promise<Resolved> {
  const out: Resolved = new Map();
  const rows = await prisma.skill.findMany({ where: { slug: { in: refs }, ...DISCOVERABLE_SKILL_WHERE }, select: SKILL_CARD_SELECT });
  for (const s of rows) {
    const data: EmbedSkillData = {
      slug: s.slug,
      name: s.name,
      summary: s.summary,
      sourceType: s.sourceType,
      author: { handle: s.author.handle, displayName: s.author.displayName, avatarUrl: s.author.avatarUrl },
      downloads: s.downloadCount,
      likes: s.likeCount,
      rating: s.avgRating,
      href: `/skills/${s.slug}`,
      installCmd: `skills install ${s.slug}`,
    };
    out.set(s.slug, { kind: 'skill', ref: s.slug, ok: true, data });
  }
  return out;
}

// ── pack ─────────────────────────────────────────────────────────────────────

const PACK_EMBED_SELECT = {
  slug: true,
  name: true,
  summary: true,
  icon: true,
  installCount: true,
  items: {
    where: { skill: INSTALLABLE_SKILL_WHERE },
    orderBy: { sortOrder: 'asc' as const },
    select: { skill: { select: { slug: true, name: true } } },
  },
} as const;

async function resolvePack(refs: string[]): Promise<Resolved> {
  const out: Resolved = new Map();
  const rows = await prisma.skillPack.findMany({ where: { slug: { in: refs }, isPublished: true }, select: PACK_EMBED_SELECT });
  for (const p of rows) {
    const data: EmbedPackData = {
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      icon: p.icon || null,
      installCount: p.installCount,
      skills: p.items.map((i) => ({ slug: i.skill.slug, name: i.skill.name })),
      href: `/packs/${p.slug}`,
      installCmd: `skills install pack:${p.slug}`,
    };
    out.set(p.slug, { kind: 'pack', ref: p.slug, ok: true, data });
  }
  return out;
}

// ── event ────────────────────────────────────────────────────────────────────

async function resolveEvent(refs: string[], ctx: EmbedContext): Promise<Resolved> {
  const out: Resolved = new Map();
  const viewer = eventViewerFromSession(ctx.session);
  await Promise.all(
    refs.map(async (id) => {
      try {
        const ev = await getEventDetail(id, viewer);
        if (!ev) return;
        const data: EmbedEventData = {
          id: ev.id,
          title: ev.title,
          summary: ev.summary,
          kind: ev.kind,
          mode: ev.mode,
          startAt: ev.startAt,
          endAt: ev.endAt,
          allDay: ev.allDay,
          timezone: ev.timezone,
          city: ev.city,
          venue: ev.venue,
          coverUrl: ev.coverUrl,
          attendeeCount: ev.attendeeCount,
          cancelled: ev.cancelled,
          href: `/events/${ev.id}`,
        };
        out.set(id, { kind: 'event', ref: id, ok: true, data });
      } catch {
        out.set(id, fail('event', id, 'error'));
      }
    }),
  );
  return out;
}

// ── post / file (zone access cached per zone within one resolve pass) ────────

class ZoneAccessCache {
  private readonly cache = new Map<string, Promise<ZoneAccess>>();

  constructor(private readonly viewer: ZoneSiteViewer) {}

  get(zone: ZoneAccessRow): Promise<ZoneAccess> {
    let p = this.cache.get(zone.id);
    if (!p) {
      p = resolveZoneAccess(zone, this.viewer);
      this.cache.set(zone.id, p);
    }
    return p;
  }
}

async function resolvePost(refs: string[], ctx: EmbedContext): Promise<Resolved> {
  const out: Resolved = new Map();
  const rows = await prisma.zonePost.findMany({
    where: { id: { in: refs }, status: 'published', deletedAt: null },
    select: {
      ...ZONE_POST_ACCESS_SELECT,
      title: true,
      summary: true,
      type: true,
      publishedAt: true,
      likeCount: true,
      commentCount: true,
      author: AUTHOR_IDENTITY_SELECT,
      zone: { select: ZONE_ACCESS_SELECT },
    },
  });
  const accessCache = new ZoneAccessCache(ctx.viewer);
  await Promise.all(
    rows.map(async (p) => {
      if (p.zone.deletedAt && !ctx.viewer.siteAdmin) return;
      const access = await accessCache.get(p.zone);
      // The zone gate AND the post's own visibility (v2): an embed must never be
      // a side door around 仅成员可见 / 指定成员可见 — a locked post answers false
      // here and the token renders as 无权访问, not as a title + summary.
      if (!access.canRead || !(await canSeeZonePost(p, access, ctx.viewer))) {
        out.set(p.id, fail('post', p.id, 'forbidden'));
        return;
      }
      const data: EmbedPostData = {
        id: p.id,
        zoneSlug: p.zone.slug,
        zoneName: p.zone.name,
        title: p.title,
        summary: p.summary,
        type: p.type,
        author: toPublicAuthor(p.author, ctx.viewer.canSeeIdentity),
        publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
        likeCount: p.likeCount,
        commentCount: p.commentCount,
        href: zonePostHref(p.zone.slug, p.id),
      };
      out.set(p.id, { kind: 'post', ref: p.id, ok: true, data });
    }),
  );
  return out;
}

/**
 * `file` refs come in two forms: the attachment ROW id, or its storage KEY
 * (`file/<nanoid>.pdf`, `image/…`, `video/…`) — the form a body-inserted
 * upload carries before the post (and its row) exists. Both resolve through
 * `ZonePostAttachment` and answer under the SAME `canSeeZonePost` gate. Keys
 * are already visible in every media URL and `/api/zones/media/[...key]` is
 * only `auth()`-gated, so key-form refs widen nothing; the embed path stays
 * stricter than the byte path. The answer is keyed by the REQUESTED ref form
 * (id-form and key-form tokens of one row both render); `data.id` is always
 * the row id, which the office preview endpoint needs.
 */
async function resolveFile(refs: string[], ctx: EmbedContext): Promise<Resolved> {
  const out: Resolved = new Map();
  const ids = refs.filter((r) => !isEmbedFileKey(r));
  const keys = refs.filter(isEmbedFileKey);
  // Prisma rejects an empty `OR: []` as "always false" only by accident — guard
  // rather than rely on it.
  if (ids.length === 0 && keys.length === 0) return out;
  const rows = await prisma.zonePostAttachment.findMany({
    // A soft-deleted post's attachments are gone for everyone — the `post` kind
    // filters `deletedAt` in its query too, so the author / moderator branch
    // below must never resurrect them.
    where: {
      OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(keys.length ? [{ key: { in: keys } }] : [])],
      post: { deletedAt: null },
    },
    select: {
      id: true,
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
      previewUrl: true,
      post: {
        select: {
          ...ZONE_POST_ACCESS_SELECT,
          zone: { select: ZONE_ACCESS_SELECT },
        },
      },
    },
  });
  const accessCache = new ZoneAccessCache(ctx.viewer);
  // Decide each ROW once (a row may be asked for by id AND by key), then hand
  // the decision to every ref form that named it.
  const decided = new Map<string, EmbedData>(); // row id → answer (ref filled in below)
  await Promise.all(
    rows.map(async (a) => {
      const post = a.post;
      if (post.zone.deletedAt && !ctx.viewer.siteAdmin) return;
      const access = await accessCache.get(post.zone);
      // Same gate as the post itself — attachments of a 仅成员可见 / 指定成员可见
      // post are exactly as private as its body. `canSeeZonePost` already lets the
      // author / co-authors / 版主 through on an unpublished row.
      if (!(await canSeeZonePost(post, access, ctx.viewer))) {
        decided.set(a.id, fail('file', a.id, 'forbidden'));
        return;
      }
      const data: EmbedFileData = { ...toAttachmentView(a), postId: post.id, zoneSlug: post.zone.slug };
      decided.set(a.id, { kind: 'file', ref: a.id, ok: true, data });
    }),
  );
  const byKey = new Map(rows.map((a) => [a.key, a.id] as const));
  for (const ref of refs) {
    const hit = decided.get(ref) ?? decided.get(byKey.get(ref) ?? '');
    if (hit) out.set(ref, { ...hit, ref });
  }
  return out;
}

// ── link ─────────────────────────────────────────────────────────────────────

/**
 * `link` is the only kind whose resolution can LEAVE the box (an OG fetch of
 * an arbitrary url through the SSRF-guarded, 6 s-budgeted `getLinkPreview`),
 * and a post body may carry up to MAX_EMBEDS_PER_CONTENT (200) of them. One
 * page render is therefore allowed at most this many LIVE fetches, started
 * together (the constant is both the per-render outbound cap and the
 * concurrency, so the wall-clock cost stays one fetch budget). Everything the
 * `ZoneLinkPreview` cache already answers is served from ONE batched read —
 * cached links are free, whatever their number — and the uncached remainder
 * is DEFERRED (`null`): the card fetches it lazily through `/api/zones/embed`,
 * whose 30/min link budget is the throttle a per-render cap cannot be. A
 * failed cache row counts as live (link-preview.ts owns the retry rule and
 * answers a fresh failure from the row without a fetch).
 */
export const MAX_LIVE_LINK_FETCHES_PER_PASS = 4;

type LinkPreviewRow = {
  urlHash: string;
  url: string;
  title: string;
  description: string;
  imageUrl: string | null;
  siteName: string;
  ok: boolean;
};

async function resolveLink(refs: string[]): Promise<Resolved> {
  const out: Resolved = new Map();
  const hashOf = new Map<string, string>(); // normalized ref → urlHash
  for (const url of refs) {
    const normalized = normalizePreviewUrl(url);
    if (normalized) hashOf.set(url, linkPreviewHash(normalized));
  }
  const cached = new Map<string, LinkPreviewRow>();
  if (hashOf.size > 0) {
    try {
      const rows = await prisma.zoneLinkPreview.findMany({
        where: { urlHash: { in: [...new Set(hashOf.values())] } },
        select: { urlHash: true, url: true, title: true, description: true, imageUrl: true, siteName: true, ok: true },
      });
      for (const row of rows) cached.set(row.urlHash, row);
    } catch {
      // DB hiccup — every ref falls into the live path, still under the cap
    }
  }

  const live: string[] = [];
  for (const url of refs) {
    const row = cached.get(hashOf.get(url) ?? '');
    if (row?.ok) {
      out.set(url, {
        kind: 'link',
        ref: url,
        ok: true,
        data: {
          url: row.url,
          hostname: hostnameOf(row.url),
          title: row.title,
          description: row.description,
          imageUrl: row.imageUrl,
          siteName: row.siteName,
        },
      });
    } else {
      live.push(url);
    }
  }

  await Promise.all(
    live.slice(0, MAX_LIVE_LINK_FETCHES_PER_PASS).map(async (url) => {
      try {
        const data = await getLinkPreview(url);
        out.set(url, { kind: 'link', ref: url, ok: true, data });
      } catch {
        out.set(url, fail('link', url, 'error'));
      }
    }),
  );
  for (const url of live.slice(MAX_LIVE_LINK_FETCHES_PER_PASS)) out.set(url, null);
  return out;
}

// ── dispatcher ───────────────────────────────────────────────────────────────

const RESOLVERS: Record<EmbedKind, (refs: string[], ctx: EmbedContext) => Promise<Resolved>> = {
  library: resolveLibrary,
  short: resolveShort,
  video: resolveVideo,
  skill: (refs) => resolveSkill(refs),
  pack: (refs) => resolvePack(refs),
  event: resolveEvent,
  post: resolvePost,
  file: resolveFile,
  link: (refs) => resolveLink(refs),
};

/**
 * Resolve every token of a body in one pass. Keyed by `embedKey(kind, ref)`
 * using the ref AS GIVEN (splitEmbedSegments already normalized it, so the
 * renderer's keys line up). Never throws. A token a resolver DEFERRED (only
 * `link`, past MAX_LIVE_LINK_FETCHES_PER_PASS uncached urls) has NO entry —
 * `ZoneMarkdown` hands an absent key to the card, which fetches it itself.
 */
export async function resolveEmbeds(refs: EmbedRef[], ctx: EmbedContext): Promise<Record<string, EmbedData>> {
  const out: Record<string, EmbedData> = {};
  if (refs.length === 0) return out;

  const byKind = new Map<EmbedKind, Map<string, string[]>>(); // kind → normalized ref → raw refs
  for (const r of refs) {
    const key = embedKey(r.kind, r.ref);
    if (key in out) continue;
    const normalized = normalizeEmbedRef(r.kind, r.ref);
    if (!normalized) {
      out[key] = fail(r.kind, r.ref, 'invalid');
      continue;
    }
    let perKind = byKind.get(r.kind);
    if (!perKind) {
      perKind = new Map();
      byKind.set(r.kind, perKind);
    }
    const raws = perKind.get(normalized) ?? [];
    if (!raws.includes(r.ref)) raws.push(r.ref);
    perKind.set(normalized, raws);
    out[key] = fail(r.kind, r.ref, 'not_found'); // placeholder until resolved
  }

  await Promise.all(
    [...byKind].map(async ([kind, perKind]) => {
      const normalizedRefs = [...perKind.keys()];
      let resolved: Resolved;
      try {
        resolved = await RESOLVERS[kind](normalizedRefs, ctx);
      } catch (e) {
        console.warn('[zones/embeds] resolver failed', kind, e instanceof Error ? e.message : e);
        resolved = new Map();
        for (const ref of normalizedRefs) resolved.set(ref, fail(kind, ref, 'error'));
      }
      for (const [normalized, raws] of perKind) {
        const hit = resolved.get(normalized);
        for (const raw of raws) {
          const key = embedKey(kind, raw);
          if (hit === null) {
            delete out[key]; // deferred — drop the placeholder so the card fetches it
            continue;
          }
          out[key] = hit ? { ...hit, ref: raw } : fail(kind, raw, 'not_found');
        }
      }
    }),
  );
  return out;
}

/**
 * One token (the `/api/zones/embed` route — the lazy path the cards use). A
 * single ref can never be deferred (1 ≤ MAX_LIVE_LINK_FETCHES_PER_PASS), so
 * the card's fetch always ends in an answer, never in another deferral.
 */
export async function resolveEmbed(kind: EmbedKind, ref: string, ctx: EmbedContext): Promise<EmbedData> {
  const all = await resolveEmbeds([{ kind, ref }], ctx);
  return all[embedKey(kind, ref)] ?? fail(kind, ref, 'not_found');
}

// ── picker search ────────────────────────────────────────────────────────────
//
// 插入引用 is a content BROWSER: per kind, 全部 / 我发布的 / 我的收藏 × 最新 / 最热,
// 20 rows a page, 全部 = the viewer's own rows first, then everyone else's.
// What those words mean is decided per kind from the schema:
//
// | kind    | 我发布的 (publisher)                | 我的收藏 (per-viewer save)        | 最新 orders by / 「更新于」 shows          | 最热 orders by                                   |
// |---------|-------------------------------------|-----------------------------------|-------------------------------------------|--------------------------------------------------|
// | library | `uploaderId`                        | `LibraryShelfItem` (书架)          | `createdAt` (入库)                         | viewCount → shelfCount → likeCount               |
// | video   | `uploaderId`                        | `VideoFavorite` (稍后看)           | `publishedAt` (nulls last)                 | viewCount → likeCount (the board's 最多观看)       |
// | short   | `uploaderId`                        | `VideoFavorite` (稍后看)           | `createdAt` (shorts publish on create)     | likeCount → viewCount (the shorts hot feed)      |
// | skill   | `authorId`                          | `Favorite` (收藏 — not Like/订阅)  | current version `createdAt` (a release)    | trendingScore → downloadCount (the 热门 sort)     |
// | pack    | — admins curate (`createdById` is an operator) | — no favourite model   | `createdAt`                                | installCount                                     |
// | event   | `authorId` (发起人)                  | `EventAttendee` (我参加的)          | `startAt`: 即将举行 first (ascending), then 已结束 | attendeeCount                              |
// | post    | `authorId` OR a `ZonePostAuthor` 合著 | `ZonePostBookmark` (收藏)          | `publishedAt` (nulls last); 已编辑 is a badge | likeCount → commentCount → viewCount (feed 最热) |
//
// 讨论区 has no embed kinds of its own (DISCUSSION_EMBED_KINDS = these minus `file`).
//
// Why never `updatedAt`: Prisma's @updatedAt is bumped by EVERY `update`, and
// every one of these models has counters incremented through one (a view, a
// like, a 书架 click, a CLI install, the skills trending cron) — 「更新于 刚刚」
// would just mean "someone looked at it". Each kind therefore shows and sorts
// by the newest instant that only a CONTENT change moves.
//
// The date on the row is ALWAYS the one 最新 sorts by, so a list read top to
// bottom never jumps backwards. ZonePost is the one model with a real edit
// stamp and Prisma cannot order by COALESCE(editedAt, publishedAt), so a post
// shows its PUBLISH time (what it sorts by) plus an 已编辑 badge — showing
// `editedAt` while sorting by `publishedAt` put 「14 天前」 between two rows
// reading 「19 天前」. 活动 are the one kind whose ordering key is the event's
// own date rather than an authoring instant; that date is the row's subtitle
// (in the event's OWN zone — a 21:00Z start in Asia/Shanghai is the NEXT day
// there, and the UTC slice used to print the wrong day), so it is still the
// visible ordering key.
//
// The gate: every phase is `AND[gate, phase clause, keyword]` with the SAME
// discoverability filter this picker has always used (and the kind's browse
// page uses) — 我的收藏 can never be a side door: a 书架 doc that went private,
// a 稍后看 video that was unpublished, a bookmarked post that was deleted or
// narrowed to 仅成员可见 simply stops matching. `mine` + `rest` partition the
// gated set (publisher = viewer / ≠ viewer), so 全部 pages have no duplicates
// and no gaps (lib/zones/embed-search-shared.ts#paginateEmbedPhases). Favourite
// flags are ONE batched join-table read per page, never a per-row lookup.
//
// Paging: 最新 pages by KEYSET on the very column it orders by, so publishing
// or deleting a row between two pages can no longer make a row vanish from the
// stream; 最热 keeps offset paging (its counters move under any cursor) and
// says `truncated` when the offset cap, not the data, ends the stream. Each
// 最新 `orderBy` is therefore exactly `[<key>, id]` — a third column would put
// rows in an order the keyset clause cannot express.

const insensitive = (value: string) => ({ contains: value, mode: 'insensitive' as const });

/** A page row before the per-page favourite flag is attached. */
interface PickerRow {
  id: string;
  /**
   * The value the kind's 最新 order sorts by — keyset cursors are minted from
   * it. `null` = that column is NULL on this row (it then sorts last).
   */
  sortAt: Date | null;
  candidate: Omit<EmbedCandidate, 'favorited'>;
}

interface PickerSource {
  fetch: EmbedPhaseFetcher<PickerRow>;
  /** The subset of `ids` (row ids) the viewer saved — one query. */
  favoritedIds: (ids: string[]) => Promise<Set<string>>;
}

interface PhaseClauses<W> {
  mine: (uid: string) => W;
  rest: (uid: string) => W;
  fav: (uid: string) => W;
}

/**
 * The publisher half of a `where`. `null` = the phase cannot match anything for
 * this viewer (no id), so the fetch short-circuits instead of querying.
 */
function phaseWhere<W extends object>(group: EmbedPhaseGroup, uid: string | null, clauses: PhaseClauses<W>): W | null {
  // Every WhereInput is all-optional, so `{}` (no narrowing) is a valid W.
  const none = {} as W;
  switch (group) {
    case 'all':
      return none;
    case 'rest':
      return uid ? clauses.rest(uid) : none;
    case 'mine':
      return uid ? clauses.mine(uid) : null;
    case 'fav':
      return uid ? clauses.fav(uid) : null;
  }
}

/** `skip` for an offset position; nothing at all for a keyset one. */
function skipOf(position: EmbedPhasePosition): { skip?: number } {
  return isKeysetPosition(position) ? {} : { skip: position.offset };
}

/** The keyset half of a `where` AND list — empty under offset paging and at the start of a phase. */
function keysetAnd<W>(position: EmbedPhasePosition, clause: (key: EmbedKeysetKey) => W): W[] {
  return isKeysetPosition(position) && position.after ? [clause(position.after)] : [];
}

// The two DESC helpers are NOT interchangeable, and picking the wrong one is a
// runtime 500 rather than a type error: Prisma refuses `{ field: null }` on a
// REQUIRED column ("Argument `createdAt` is missing"), and leaving the branch
// out of a NULLABLE column's clause would strand every null-key row.
// A null `at` on a required column can only come from a forged cursor, so those
// helpers degrade to the id comparison instead of building an invalid filter.

/** Keyset clause for `[<field> desc, id desc]` on a NOT NULL column. */
function afterDesc<W>(field: string, key: EmbedKeysetKey): W {
  if (key.at === null) return { id: { lt: key.id } } as W;
  return { OR: [{ [field]: { lt: key.at } }, { [field]: key.at, id: { lt: key.id } }] } as W;
}

/**
 * Keyset clause for `[<field> desc nulls last, id desc]` on a NULLABLE column:
 * rows strictly after (at, id). NULL-key rows sort LAST, so a non-null cursor
 * also admits them and a null cursor stays inside that trailing group.
 */
function afterDescNullsLast<W>(field: string, key: EmbedKeysetKey): W {
  if (key.at === null) return { [field]: null, id: { lt: key.id } } as W;
  return { OR: [{ [field]: { lt: key.at } }, { [field]: key.at, id: { lt: key.id } }, { [field]: null }] } as W;
}

/** Keyset clause for `[<field> asc, id asc]` on a NOT NULL column (活动 的 即将举行 半区). */
function afterAsc<W>(field: string, key: EmbedKeysetKey): W {
  if (key.at === null) return { id: { gt: key.id } } as W;
  return { OR: [{ [field]: { gt: key.at } }, { [field]: key.at, id: { gt: key.id } }] } as W;
}

async function idSet<T>(uid: string | null, ids: string[], read: (uid: string) => Promise<T[]>, pick: (row: T) => string): Promise<Set<string>> {
  if (!uid || ids.length === 0) return new Set();
  return new Set((await read(uid)).map(pick));
}

const iso = (d: Date) => d.toISOString();

function librarySource(q: string, sort: EmbedSearchSort, ctx: EmbedContext): PickerSource {
  const uid = ctx.viewer.id;
  const clauses: PhaseClauses<Prisma.LibraryDocWhereInput> = {
    mine: (id) => ({ uploaderId: id }),
    rest: (id) => ({ uploaderId: { not: id } }),
    fav: (id) => ({ shelfItems: { some: { userId: id } } }),
  };
  const orderBy: Prisma.LibraryDocOrderByWithRelationInput[] =
    sort === 'hot'
      ? [{ viewCount: 'desc' }, { shelfCount: 'desc' }, { likeCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
  return {
    fetch: async (phase, position, take) => {
      const scoped = phaseWhere(phaseGroup(phase), uid, clauses);
      if (!scoped) return [];
      const rows = await prisma.libraryDoc.findMany({
        where: {
          AND: [
            BROWSABLE_DOC_WHERE,
            scoped,
            ...keysetAnd<Prisma.LibraryDocWhereInput>(position, (k) => afterDesc('createdAt', k)),
            ...(q ? [{ OR: [{ title: insensitive(q) }, { author: insensitive(q) }] }] : []),
          ],
        },
        orderBy,
        ...skipOf(position),
        take,
        select: {
          id: true,
          slug: true,
          title: true,
          author: true,
          summary: true,
          summaryEn: true,
          coverUrl: true,
          uploaderId: true,
          createdAt: true,
          uploader: { select: { displayName: true } },
        },
      });
      return rows.map((d) => {
        const summary = pickText(ctx.locale, d.summary, d.summaryEn);
        const title = firstNonBlank(d.title, summary);
        return {
          id: d.id,
          sortAt: d.createdAt,
          candidate: {
            kind: 'library' as const,
            ref: d.slug,
            title,
            subtitle: firstNonBlank(d.author, d.uploader.displayName),
            imageUrl: d.coverUrl,
            updatedAt: iso(d.createdAt),
            mine: d.uploaderId === uid,
          },
        };
      });
    },
    favoritedIds: (ids) =>
      idSet(
        uid,
        ids,
        (id) => prisma.libraryShelfItem.findMany({ where: { userId: id, docId: { in: ids } }, select: { docId: true } }),
        (r) => r.docId,
      ),
  };
}

function videoSource(kind: 'video' | 'short', q: string, sort: EmbedSearchSort, ctx: EmbedContext): PickerSource {
  const uid = ctx.viewer.id;
  const isShort = kind === 'short';
  const clauses: PhaseClauses<Prisma.VideoWhereInput> = {
    mine: (id) => ({ uploaderId: id }),
    rest: (id) => ({ uploaderId: { not: id } }),
    fav: (id) => ({ favorites: { some: { userId: id } } }),
  };
  // Today's gate, unchanged: only published PUBLIC rows (an unlisted video
  // plays from its link but is not offered to strangers' posts).
  const gate: Prisma.VideoWhereInput = { isShort, status: 'published', visibility: 'public', deletedAt: null };
  // 最新 keys on one column + id (the keyset contract). Shorts publish on
  // create; long videos carry a real publish stamp, and the rare published row
  // without one sorts last and tie-breaks on id.
  const afterKey = isShort
    ? (k: EmbedKeysetKey) => afterDesc<Prisma.VideoWhereInput>('createdAt', k)
    : (k: EmbedKeysetKey) => afterDescNullsLast<Prisma.VideoWhereInput>('publishedAt', k);
  const orderBy: Prisma.VideoOrderByWithRelationInput[] = isShort
    ? sort === 'hot'
      ? [{ likeCount: 'desc' }, { viewCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }]
    : sort === 'hot'
      ? [{ viewCount: 'desc' }, { likeCount: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
      : [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
  return {
    fetch: async (phase, position, take) => {
      const scoped = phaseWhere(phaseGroup(phase), uid, clauses);
      if (!scoped) return [];
      const rows = await prisma.video.findMany({
        where: {
          AND: [
            gate,
            scoped,
            ...keysetAnd(position, afterKey),
            ...(q ? [{ OR: [{ title: insensitive(q) }, { summary: insensitive(q) }] }] : []),
          ],
        },
        orderBy,
        ...skipOf(position),
        take,
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          posterUrl: true,
          uploaderId: true,
          publishedAt: true,
          createdAt: true,
          uploader: { select: { displayName: true } },
        },
      });
      return rows.map((v) => ({
        id: v.id,
        sortAt: isShort ? v.createdAt : v.publishedAt,
        candidate: {
          kind,
          // shorts embed as `short:<id>`, long videos as `video:<slug>`
          ref: isShort ? v.id : v.slug,
          title: firstNonBlank(v.title, v.summary),
          subtitle: v.uploader.displayName,
          imageUrl: v.posterUrl,
          updatedAt: iso(isShort ? v.createdAt : (v.publishedAt ?? v.createdAt)),
          mine: v.uploaderId === uid,
        },
      }));
    },
    favoritedIds: (ids) =>
      idSet(
        uid,
        ids,
        (id) => prisma.videoFavorite.findMany({ where: { userId: id, videoId: { in: ids } }, select: { videoId: true } }),
        (r) => r.videoId,
      ),
  };
}

function skillSource(q: string, sort: EmbedSearchSort, ctx: EmbedContext): PickerSource {
  const uid = ctx.viewer.id;
  const clauses: PhaseClauses<Prisma.SkillWhereInput> = {
    mine: (id) => ({ authorId: id }),
    rest: (id) => ({ authorId: { not: id } }),
    fav: (id) => ({ favorites: { some: { userId: id } } }),
  };
  // A skill whose only version was yanked keeps `status: 'published'` with a
  // null `currentVersionId` — nothing to install, and ORDER BY a nullable
  // relation column DESC is NULLS FIRST in Postgres, so those rows sat at the
  // very top of 最新 showing their original createdAt. They are not offered.
  const released: Prisma.SkillWhereInput = { currentVersionId: { not: null } };
  const orderBy: Prisma.SkillOrderByWithRelationInput[] =
    sort === 'hot'
      ? [{ trendingScore: 'desc' }, { downloadCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ currentVersion: { createdAt: 'desc' } }, { id: 'desc' }];
  /** Keyset over the release instant, which `released` keeps non-null. */
  const afterRelease = (k: EmbedKeysetKey): Prisma.SkillWhereInput =>
    k.at === null
      ? { id: { lt: k.id } }
      : { OR: [{ currentVersion: { createdAt: { lt: k.at } } }, { currentVersion: { createdAt: k.at }, id: { lt: k.id } }] };
  return {
    fetch: async (phase, position, take) => {
      const scoped = phaseWhere(phaseGroup(phase), uid, clauses);
      if (!scoped) return [];
      const rows = await prisma.skill.findMany({
        where: {
          AND: [
            DISCOVERABLE_SKILL_WHERE,
            released,
            scoped,
            ...keysetAnd(position, afterRelease),
            ...(q ? [{ OR: [{ name: insensitive(q) }, { slug: insensitive(q) }, { summary: insensitive(q) }] }] : []),
          ],
        },
        orderBy,
        ...skipOf(position),
        take,
        select: {
          id: true,
          slug: true,
          name: true,
          summary: true,
          authorId: true,
          createdAt: true,
          currentVersion: { select: { createdAt: true } },
          author: { select: { displayName: true } },
        },
      });
      return rows.map((s) => {
        const title = firstNonBlank(s.name, s.summary);
        const summary = s.summary.trim();
        const releasedAt = s.currentVersion?.createdAt ?? s.createdAt;
        return {
          id: s.id,
          sortAt: releasedAt,
          candidate: {
            kind: 'skill' as const,
            ref: s.slug,
            title,
            subtitle: [s.author.displayName, summary && summary !== title ? summary : ''].filter(Boolean).join(' · '),
            imageUrl: null,
            updatedAt: iso(releasedAt),
            mine: s.authorId === uid,
          },
        };
      });
    },
    favoritedIds: (ids) =>
      idSet(
        uid,
        ids,
        (id) => prisma.favorite.findMany({ where: { userId: id, skillId: { in: ids } }, select: { skillId: true } }),
        (r) => r.skillId,
      ),
  };
}

function packSource(q: string, sort: EmbedSearchSort): PickerSource {
  const orderBy: Prisma.SkillPackOrderByWithRelationInput[] =
    sort === 'hot'
      ? [{ installCount: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
  return {
    fetch: async (phase, position, take) => {
      // 合集包 offer 全部 only (EMBED_SEARCH_SCOPES_BY_KIND) → the single `all` phase.
      if (phaseGroup(phase) !== 'all') return [];
      const rows = await prisma.skillPack.findMany({
        where: {
          AND: [
            { isPublished: true },
            ...keysetAnd<Prisma.SkillPackWhereInput>(position, (k) => afterDesc('createdAt', k)),
            ...(q ? [{ OR: [{ name: insensitive(q) }, { slug: insensitive(q) }, { summary: insensitive(q) }] }] : []),
          ],
        },
        orderBy,
        ...skipOf(position),
        take,
        select: { id: true, slug: true, name: true, summary: true, icon: true, createdAt: true },
      });
      return rows.map((p) => {
        const title = firstNonBlank(p.name, p.summary);
        const summary = p.summary.trim();
        return {
          id: p.id,
          sortAt: p.createdAt,
          candidate: {
            kind: 'pack' as const,
            ref: p.slug,
            title,
            subtitle: summary !== title ? summary : '',
            imageUrl: /^(\/|https?:\/\/)/i.test(p.icon) ? p.icon : null,
            updatedAt: iso(p.createdAt),
            mine: false,
          },
        };
      });
    },
    favoritedIds: async () => new Set(),
  };
}

function eventSource(q: string, sort: EmbedSearchSort, ctx: EmbedContext): PickerSource {
  const uid = ctx.viewer.id;
  const clauses: PhaseClauses<Prisma.EventWhereInput> = {
    mine: (id) => ({ authorId: id }),
    rest: (id) => ({ authorId: { not: id } }),
    fav: (id) => ({ attendees: { some: { userId: id } } }),
  };
  // 最新 = 「快要发生的在前」. Ordering by `createdAt` buried next week's event
  // under listings typed up yesterday for events that already ended, and an
  // author embedding an event almost always means an upcoming one. The split
  // is a PHASE (`<group>:up` then `<group>:past`, phasesFor), so 我发布的在前
  // still holds inside each half, and `upcoming` is the SAME boundary the
  // /events 即将举行 tab uses (per-zone start of today, `endAt ?? startAt`) —
  // a live or multi-day event stays in the first half.
  //
  // The second half is `pastWhere()`, NOT `{ NOT: upcomingWhere() }`. SQL is
  // three-valued: `(endAt ?? startAt)` is an OR over a nullable column, so for
  // a row with `endAt IS NULL` the upcoming expression is NULL, and `NOT NULL`
  // is NULL — a past all-day event with no end date matched NEITHER half and
  // silently left the picker (caught on the real database, not by the
  // in-memory test). `strayZone` closes the other end: a timed row whose
  // `timezone` is outside the closed EVENT_TIMEZONES set matches no per-zone
  // branch of either helper, so it is swept into 已结束 rather than dropped.
  const upcoming = upcomingWhere();
  const strayZone: Prisma.EventWhereInput = { allDay: false, timezone: { not: null, notIn: EVENT_TIMEZONES.map((t) => t.value) } };
  const past: Prisma.EventWhereInput = { OR: [pastWhere(), strayZone] };
  return {
    fetch: async (phase, position, take) => {
      const scoped = phaseWhere(phaseGroup(phase), uid, clauses);
      if (!scoped) return [];
      const slice = phaseSlice(phase);
      const ascending = slice === 'up';
      const orderBy: Prisma.EventOrderByWithRelationInput[] =
        sort === 'hot'
          ? [{ attendeeCount: 'desc' }, { startAt: 'desc' }, { id: 'desc' }]
          : ascending
            ? [{ startAt: 'asc' }, { id: 'asc' }]
            : [{ startAt: 'desc' }, { id: 'desc' }];
      const rows = await prisma.event.findMany({
        where: {
          AND: [
            { deletedAt: null },
            scoped,
            ...(slice === 'up' ? [upcoming] : slice === 'past' ? [past] : []),
            ...keysetAnd<Prisma.EventWhereInput>(position, (k) => (ascending ? afterAsc('startAt', k) : afterDesc('startAt', k))),
            ...(q ? [{ OR: [{ title: insensitive(q) }, { summary: insensitive(q) }] }] : []),
          ],
        },
        orderBy,
        ...skipOf(position),
        take,
        select: {
          id: true,
          title: true,
          summary: true,
          startAt: true,
          timezone: true,
          allDay: true,
          city: true,
          venue: true,
          coverUrl: true,
          authorId: true,
          createdAt: true,
        },
      });
      return rows.map((e) => ({
        id: e.id,
        sortAt: e.startAt,
        candidate: {
          kind: 'event' as const,
          ref: e.id,
          title: firstNonBlank(e.title, e.summary),
          // The event's own date — the key 最新 sorts by — in the event's OWN
          // zone (eventLocalDayKey, the same day the /events list groups it
          // under). The UTC slice this replaced printed 09-04 for a 21:00Z
          // start in Asia/Shanghai, which is 09-05 05:00 there.
          subtitle: [eventLocalDayKey(e.startAt, e.timezone, e.allDay), firstNonBlank(e.city, e.venue)].filter(Boolean).join(' · '),
          imageUrl: e.coverUrl,
          // 「更新于」 stays the listing's publish instant; the event's own date
          // is the subtitle above.
          updatedAt: iso(e.createdAt),
          mine: e.authorId === uid,
        },
      }));
    },
    favoritedIds: (ids) =>
      idSet(
        uid,
        ids,
        (id) => prisma.eventAttendee.findMany({ where: { userId: id, eventId: { in: ids } }, select: { eventId: true } }),
        (r) => r.eventId,
      ),
  };
}

function postSource(q: string, sort: EmbedSearchSort, ctx: EmbedContext): PickerSource {
  const uid = ctx.viewer.id;
  const clauses: PhaseClauses<Prisma.ZonePostWhereInput> = {
    mine: (id) => ({ OR: [{ authorId: id }, { coauthors: { some: { userId: id } } }] }),
    rest: (id) => ({ authorId: { not: id }, coauthors: { none: { userId: id } } }),
    fav: (id) => ({ bookmarks: { some: { userId: id } } }),
  };
  const orderBy: Prisma.ZonePostOrderByWithRelationInput[] =
    sort === 'hot'
      ? [{ likeCount: 'desc' }, { commentCount: 'desc' }, { viewCount: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
      : [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
  return {
    fetch: async (phase, position, take) => {
      const scoped = phaseWhere(phaseGroup(phase), uid, clauses);
      if (!scoped) return [];
      const rows = await prisma.zonePost.findMany({
        // AND-of-OR-groups: the visibility half and the 我发布的 half each carry
        // their own `OR`, so neither the keyword nor the phase can overwrite it.
        // Without the visibility half the picker would list the TITLES of
        // 仅成员可见 / 指定成员可见 posts to anyone who can read the 版块.
        where: {
          AND: [
            { status: 'published', deletedAt: null, zone: readableZoneWhere(ctx.viewer) },
            zonePostVisibilityWhere(null, ctx.viewer),
            scoped,
            ...keysetAnd<Prisma.ZonePostWhereInput>(position, (k) => afterDescNullsLast('publishedAt', k)),
            ...(q ? [{ OR: [{ title: insensitive(q) }, { summary: insensitive(q) }] }] : []),
          ],
        },
        orderBy,
        ...skipOf(position),
        take,
        select: {
          id: true,
          title: true,
          summary: true,
          coverUrl: true,
          authorId: true,
          publishedAt: true,
          editedAt: true,
          createdAt: true,
          // Only the viewer's own co-author row — `mine` needs nothing else, and
          // Prisma loads this relation for the whole page in ONE query.
          coauthors: uid ? { where: { userId: uid }, select: { userId: true } } : { take: 0, select: { userId: true } },
          author: { select: { displayName: true } },
          zone: { select: { name: true } },
        },
      });
      return rows.map((p) => ({
        id: p.id,
        sortAt: p.publishedAt,
        candidate: {
          kind: 'post' as const,
          ref: p.id,
          title: firstNonBlank(p.title, p.summary),
          subtitle: [p.zone.name, p.author.displayName].filter(Boolean).join(' · '),
          imageUrl: p.coverUrl,
          // The PUBLISH time — the key 最新 sorts by. A later edit is a badge
          // (`edited`), not a different date, or the column would read out of
          // order against the rows around it.
          updatedAt: iso(p.publishedAt ?? p.createdAt),
          edited: !!p.editedAt,
          mine: !!uid && (p.authorId === uid || p.coauthors.some((c) => c.userId === uid)),
        },
      }));
    },
    favoritedIds: (ids) =>
      idSet(
        uid,
        ids,
        (id) => prisma.zonePostBookmark.findMany({ where: { userId: id, postId: { in: ids } }, select: { postId: true } }),
        (r) => r.postId,
      ),
  };
}

function pickerSource(kind: SearchableEmbedKind, q: string, sort: EmbedSearchSort, ctx: EmbedContext): PickerSource {
  switch (kind) {
    case 'library':
      return librarySource(q, sort, ctx);
    case 'short':
    case 'video':
      return videoSource(kind, q, sort, ctx);
    case 'skill':
      return skillSource(q, sort, ctx);
    case 'pack':
      return packSource(q, sort);
    case 'event':
      return eventSource(q, sort, ctx);
    case 'post':
      return postSource(q, sort, ctx);
  }
}

export interface EmbedSearchOptions {
  q?: string;
  scope?: EmbedSearchScope;
  sort?: EmbedSearchSort;
  /** Already decoded against `phasesFor(kind, scope, sort)` + `pagingForSort(sort)` (the route 400s garbage). */
  cursor?: EmbedSearchCursor | null;
  /** Defaults to EMBED_SEARCH_PAGE_SIZE; tests shrink it. */
  pageSize?: number;
}

/**
 * One page of candidates for the composer's 插入引用 dialog. Throws on a
 * database error — an empty page would read as 已经到底了, so the route turns a
 * failure into a 500 the dialog can offer to retry.
 */
export async function searchEmbedCandidates(kind: SearchableEmbedKind, opts: EmbedSearchOptions, ctx: EmbedContext): Promise<EmbedSearchPage> {
  const q = (opts.q ?? '').trim().slice(0, EMBED_SEARCH_MAX_QUERY);
  const scope = opts.scope ?? 'all';
  const sort = opts.sort ?? 'new';
  const phases = phasesFor(kind, scope, sort);
  const pageSize = Math.max(1, Math.min(EMBED_SEARCH_PAGE_SIZE, Math.trunc(opts.pageSize ?? EMBED_SEARCH_PAGE_SIZE)));
  const source = pickerSource(kind, q, sort, ctx);

  const { rows, next, truncated } = await paginateEmbedPhases(phases, opts.cursor ?? null, pageSize, source.fetch, {
    paging: pagingForSort(sort),
    keyOf: (r) => ({ at: r.sortAt, id: r.id }),
  });
  // 我的收藏 rows are saved by definition; every other page asks once.
  const saved = scope === 'fav' ? new Set(rows.map((r) => r.id)) : await source.favoritedIds(rows.map((r) => r.id));
  return {
    items: rows.map((r) => ({ ...r.candidate, favorited: saved.has(r.id) })),
    nextCursor: next ? encodeEmbedSearchCursor(next) : null,
    truncated,
  };
}


// ── library chapter preview (drawer) ─────────────────────────────────────────

/**
 * One chapter of a 知识库 doc for the preview drawer — the reader page's gate
 * (`getDocReaderData`) copied: ready && !deleted → discoverable, `canReadDoc`
 * → chapter HTML. Chapter HTML is served exactly as stored (sanitized at ingest).
 */
export async function getLibraryPreview(
  slug: string,
  chapterIndex: number,
  ctx: EmbedContext,
): Promise<EmbedLibraryPreview | 'no_access' | null> {
  const doc = await prisma.libraryDoc.findUnique({
    where: { slug },
    select: { ...LIBRARY_EMBED_SELECT, aiOverview: true, aiOverviewEn: true },
  });
  if (!doc || doc.status !== 'ready' || doc.deletedAt) return null;
  const lv = libraryViewerFromSession(ctx.session);
  const privileged = !!lv && (lv.canManage || lv.id === doc.uploaderId);
  if (doc.visibility === 'private' && !privileged) return null;
  if (!(await canReadDoc(doc, lv))) return 'no_access';

  const data = await libraryDataFor(doc, ctx);
  if (typeof data === 'string') return null;

  const toc = await prisma.libraryChapter.findMany({
    where: { docId: doc.id },
    orderBy: { chapterIndex: 'asc' },
    select: { chapterIndex: true, title: true, charCount: true },
  });
  const maxIndex = Math.max(0, toc.length - 1);
  const requested = Number.isFinite(chapterIndex) && chapterIndex >= 0 ? Math.trunc(chapterIndex) : 0;
  const resolved = Math.min(requested, maxIndex);
  const chapter =
    toc.length > 0
      ? await prisma.libraryChapter.findUnique({
          where: { docId_chapterIndex: { docId: doc.id, chapterIndex: resolved } },
          select: { chapterIndex: true, title: true, html: true },
        })
      : null;

  const overview = pickOverview(ctx.locale, asAiOverview(doc.aiOverview), asAiOverview(doc.aiOverviewEn));
  return {
    doc: data,
    overview: overview ? { summary: overview.summary, outline: overview.outline, keyPoints: overview.keyPoints } : null,
    toc: toc.map((c) => ({ chapterIndex: c.chapterIndex, title: c.title, charCount: c.charCount })),
    chapter: chapter ? { chapterIndex: chapter.chapterIndex, title: chapter.title, html: chapter.html } : null,
  };
}
