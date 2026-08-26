// 技术专区 native embeds — `[embed:<kind>:<ref>]` resolver.
//
// Every kind is gated by the SOURCE domain's own visibility rule (the same
// helper its detail page uses), never by the zone's: a restricted 知识库 doc is
// discoverable but not readable, a private skill is invisible, an unlisted
// video plays, a members-only zone post only shows to that zone's members…
// Refs are batched per kind (one findMany each), the resolver never throws —
// a bad / missing / forbidden ref becomes `{ ok: false, reason }` so one dead
// token can never blank a whole post.

import type { Session } from 'next-auth';
import { prisma } from '@/lib/db';
import { eventViewerFromSession, getEventDetail } from '@/lib/event-queries';
import { BROWSABLE_DOC_WHERE, canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';
import { asAiOverview, pickOverview, pickText } from '@/lib/library/i18n-content';
import { INSTALLABLE_SKILL_WHERE } from '@/lib/pack-queries';
import { DISCOVERABLE_SKILL_WHERE, SKILL_CARD_SELECT } from '@/lib/skill-queries';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { canViewVideo, videoActorFrom } from '@/lib/video/access';
import { VIDEO_DETAIL_INCLUDE } from '@/lib/video/queries';
import { SHORT_FEED_SELECT, annotateShortsViewer, toShortView } from '@/lib/video/shorts-queries';
import { ZONE_ACCESS_SELECT, resolveZoneAccess, type ZoneAccessRow, type ZoneSiteViewer } from './access';
import { getLinkPreview } from './link-preview';
import type { ZoneAccess } from './permissions';
import { readableZoneWhere, toAttachmentView } from './post-queries';
import { embedKey, normalizeEmbedRef, zonePostHref, type EmbedKind, type EmbedRef } from './shared';
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
  EmbedShortData,
  EmbedSkillData,
  EmbedVideoData,
} from './types';

export interface EmbedContext {
  viewer: ZoneSiteViewer;
  session: Session | null;
  locale?: string;
}

type Resolved = Map<string, EmbedData>;

function fail(kind: EmbedKind, ref: string, reason: EmbedFailReason): EmbedData {
  return { kind, ref, ok: false, reason };
}

const MAX_CANDIDATES = 20;

function clampTake(take: number | undefined): number {
  const n = Number(take ?? 10);
  return Number.isFinite(n) ? Math.min(MAX_CANDIDATES, Math.max(1, Math.trunc(n))) : 10;
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
      id: true,
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
      if (!access.canRead) {
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

async function resolveFile(refs: string[], ctx: EmbedContext): Promise<Resolved> {
  const out: Resolved = new Map();
  const rows = await prisma.zonePostAttachment.findMany({
    // A soft-deleted post's attachments are gone for everyone — the `post` kind
    // filters `deletedAt` in its query too, so the author / moderator branch
    // below must never resurrect them.
    where: { id: { in: refs }, post: { deletedAt: null } },
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
          id: true,
          status: true,
          deletedAt: true,
          authorId: true,
          coauthors: { select: { userId: true } },
          zone: { select: ZONE_ACCESS_SELECT },
        },
      },
    },
  });
  const accessCache = new ZoneAccessCache(ctx.viewer);
  await Promise.all(
    rows.map(async (a) => {
      const post = a.post;
      if (post.zone.deletedAt && !ctx.viewer.siteAdmin) return;
      const access = await accessCache.get(post.zone);
      const viewerId = ctx.viewer.id;
      const isAuthor = !!viewerId && (post.authorId === viewerId || post.coauthors.some((c) => c.userId === viewerId));
      const published = post.status === 'published' && !post.deletedAt;
      if (!((published && access.canRead) || isAuthor || access.canModerate)) {
        out.set(a.id, fail('file', a.id, 'forbidden'));
        return;
      }
      const data: EmbedFileData = { ...toAttachmentView(a), postId: post.id, zoneSlug: post.zone.slug };
      out.set(a.id, { kind: 'file', ref: a.id, ok: true, data });
    }),
  );
  return out;
}

// ── link ─────────────────────────────────────────────────────────────────────

async function resolveLink(refs: string[]): Promise<Resolved> {
  const out: Resolved = new Map();
  await Promise.all(
    refs.map(async (url) => {
      try {
        const data = await getLinkPreview(url);
        out.set(url, { kind: 'link', ref: url, ok: true, data });
      } catch {
        out.set(url, fail('link', url, 'error'));
      }
    }),
  );
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
 * renderer's keys line up). Never throws.
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
          out[embedKey(kind, raw)] = hit ? { ...hit, ref: raw } : fail(kind, raw, 'not_found');
        }
      }
    }),
  );
  return out;
}

export async function resolveEmbed(kind: EmbedKind, ref: string, ctx: EmbedContext): Promise<EmbedData> {
  const all = await resolveEmbeds([{ kind, ref }], ctx);
  return all[embedKey(kind, ref)] ?? fail(kind, ref, 'not_found');
}

// ── picker search ────────────────────────────────────────────────────────────

/**
 * Candidates for the composer's 插入 dialog. Each kind searches with the same
 * discoverability filter its browse page uses; `file` / `link` are not
 * searchable (attachments come from the post, links are typed in).
 */
export async function searchEmbedCandidates(
  kind: EmbedKind,
  q: string,
  ctx: EmbedContext,
  take?: number,
): Promise<EmbedCandidate[]> {
  const query = q.trim().slice(0, 64);
  const limit = clampTake(take);
  const contains = { contains: query, mode: 'insensitive' as const };
  try {
    switch (kind) {
      case 'library': {
        const rows = await prisma.libraryDoc.findMany({
          where: { ...BROWSABLE_DOC_WHERE, ...(query ? { OR: [{ title: contains }, { author: contains }] } : {}) },
          orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
          take: limit,
          select: { slug: true, title: true, author: true, docType: true, coverUrl: true },
        });
        return rows.map((d) => ({ kind, ref: d.slug, title: d.title, subtitle: d.author ?? d.docType, imageUrl: d.coverUrl }));
      }
      case 'short': {
        const rows = await prisma.video.findMany({
          where: {
            isShort: true,
            status: 'published',
            visibility: 'public',
            deletedAt: null,
            ...(query ? { OR: [{ title: contains }, { summary: contains }] } : {}),
          },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: limit,
          select: { id: true, title: true, summary: true, posterUrl: true, uploader: { select: { displayName: true } } },
        });
        return rows.map((v) => ({
          kind,
          ref: v.id,
          title: v.title || v.summary,
          subtitle: v.uploader.displayName,
          imageUrl: v.posterUrl,
        }));
      }
      case 'video': {
        const rows = await prisma.video.findMany({
          where: {
            isShort: false,
            status: 'published',
            visibility: 'public',
            deletedAt: null,
            ...(query ? { OR: [{ title: contains }, { summary: contains }] } : {}),
          },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: limit,
          select: { slug: true, title: true, posterUrl: true, uploader: { select: { displayName: true } } },
        });
        return rows.map((v) => ({ kind, ref: v.slug, title: v.title, subtitle: v.uploader.displayName, imageUrl: v.posterUrl }));
      }
      case 'skill': {
        const rows = await prisma.skill.findMany({
          where: { ...DISCOVERABLE_SKILL_WHERE, ...(query ? { OR: [{ name: contains }, { slug: contains }, { summary: contains }] } : {}) },
          orderBy: [{ trendingScore: 'desc' }, { updatedAt: 'desc' }],
          take: limit,
          select: { slug: true, name: true, summary: true },
        });
        return rows.map((s) => ({ kind, ref: s.slug, title: s.name, subtitle: s.summary, imageUrl: null }));
      }
      case 'pack': {
        const rows = await prisma.skillPack.findMany({
          where: { isPublished: true, ...(query ? { OR: [{ name: contains }, { slug: contains }, { summary: contains }] } : {}) },
          orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
          take: limit,
          select: { slug: true, name: true, summary: true, icon: true },
        });
        return rows.map((p) => ({
          kind,
          ref: p.slug,
          title: p.name,
          subtitle: p.summary,
          imageUrl: /^(\/|https?:\/\/)/i.test(p.icon) ? p.icon : null,
        }));
      }
      case 'event': {
        const now = new Date();
        const where = { deletedAt: null, ...(query ? { title: contains } : {}) };
        const select = { id: true, title: true, startAt: true, city: true, venue: true, coverUrl: true };
        const upcoming = await prisma.event.findMany({
          where: { ...where, startAt: { gte: now } },
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          take: limit,
          select,
        });
        const past =
          upcoming.length < limit
            ? await prisma.event.findMany({
                where: { ...where, startAt: { lt: now } },
                orderBy: [{ startAt: 'desc' }, { id: 'desc' }],
                take: limit - upcoming.length,
                select,
              })
            : [];
        return [...upcoming, ...past].map((e) => ({
          kind,
          ref: e.id,
          title: e.title,
          subtitle: [e.startAt.toISOString().slice(0, 10), e.city ?? e.venue ?? ''].filter(Boolean).join(' · '),
          imageUrl: e.coverUrl,
        }));
      }
      case 'post': {
        const rows = await prisma.zonePost.findMany({
          where: {
            status: 'published',
            deletedAt: null,
            zone: readableZoneWhere(ctx.viewer),
            ...(query ? { OR: [{ title: contains }, { summary: contains }] } : {}),
          },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: limit,
          select: { id: true, title: true, coverUrl: true, zone: { select: { name: true } } },
        });
        return rows.map((p) => ({ kind, ref: p.id, title: p.title, subtitle: p.zone.name, imageUrl: p.coverUrl }));
      }
      case 'file':
      case 'link':
        return [];
    }
  } catch (e) {
    console.warn('[zones/embeds] search failed', kind, e instanceof Error ? e.message : e);
    return [];
  }
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
