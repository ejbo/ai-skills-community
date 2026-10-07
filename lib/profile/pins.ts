// 精选置顶 — resolving a member's pins for ONE viewer, and the owner's pin writes.
//
// `UserProfile.pins` stores only `{kind, id}`. Nothing about an item is trusted
// from it: at render every pin is re-resolved through its domain's own gate AND
// the profile's section gate, so a pin that was deleted, made private, moved
// behind a login wall or sits in a section the member hid simply disappears for
// the viewers who may not see it — silently, never as a broken card. A kind
// whose section this viewer may not see is not even queried.
//
// Writes (POST /api/me/profile/pins) additionally require the item to be the
// caller's OWN and to pass its public gate at pin time, so the list cannot be
// filled with someone else's content or with drafts.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { MAX_PINS, pinKey, sanitizePins, togglePin, type PinKind, type ProfilePin, type ProfileSection } from '@/lib/profile/shared';
import type { ProfileViewer } from '@/lib/profile/queries';
import { DISCOVERABLE_SKILL_WHERE } from '@/lib/skill-queries';
import { BROWSABLE_DOC_WHERE } from '@/lib/library-queries';
import { pickText } from '@/lib/library/i18n-content';
import { excerptOf } from '@/lib/discussion-queries';
import { PUBLISHED_PUBLIC } from '@/lib/video/queries';
import { SHORTS_PUBLIC } from '@/lib/video/shorts-queries';
import { countZoneFeed, listZoneFeed } from '@/lib/zones/post-queries';
import { zonePostHref } from '@/lib/zones/shared';
import { eventHref, topicHref, videoHref } from '@/lib/slug-href';
import { listEventsByAuthor } from '@/lib/event-queries';
import { listVoteActivitiesByCreator } from '@/lib/vote-queries';
import { voteHref } from '@/lib/votes/shared';

// ─── Pure ────────────────────────────────────────────────────────────────

/** The profile section each pin kind belongs to — its visibility decides the pin's. */
export const PIN_KIND_SECTION: Readonly<Record<PinKind, ProfileSection>> = {
  skill: 'skills',
  doc: 'docs',
  post: 'posts',
  topic: 'topics',
  short: 'videos',
  video: 'videos',
  event: 'events',
  zonePost: 'zones',
  vote: 'votes',
};

export function pinSection(kind: PinKind): ProfileSection {
  return PIN_KIND_SECTION[kind];
}

export type PinFigureKey = 'downloads' | 'likes' | 'comments' | 'replies' | 'upvotes' | 'views' | 'shelved' | 'entries' | 'voters' | 'attendees';

export type PinVisual =
  | { type: 'image'; url: string; shape: 'wide' | 'tall' }
  | { type: 'doc'; title: string; coverUrl: string | null; docType: string }
  | { type: 'none' };

export interface PinCardData {
  kind: PinKind;
  id: string;
  href: string;
  title: string;
  excerpt: string;
  visual: PinVisual;
  figures: { key: PinFigureKey; value: number }[];
  /** ISO — published / created. */
  at: string | null;
  /** restricted skill/doc · cancelled event · ended vote. */
  flag: 'restricted' | 'cancelled' | 'ended' | null;
  /** Where it lives: the 版块 of a zone post, the city of an event. */
  context: string | null;
  /** Event pins render their time through the viewer-zone client leaf. */
  eventTime: { startAt: string; endAt: string | null; allDay: boolean; timezone: string | null } | null;
}

/**
 * Pins in the member's order, keeping only those this viewer may see: the
 * kind's section is allowed AND the resolver found the item under its gate.
 */
export function orderResolvedPins(
  pins: readonly ProfilePin[],
  found: ReadonlyMap<string, PinCardData>,
  allowed: readonly ProfileSection[],
): PinCardData[] {
  const out: PinCardData[] = [];
  for (const pin of pins) {
    if (!allowed.includes(PIN_KIND_SECTION[pin.kind])) continue;
    const card = found.get(pinKey(pin));
    if (card) out.push(card);
  }
  return out;
}

/** Pins grouped by kind, restricted to kinds whose section is allowed (so nothing else is queried). */
export function queryablePinIds(pins: readonly ProfilePin[], allowed: readonly ProfileSection[]): Map<PinKind, string[]> {
  const byKind = new Map<PinKind, string[]>();
  for (const pin of pins) {
    if (!allowed.includes(PIN_KIND_SECTION[pin.kind])) continue;
    const ids = byKind.get(pin.kind) ?? [];
    if (!ids.includes(pin.id)) ids.push(pin.id);
    byKind.set(pin.kind, ids);
  }
  return byKind;
}

// ─── Resolution ──────────────────────────────────────────────────────────

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function resolveKind(
  v: ProfileViewer,
  kind: PinKind,
  ids: string[],
  locale: string,
): Promise<PinCardData[]> {
  const uid = v.profileUserId;
  const domainViewer = { id: v.gateViewerId, canManage: false, canSeeIdentity: v.canSeeIdentity };
  switch (kind) {
    case 'skill': {
      const rows = await prisma.skill.findMany({
        where: { id: { in: ids }, authorId: uid, ...DISCOVERABLE_SKILL_WHERE },
        select: { id: true, slug: true, name: true, summary: true, visibility: true, downloadCount: true, likeCount: true, updatedAt: true },
      });
      return rows.map((r) => ({
        kind,
        id: r.id,
        href: `/skills/${r.slug}`,
        title: r.name,
        excerpt: r.summary,
        visual: { type: 'none' },
        figures: [
          { key: 'downloads', value: r.downloadCount },
          { key: 'likes', value: r.likeCount },
        ],
        at: iso(r.updatedAt),
        flag: r.visibility === 'restricted' ? 'restricted' : null,
        context: null,
        eventTime: null,
      }));
    }
    case 'doc': {
      const rows = await prisma.libraryDoc.findMany({
        where: { id: { in: ids }, uploaderId: uid, ...BROWSABLE_DOC_WHERE },
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          summaryEn: true,
          docType: true,
          coverUrl: true,
          visibility: true,
          shelfCount: true,
          viewCount: true,
          createdAt: true,
        },
      });
      return rows.map((r) => ({
        kind,
        id: r.id,
        href: `/library/${r.slug}`,
        title: r.title,
        excerpt: pickText(locale, r.summary, r.summaryEn),
        visual: { type: 'doc', title: r.title, coverUrl: r.coverUrl, docType: r.docType },
        figures: [
          { key: 'shelved', value: r.shelfCount },
          { key: 'views', value: r.viewCount },
        ],
        at: iso(r.createdAt),
        flag: r.visibility === 'restricted' ? 'restricted' : null,
        context: null,
        eventTime: null,
      }));
    }
    case 'post': {
      const rows = await prisma.post.findMany({
        where: { id: { in: ids }, authorId: uid },
        select: {
          id: true,
          bodyMd: true,
          likeCount: true,
          commentCount: true,
          createdAt: true,
          media: { orderBy: { sortOrder: 'asc' }, select: { kind: true, url: true, posterUrl: true }, take: 8 },
        },
      });
      return rows.map((r) => {
        const image = r.media.find((m) => m.kind === 'image');
        // Video posters ride the login-walled discussion media route.
        const poster = v.loggedIn ? r.media.find((m) => m.kind === 'video' && m.posterUrl)?.posterUrl : null;
        const url = image?.url ?? poster ?? null;
        return {
          kind,
          id: r.id,
          href: `/discussion/posts/${r.id}`,
          title: excerptOf(r.bodyMd, 120),
          excerpt: '',
          visual: url ? { type: 'image', url, shape: 'wide' } : { type: 'none' },
          figures: [
            { key: 'likes', value: r.likeCount },
            { key: 'comments', value: r.commentCount },
          ],
          at: iso(r.createdAt),
          flag: null,
          context: null,
          eventTime: null,
        } satisfies PinCardData;
      });
    }
    case 'topic': {
      const rows = await prisma.discussionTopic.findMany({
        where: { id: { in: ids }, authorId: uid },
        select: { id: true, slug: true, title: true, bodyMd: true, replyCount: true, upvoteCount: true, viewCount: true, createdAt: true },
      });
      return rows.map((r) => ({
        kind,
        id: r.id,
        href: topicHref(r),
        title: r.title,
        excerpt: excerptOf(r.bodyMd, 120),
        visual: { type: 'none' },
        figures: [
          { key: 'replies', value: r.replyCount },
          { key: 'upvotes', value: r.upvoteCount },
        ],
        at: iso(r.createdAt),
        flag: null,
        context: null,
        eventTime: null,
      }));
    }
    case 'short':
    case 'video': {
      if (!v.loggedIn) return []; // login-walled board; posters 401 for anonymous
      const rows = await prisma.video.findMany({
        where: {
          id: { in: ids },
          uploaderId: uid,
          ...(kind === 'short' ? SHORTS_PUBLIC : PUBLISHED_PUBLIC),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          posterUrl: true,
          likeCount: true,
          viewCount: true,
          publishedAt: true,
          createdAt: true,
        },
      });
      return rows.map((r) => ({
        kind,
        id: r.id,
        href: kind === 'short' ? `/videos/shorts?v=${r.id}` : videoHref(r.slug),
        title: kind === 'short' ? r.summary || r.title : r.title,
        excerpt: kind === 'short' ? '' : r.summary,
        visual: r.posterUrl ? { type: 'image', url: r.posterUrl, shape: kind === 'short' ? 'tall' : 'wide' } : { type: 'none' },
        figures: [
          { key: 'views', value: r.viewCount },
          { key: 'likes', value: r.likeCount },
        ],
        at: iso(r.publishedAt ?? r.createdAt),
        flag: null,
        context: null,
        eventTime: null,
      }));
    }
    case 'event': {
      const res = await listEventsByAuthor(uid, domainViewer, { ids, pageSize: MAX_PINS });
      return res.items.map((e) => ({
        kind,
        id: e.id,
        href: eventHref(e),
        title: e.title,
        excerpt: e.summary,
        visual: e.coverUrl ? { type: 'image', url: e.coverUrl, shape: 'wide' } : { type: 'none' },
        figures: e.attendeeCount > 0 ? [{ key: 'attendees', value: e.attendeeCount }] : [],
        at: e.createdAt,
        flag: e.cancelled ? 'cancelled' : null,
        context: e.city,
        eventTime: { startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, timezone: e.timezone },
      }));
    }
    case 'zonePost': {
      if (!v.loggedIn) return [];
      const res = await listZoneFeed({
        viewer: { id: v.gateViewerId, siteAdmin: false, canSeeIdentity: v.canSeeIdentity },
        authorId: uid,
        ids,
        limit: MAX_PINS,
      });
      return res.items.map((p) => ({
        kind,
        id: p.id,
        href: zonePostHref(p.zone.slug, p),
        title: p.title,
        excerpt: p.summary,
        visual: p.coverUrl ? { type: 'image', url: p.coverUrl, shape: 'wide' } : { type: 'none' },
        figures: [
          { key: 'likes', value: p.likeCount },
          { key: 'comments', value: p.commentCount },
        ],
        at: p.publishedAt,
        flag: null,
        context: p.zone.name,
        eventTime: null,
      }));
    }
    case 'vote': {
      if (!v.loggedIn) return [];
      const res = await listVoteActivitiesByCreator(uid, domainViewer, { ids, pageSize: MAX_PINS });
      return res.items.map((a) => {
        const cover = a.over && a.winnerThumbUrl ? a.winnerThumbUrl : a.coverUrl;
        return {
          kind,
          id: a.id,
          href: voteHref(a),
          title: a.title,
          excerpt: '',
          visual: cover && !a.coverIsVideo ? { type: 'image', url: cover, shape: 'wide' } : { type: 'none' },
          figures: [
            { key: 'entries', value: a.entryCount },
            { key: 'voters', value: a.voterCount },
          ],
          at: a.publishedAt ?? a.createdAt,
          flag: a.over ? 'ended' : null,
          context: null,
          eventTime: null,
        } satisfies PinCardData;
      });
    }
  }
}

/** The 精选 band for this viewer. `rawPins` is the stored JSON (sanitized here). */
export async function resolveProfilePins(v: ProfileViewer, rawPins: unknown, locale: string): Promise<PinCardData[]> {
  const pins = sanitizePins(rawPins);
  if (pins.length === 0) return [];
  const byKind = queryablePinIds(pins, v.allowed);
  const lists = await Promise.all([...byKind.entries()].map(([kind, ids]) => resolveKind(v, kind, ids, locale)));
  const found = new Map<string, PinCardData>();
  for (const card of lists.flat()) found.set(pinKey(card), card);
  return orderResolvedPins(pins, found, v.allowed);
}

// ─── Writes ──────────────────────────────────────────────────────────────
//
// A stored pin can DIE after it was pinned: the item is deleted, archived, made
// private, or (transiently) a doc is being re-processed. The render path just
// drops it, but it still sits in `UserProfile.pins` and still counts toward
// MAX_PINS — and since no section list contains a dead item, no PinButton can
// ever unpin it. Two ways out, both server-decided:
//   • pinning into a FULL list prunes the dead pins first (inside the same
//     Serializable transaction), so a member is never stuck at 精选已满;
//   • the owner's 概览 shows "N 个精选已失效 · 清理", which prunes them all.
// Dead pins are deliberately NOT pruned while there is room: a doc that is
// only re-processing would otherwise lose its pin to an unrelated click.

/** Pin lists compare by key order — the member's order IS the band's order. */
export function samePins(a: readonly ProfilePin[], b: readonly ProfilePin[]): boolean {
  return a.length === b.length && a.every((p, i) => pinKey(p) === pinKey(b[i]));
}

/** The stored pins minus the ones known to be dead. Order kept. */
export function pruneDeadPins(current: readonly ProfilePin[], deadKeys: ReadonlySet<string>): ProfilePin[] {
  return sanitizePins(current).filter((p) => !deadKeys.has(pinKey(p)));
}

/**
 * The pure pin/unpin decision. Only pinning into a FULL list prunes `deadKeys`
 * and tries again (an already-pinned target or an unpin never gets that far);
 * the pruned list is the result even when it is STILL full, so the next
 * attempt starts from the truth.
 */
export function applyPinWrite(
  current: readonly ProfilePin[],
  pin: ProfilePin,
  pinned: boolean,
  deadKeys: ReadonlySet<string> = new Set(),
): { pins: ProfilePin[]; error: 'pins_full' | null } {
  const first = togglePin(current, pin, pinned);
  if (first.error !== 'pins_full') return first;
  const pruned = pruneDeadPins(current, deadKeys);
  if (pruned.length === first.pins.length) return first;
  const retry = togglePin(pruned, pin, pinned);
  return retry.error ? { pins: pruned, error: retry.error } : retry;
}

/** Stored pins as written (sanitized), read outside any transaction. */
export async function loadStoredPins(userId: string): Promise<ProfilePin[]> {
  const row = await prisma.userProfile.findUnique({ where: { userId }, select: { pins: true } });
  return sanitizePins(row?.pins);
}

/** Is this item the user's OWN and does it pass its public gate right now? */
export async function isOwnPinnable(userId: string, pin: ProfilePin): Promise<boolean> {
  const { id } = pin;
  const self = { id: userId, canManage: false, canSeeIdentity: false };
  switch (pin.kind) {
    case 'skill':
      return (await prisma.skill.count({ where: { id, authorId: userId, ...DISCOVERABLE_SKILL_WHERE } })) > 0;
    case 'doc':
      return (await prisma.libraryDoc.count({ where: { id, uploaderId: userId, ...BROWSABLE_DOC_WHERE } })) > 0;
    case 'post':
      return (await prisma.post.count({ where: { id, authorId: userId } })) > 0;
    case 'topic':
      return (await prisma.discussionTopic.count({ where: { id, authorId: userId } })) > 0;
    case 'short':
      return (await prisma.video.count({ where: { id, uploaderId: userId, ...SHORTS_PUBLIC } })) > 0;
    case 'video':
      return (await prisma.video.count({ where: { id, uploaderId: userId, ...PUBLISHED_PUBLIC } })) > 0;
    case 'event':
      return (await listEventsByAuthor(userId, self, { ids: [id], pageSize: 1 })).total > 0;
    case 'zonePost':
      return (await countZoneFeed({ viewer: { id: userId, siteAdmin: false, canSeeIdentity: false }, authorId: userId, ids: [id] })) > 0;
    case 'vote':
      return (await listVoteActivitiesByCreator(userId, self, { ids: [id], pageSize: 1 })).total > 0;
  }
}

/**
 * Keys of the stored pins that no longer pass `isOwnPinnable` — exactly the
 * pins the owner's own 概览 drops (the owner may see every section, and each
 * resolver uses the same gate). At most MAX_PINS small counts.
 */
export async function findDeadPins(userId: string, pins: readonly ProfilePin[]): Promise<Set<string>> {
  const live = await Promise.all(pins.map((p) => isOwnPinnable(userId, p)));
  return new Set(pins.filter((_, i) => !live[i]).map(pinKey));
}

function isRetryable(e: unknown): boolean {
  // P2034 = serialization failure; P2002 = two first-ever pins racing to create the row.
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2002');
}

/**
 * Read → decide → write under a Serializable transaction, so two quick clicks
 * in two tabs can neither lose a pin nor slip past MAX_PINS. `decide` is pure;
 * the list is written whenever it changed — including a prune that still ended
 * in pins_full.
 */
async function writePins(
  userId: string,
  decide: (current: ProfilePin[]) => { pins: ProfilePin[]; error: 'pins_full' | null },
): Promise<{ pins: ProfilePin[]; error: 'pins_full' | null; before: ProfilePin[] }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const row = await tx.userProfile.findUnique({ where: { userId }, select: { pins: true } });
          const current = sanitizePins(row?.pins);
          const result = decide(current);
          // Nothing changed (an idempotent retry, an unpin of an absent id) ⇒ no write, no empty row.
          if (!samePins(result.pins, current)) {
            const pins = result.pins as unknown as Prisma.InputJsonValue;
            await tx.userProfile.upsert({ where: { userId }, create: { userId, pins }, update: { pins } });
          }
          return { ...result, before: current };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (isRetryable(e) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 40));
        continue;
      }
      throw e;
    }
  }
}

/**
 * Pin / unpin. `deadKeys` (from `findDeadPins`, computed before the
 * transaction) are pruned only if the list is full — see the header above.
 */
export async function setProfilePin(
  userId: string,
  pin: ProfilePin,
  pinned: boolean,
  deadKeys: ReadonlySet<string> = new Set(),
): Promise<{ pins: ProfilePin[]; error: 'pins_full' | null }> {
  const { pins, error } = await writePins(userId, (current) => applyPinWrite(current, pin, pinned, deadKeys));
  return { pins, error };
}

/** 清理: drop every dead pin. Only keys found dead are removed, so a pin added meanwhile survives. */
export async function pruneProfilePins(
  userId: string,
  deadKeys: ReadonlySet<string>,
): Promise<{ pins: ProfilePin[]; removed: number }> {
  const { pins, before } = await writePins(userId, (current) => ({ pins: pruneDeadPins(current, deadKeys), error: null }));
  return { pins, removed: before.length - pins.length };
}
