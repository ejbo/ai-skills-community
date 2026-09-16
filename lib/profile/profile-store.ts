// 个人主页与名片 — the WRITE side (PUT /api/me/profile, PUT|DELETE
// /api/me/profile/media, POST /api/me/profile/media/clip, and the avatar/banner
// URL guard PUT /api/auth/me uses).
//
// Two layers on purpose:
//   - pure planners (`planProfileWrite`, `parseCardMediaInput`, `parseCardClipInput`,
//     the URL guards)
//     decide what a request body is allowed to become; they are unit-tested
//     (tests/profile-store.test.ts) and never touch the database
//   - the async writers apply a plan inside a transaction
//
// SHAPE errors are refused (400) — a string where the layout object belongs is
// a client bug, and "degrade to the default layout" would silently un-hide
// every section the member had hidden. CONTENT is sanitized by the shared
// contract (lib/profile/shared.ts) and never refused: an over-long headline is
// capped, a `javascript:` link is dropped.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  PROFILE_CLIP_MAX_SECONDS,
  defaultProfileLayout,
  isValidProfileMediaKey,
  parseCardConfig,
  parseProfileLayout,
  sanitizeAbout,
  sanitizeHeadline,
  sanitizeInterests,
  sanitizeProfileLinks,
  type CardConfig,
} from '@/lib/profile/shared';
import {
  PROFILE_CLIP_RETRY_AFTER_SEC,
  deleteOwnProfileMediaEntries,
  deleteProfileMediaFiles,
  isProfileMediaKeyTaggedFor,
  listStaleOwnProfileMedia,
  ownerTagFor,
  probeProfileVideo,
  profileClipToolsAvailable,
  renderProfileCardClip,
  statProfileMedia,
  type OwnProfileMediaEntry,
} from '@/lib/profile/card-media-storage';
import {
  CLIP_MIN_LENGTH_DEFAULT,
  normalizeClipRange,
  normalizeCover,
  parseStoredClip,
  type StoredClip,
} from '@/lib/media/clip-shared';
import { videoTimelineSec } from '@/lib/media/ffmpeg';
import { resolveCardMedia } from '@/lib/profile/card-view';
import type { ProfileCardMedia } from '@/lib/profile/types';

// ─── Image URL guards (avatar / banner) ─────────────────────────────────────

/** Exactly what POST /api/uploads/image returns: `/api/uploads/images/<nanoid>.<ext>`. */
export const UPLOADED_IMAGE_URL_RE = /^\/api\/uploads\/images\/[A-Za-z0-9_-]{8,40}\.(?:jpg|png|webp|avif|gif)$/;

export function isUploadedImageUrl(v: unknown): v is string {
  return typeof v === 'string' && UPLOADED_IMAGE_URL_RE.test(v);
}

export const EXTERNAL_IMAGE_URL_MAX = 2048;

/**
 * A clean absolute http(s) URL: parseable, no credentials, nothing that could
 * break out of an attribute or a CSS `url()` (whitespace, quotes, angle
 * brackets, backslash, backtick, control chars). Same checks as
 * sanitizeProfileLink, with room for the long signed URLs an IdP hands out.
 */
export function isSafeExternalImageUrl(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > EXTERNAL_IMAGE_URL_MAX) return false;
  if (!/^https?:\/\//i.test(v)) return false;
  if (/[\s"'<>`\\()]/.test(v)) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false; // C0 controls + DEL
  }
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return !u.username && !u.password && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * Lower-cased hostname — no port, no trailing dot — of a URL or a bare Host
 * header value (`example.com:3000`, `[::1]:80`); null when unparseable.
 */
export function normalizeHostname(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `http://${v}`);
    return u.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

/**
 * The hostnames an avatar URL may NOT point at: the app's own. An `<img>` GET
 * to our own host carries the viewer's session cookie (cookies ignore port and
 * scheme), so `https://<us>/ai-community/api/skills/x/raw` as an avatar made
 * every viewer's browser log a download, bump the counter and burn their daily
 * quota. Sources: the request's Host and every X-Forwarded-Host hop (what the
 * browser actually used behind nginx) and the configured AUTH_URL / APP_URL.
 */
export function selfHostnames(sources: {
  host?: string | null;
  forwardedHost?: string | null;
  urls?: readonly (string | null | undefined)[];
}): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const h = normalizeHostname(v);
    if (h) out.add(h);
  };
  add(sources.host);
  for (const hop of (sources.forwardedHost ?? '').split(',')) add(hop);
  for (const u of sources.urls ?? []) add(u);
  return [...out];
}

/**
 * Does this URL's PATH reach an `api` segment (`…/api/…`, or ending in `/api`)?
 * Side-effectful app endpoints all live under `/api/` (downloads that burn a
 * quota, likes, logout…), and the self-host denylist cannot know every hostname
 * that ends up at the app: on the intranet an alias host (ai4news → cari) 301s
 * inside `/ai-community/` and the SameSite=Lax session cookie follows an `<img>`
 * across that same-site redirect. So an external avatar may not point into any
 * `/api/` path, whatever the host. Checked on the percent-DECODED path (up to
 * three rounds — `%61pi`, `%2561pi`), split on `/`, `\` and `;` (an encoded
 * slash or a matrix parameter must not hide the segment), case-insensitively. A
 * path that cannot be decoded is treated as reaching one.
 */
export function urlPathHasApiSegment(v: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(v).pathname;
  } catch {
    return true;
  }
  for (let round = 0; round < 3; round++) {
    let next: string;
    try {
      next = decodeURIComponent(pathname);
    } catch {
      return true;
    }
    if (next === pathname) break;
    pathname = next;
  }
  return pathname.split(/[/\\;]/).some((seg) => seg.trim().toLowerCase() === 'api');
}

export type ImageUrlDecision = { ok: true; value: string | null; changed: boolean } | { ok: false };

/**
 * Decide an avatar/banner write. `null`/`''` clears. An UNCHANGED value is
 * always accepted as a no-op — rows written before this guard existed (any
 * `/…` or `http…` string was accepted then) must not make every later save of
 * an untouched form fail. Anything else must be our uploader's URL shape, or —
 * when `allowExternal` — a clean http(s) URL whose host is not one of
 * `blockedHosts` (the app's own, see selfHostnames) and whose path does not
 * reach an `/api/` segment on ANY host (urlPathHasApiSegment).
 */
export function decideImageUrl(
  raw: unknown,
  current: string | null,
  opts: { allowExternal: boolean; blockedHosts?: readonly string[] },
): ImageUrlDecision {
  if (raw !== null && typeof raw !== 'string') return { ok: false };
  if (raw === current) return { ok: true, value: current, changed: false };
  const v = (raw ?? '').trim();
  if (!v) return { ok: true, value: null, changed: current !== null };
  if (v === current) return { ok: true, value: current, changed: false };
  if (isUploadedImageUrl(v)) return { ok: true, value: v, changed: true };
  if (opts.allowExternal && isSafeExternalImageUrl(v) && !urlPathHasApiSegment(v)) {
    const host = normalizeHostname(v);
    const blocked = new Set((opts.blockedHosts ?? []).map((h) => normalizeHostname(h)).filter(Boolean));
    if (host && !blocked.has(host)) return { ok: true, value: v, changed: true };
  }
  return { ok: false };
}

// ─── PUT /api/me/profile ────────────────────────────────────────────────────

export interface ProfileWriteCurrent {
  card: unknown;
  bannerUrl: string | null;
}

export interface ProfileWritePlan {
  /** Fields for UserProfile.upsert (only the ones the body carried). */
  profile: {
    headline?: string | null;
    aboutMd?: string | null;
    interests?: string[];
    links?: Prisma.InputJsonValue;
    layout?: Prisma.InputJsonValue;
    card?: Prisma.InputJsonValue;
  };
  /** Present only when User.bannerUrl actually changes. */
  bannerUrl?: string | null;
}

export type ProfileWriteResult = { ok: true; plan: ProfileWritePlan } | { ok: false; error: 'invalid_input'; field?: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Pure: request body + the stored values it may merge with → what to write. */
export function planProfileWrite(body: unknown, current: ProfileWriteCurrent): ProfileWriteResult {
  if (!isPlainObject(body)) return { ok: false, error: 'invalid_input' };
  const bad = (field: string): ProfileWriteResult => ({ ok: false, error: 'invalid_input', field });
  const plan: ProfileWritePlan = { profile: {} };

  if (body.headline !== undefined) {
    if (body.headline !== null && typeof body.headline !== 'string') return bad('headline');
    plan.profile.headline = sanitizeHeadline(body.headline) || null;
  }
  if (body.aboutMd !== undefined) {
    if (body.aboutMd !== null && typeof body.aboutMd !== 'string') return bad('aboutMd');
    plan.profile.aboutMd = sanitizeAbout(body.aboutMd) || null;
  }
  if (body.interests !== undefined) {
    if (body.interests !== null && !Array.isArray(body.interests)) return bad('interests');
    plan.profile.interests = sanitizeInterests(body.interests);
  }
  if (body.links !== undefined) {
    if (body.links !== null && !Array.isArray(body.links)) return bad('links');
    plan.profile.links = sanitizeProfileLinks(body.links) as unknown as Prisma.InputJsonValue;
  }
  if (body.layout !== undefined) {
    // null = an explicit 恢复默认. Always stored as a full object: a NULL column
    // would hand the decision back to the legacy User.showProfile* flags.
    if (body.layout !== null && !isPlainObject(body.layout)) return bad('layout');
    const layout = body.layout === null ? defaultProfileLayout() : parseProfileLayout(body.layout, null);
    plan.profile.layout = { order: layout.order, hidden: layout.hidden };
  }
  if (body.card !== undefined) {
    // A partial card merges over the stored one (so a single switch can be
    // saved on its own); null resets to the defaults.
    if (body.card !== null && !isPlainObject(body.card)) return bad('card');
    const base = parseCardConfig(current.card);
    const next: CardConfig = body.card === null ? parseCardConfig({}) : parseCardConfig({ ...base, ...body.card });
    plan.profile.card = next as unknown as Prisma.InputJsonValue;
  }
  if (body.bannerUrl !== undefined) {
    const d = decideImageUrl(body.bannerUrl, current.bannerUrl, { allowExternal: false });
    if (!d.ok) return bad('bannerUrl');
    if (d.changed) plan.bannerUrl = d.value;
  }
  return { ok: true, plan };
}

/** Apply PUT /api/me/profile. */
export async function saveOwnProfile(userId: string, body: unknown): Promise<ProfileWriteResult> {
  return prisma.$transaction(async (tx): Promise<ProfileWriteResult> => {
    const row = await tx.user.findUnique({
      where: { id: userId },
      select: { bannerUrl: true, profile: { select: { card: true } } },
    });
    if (!row) return { ok: false, error: 'invalid_input' };
    const result = planProfileWrite(body, { card: row.profile?.card ?? null, bannerUrl: row.bannerUrl });
    if (!result.ok) return result;
    const { profile, bannerUrl } = result.plan;
    if (Object.keys(profile).length > 0) {
      await tx.userProfile.upsert({
        where: { userId },
        create: { userId, ...profile },
        update: profile,
      });
    }
    if (bannerUrl !== undefined) {
      await tx.user.update({ where: { id: userId }, data: { bannerUrl } });
    }
    return result;
  });
}

// ─── PUT / DELETE /api/me/profile/media, POST …/media/clip ───────────────────

export interface CardMediaInput {
  kind: 'image' | 'video';
  mediaKey: string;
  posterKey: string | null;
  loopKey: string | null;
}

export type CardMediaInputResult = { ok: true; input: CardMediaInput } | { ok: false; error: 'invalid_input' };

/**
 * Pure check of the echoed keys. Each key must be the right KIND (`poster/…`
 * can't be sent as the media) AND carry `ownerTag` — the caller's own upload
 * tag (card-media-storage.ts#ownerTagFor). Keys are public (they sit in card
 * URLs) and there is no uploader ledger, so without the tag a member could
 * attach someone else's file — including one its owner had just removed, which
 * kept the removed photo served on the claimer's card. Legacy untagged keys
 * never pass; the editor always attaches fresh uploads.
 */
export function parseCardMediaInput(body: unknown, ownerTag: string): CardMediaInputResult {
  const bad = { ok: false, error: 'invalid_input' } as const;
  if (!isPlainObject(body)) return bad;
  const { kind, mediaKey, posterKey, loopKey } = body;
  if (kind !== 'image' && kind !== 'video') return bad;
  if (!isValidProfileMediaKey(mediaKey, kind)) return bad;
  const mine = (k: string) => isProfileMediaKeyTaggedFor(k, ownerTag);
  if (!mine(mediaKey)) return bad;
  if (kind === 'image') {
    // An image has no poster/loop; stray keys are a client mix-up, never stored.
    if ((posterKey ?? null) !== null || (loopKey ?? null) !== null) return bad;
    return { ok: true, input: { kind, mediaKey, posterKey: null, loopKey: null } };
  }
  const poster = posterKey ?? null;
  const loop = loopKey ?? null;
  if (poster !== null && !(isValidProfileMediaKey(poster, 'poster') && mine(poster))) return bad;
  if (loop !== null && !(isValidProfileMediaKey(loop, 'loop') && mine(loop))) return bad;
  return { ok: true, input: { kind, mediaKey, posterKey: poster, loopKey: loop } };
}

export type CardMediaWriteResult =
  | { ok: true; media: ProfileCardMedia | null }
  | { ok: false; status: 400 | 409; error: 'invalid_input' | 'media_missing' | 'media_claimed' };

interface StoredMediaKeys {
  cardMediaKey: string | null;
  cardPosterKey: string | null;
  cardLoopKey: string | null;
}

class MediaClaimedError extends Error {
  constructor() {
    super('media_claimed');
  }
}

class MediaMissingError extends Error {
  constructor() {
    super('media_missing');
  }
}

/** Every given key is a real, non-empty file on disk. */
async function allMediaPresent(keys: readonly (string | null)[]): Promise<boolean> {
  const stats = await Promise.all(keys.map((k) => (k ? statProfileMedia(k) : null)));
  return keys.every((k, i) => !k || (stats[i] !== null && stats[i]!.size > 0));
}

/**
 * Lock MY profile row for the rest of the transaction (creating it first when
 * the member never saved anything). Two concurrent media saves from one account
 * would otherwise both read the same "previous" keys, and the loser's post-commit
 * unlink could delete a file the winner just stored.
 */
async function lockOwnProfile(tx: Prisma.TransactionClient, userId: string): Promise<StoredMediaKeys> {
  await tx.userProfile.upsert({ where: { userId }, create: { userId }, update: {} });
  const rows = await tx.$queryRaw<StoredMediaKeys[]>`
    SELECT "cardMediaKey", "cardPosterKey", "cardLoopKey"
    FROM "UserProfile" WHERE "userId" = ${userId} FOR UPDATE`;
  return rows[0] ?? { cardMediaKey: null, cardPosterKey: null, cardLoopKey: null };
}

/**
 * Unlink files a save just dereferenced — but only keys NO profile row still
 * points at (a re-save of the same key, or a racing save that re-claimed it).
 */
async function unlinkIfUnreferenced(keys: readonly (string | null)[]): Promise<void> {
  const candidates = [...new Set(keys.filter((k): k is string => !!k))];
  if (candidates.length === 0) return;
  const stillUsed = await prisma.userProfile.findMany({
    where: {
      OR: [
        { cardMediaKey: { in: candidates } },
        { cardPosterKey: { in: candidates } },
        { cardLoopKey: { in: candidates } },
      ],
    },
    select: { cardMediaKey: true, cardPosterKey: true, cardLoopKey: true },
  });
  const used = new Set(stillUsed.flatMap((r) => [r.cardMediaKey, r.cardPosterKey, r.cardLoopKey]));
  await deleteProfileMediaFiles(candidates.filter((k) => !used.has(k)));
}

/** Pure: which previously stored keys the new set no longer references. */
export function droppedMediaKeys(prev: StoredMediaKeys, next: StoredMediaKeys): string[] {
  const keep = new Set([next.cardMediaKey, next.cardPosterKey, next.cardLoopKey].filter(Boolean));
  return [prev.cardMediaKey, prev.cardPosterKey, prev.cardLoopKey].filter(
    (k): k is string => !!k && !keep.has(k),
  );
}

type AttachResult = { ok: true } | { ok: false; error: 'media_missing' | 'media_claimed' };

/**
 * THE attach transaction, shared by PUT /api/me/profile/media and the clip
 * route: under MY row lock, re-stat every key (the sweep unlinks under the same
 * lock), refuse keys another profile holds (read + the @unique backstop), write
 * the keys together with `clip` — the segment a clip was cut from, or NULL for
 * anything else, so a stored range can never describe media it did not produce
 * — and after the commit unlink whatever the previous keys no longer reference
 * (an original that stays attached is never among them).
 */
async function attachOwnCardMedia(
  userId: string,
  kind: 'image' | 'video',
  next: StoredMediaKeys,
  clip: StoredClip | null,
): Promise<AttachResult> {
  const keys = [next.cardMediaKey, next.cardPosterKey, next.cardLoopKey].filter((k): k is string => !!k);
  let prev: StoredMediaKeys;
  try {
    prev = await prisma.$transaction(async (tx) => {
      const locked = await lockOwnProfile(tx, userId);
      // The abandoned-upload sweep unlinks under this same lock, so a key it
      // reclaimed a moment ago must not be attached as a missing file.
      if (!(await allMediaPresent(keys))) throw new MediaMissingError();
      // The owner tag already restricts keys to the caller's own uploads; this
      // read (backstopped by the three @unique columns, P2002 below) keeps the
      // old guarantee for legacy rows and any race the tag cannot see.
      const claimed = await tx.userProfile.findFirst({
        where: {
          userId: { not: userId },
          OR: [
            { cardMediaKey: { in: keys } },
            { cardPosterKey: { in: keys } },
            { cardLoopKey: { in: keys } },
          ],
        },
        select: { userId: true },
      });
      if (claimed) throw new MediaClaimedError();
      await tx.userProfile.update({
        where: { userId },
        data: {
          cardMediaKind: kind,
          ...next,
          cardMediaClip: clip ? (clip as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
      return locked;
    });
  } catch (e) {
    if (e instanceof MediaClaimedError) return { ok: false, error: 'media_claimed' };
    if (e instanceof MediaMissingError) return { ok: false, error: 'media_missing' };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: 'media_claimed' };
    }
    throw e;
  }
  await unlinkIfUnreferenced(droppedMediaKeys(prev, next));
  return { ok: true };
}

/** Apply PUT /api/me/profile/media. Clears any stored clip range (this media was not cut by the clip route). */
export async function setOwnCardMedia(userId: string, body: unknown): Promise<CardMediaWriteResult> {
  const parsed = parseCardMediaInput(body, ownerTagFor(userId));
  if (!parsed.ok) return { ok: false, status: 400, error: 'invalid_input' };
  const { kind, mediaKey, posterKey, loopKey } = parsed.input;

  // Every echoed key must be a real, non-empty file — the upload response is
  // the only honest source of keys, but nothing stops a client inventing one.
  // Checked again under the row lock (attachOwnCardMedia).
  if (!(await allMediaPresent([mediaKey, posterKey, loopKey]))) {
    return { ok: false, status: 400, error: 'media_missing' };
  }
  // A card never plays a video original, so a video with neither a generated
  // loop nor a poster would attach as nothing visible (decideCardMedia ⇒ null).
  if (kind === 'video' && !posterKey && !loopKey) return { ok: false, status: 400, error: 'media_missing' };

  const attached = await attachOwnCardMedia(
    userId,
    kind,
    { cardMediaKey: mediaKey, cardPosterKey: posterKey, cardLoopKey: loopKey },
    null,
  );
  if (!attached.ok) {
    return attached.error === 'media_claimed'
      ? { ok: false, status: 409, error: 'media_claimed' }
      : { ok: false, status: 400, error: 'media_missing' };
  }
  return {
    ok: true,
    media: await resolveCardMedia({ kind, media: mediaKey, poster: posterKey, loop: loopKey }),
  };
}

/** Apply DELETE /api/me/profile/media — clear the keys (and the clip range), then unlink the files. */
export async function clearOwnCardMedia(userId: string): Promise<CardMediaWriteResult> {
  const prev = await prisma.$transaction(async (tx) => {
    const locked = await lockOwnProfile(tx, userId);
    await tx.userProfile.update({
      where: { userId },
      data: {
        cardMediaKind: null,
        cardMediaKey: null,
        cardPosterKey: null,
        cardLoopKey: null,
        cardMediaClip: Prisma.DbNull,
      },
    });
    return locked;
  });
  await unlinkIfUnreferenced(droppedMediaKeys(prev, { cardMediaKey: null, cardPosterKey: null, cardLoopKey: null }));
  return { ok: true, media: null };
}

// ─── POST /api/me/profile/media/clip ────────────────────────────────────────

export interface CardClipInput {
  videoKey: string;
  start: number;
  end: number;
  /** Requested cover frame (source seconds); undefined ⇒ normalizeCover's default. */
  cover: number | undefined;
}

export type CardClipInputResult = { ok: true; input: CardClipInput } | { ok: false; error: 'invalid_input' };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Pure SHAPE check of a clip request: a `video/` key minted for `ownerTag`
 * (the caller's own upload — the same binding PUT enforces) and finite numbers.
 * Range CONTENT is not judged here: it is clamped against the probed duration
 * by clip-shared's normalizeClipRange, exactly as the trimmer clamps it.
 */
export function parseCardClipInput(body: unknown, ownerTag: string): CardClipInputResult {
  const bad = { ok: false, error: 'invalid_input' } as const;
  if (!isPlainObject(body)) return bad;
  const { videoKey, start, end, cover } = body;
  if (!isValidProfileMediaKey(videoKey, 'video') || !isProfileMediaKeyTaggedFor(videoKey, ownerTag)) return bad;
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) return bad;
  if (cover !== undefined && cover !== null && !isFiniteNumber(cover)) return bad;
  return { ok: true, input: { videoKey, start, end, cover: isFiniteNumber(cover) ? cover : undefined } };
}

/**
 * Pure: request range + the REAL source duration → the clip to render and store,
 * or null when no valid range exists (no duration, a range that is not numbers).
 * One function so the stored `cardMediaClip` is exactly what parseStoredClip
 * reads back — the trimmer reopens on the very range that was cut.
 */
export function planCardClip(
  input: Pick<CardClipInput, 'start' | 'end' | 'cover'>,
  durationSec: number,
): StoredClip | null {
  const range = normalizeClipRange(input, durationSec, {
    maxLength: PROFILE_CLIP_MAX_SECONDS,
    minLength: CLIP_MIN_LENGTH_DEFAULT,
  });
  if (!range) return null;
  return parseStoredClip({ ...range, cover: normalizeCover(input.cover, range), duration: durationSec });
}

export type CardClipResult =
  | { ok: true; media: ProfileCardMedia | null; clip: StoredClip }
  | {
      ok: false;
      status: 400 | 404 | 409 | 500 | 501 | 503;
      error:
        | 'invalid_input'
        | 'media_missing'
        | 'media_claimed'
        | 'clip_in_progress'
        | 'ffmpeg_unavailable'
        | 'media_busy'
        | 'clip_failed';
      /** Seconds, for a `retry-after` header (503 media_busy, 409 clip_in_progress). */
      retryAfter?: number;
    };

/** Seconds a client should wait before retrying while its own previous clip is still rendering. */
export const CLIP_IN_PROGRESS_RETRY_AFTER_SEC = 5;

/**
 * Members with a clip request past the cheap refusals — probing, queued for the
 * media slot, rendering or attaching. In-process on purpose (like the rate
 * limiter and the media queue it protects): the queue is per process too, so a
 * second process has its own slot to hold. Every entry is removed in a
 * `finally`, so the set can only hold requests that are actually running.
 */
const clipsInFlight = new Set<string>();

/**
 * Apply POST /api/me/profile/media/clip: cut `[start, end]` of the caller's
 * uploaded original into the card clip + a poster at `cover`, then attach
 * video + poster + clip and store the range — ONE step for the editor.
 *
 * Order is cheapest-refusal first: shape/owner (400) → file on disk (404) →
 * tools on the box (501, the editor's cue to fall back to poster-only) → this
 * member already has a clip in flight (409 clip_in_progress) → real duration +
 * range (400) → render in one media-queue slot (503 busy / 500) → the shared
 * attach transaction (404 if the original vanished meanwhile — e.g. a DELETE
 * raced the render — 409 media_claimed if claimed). A refused attach unlinks the
 * fresh clip + poster; a re-cut unlinks the previous clip + poster after the
 * commit and keeps the original, which stays referenced.
 *
 * One render per member at a time: the media-queue slot is shared with every
 * domain's remux, and the per-minute rate limit alone let one account chain
 * renders back to back (each up to ~175 s of the slot and two cores).
 */
export async function clipOwnCardVideo(userId: string, body: unknown): Promise<CardClipResult> {
  const ownerTag = ownerTagFor(userId);
  const parsed = parseCardClipInput(body, ownerTag);
  if (!parsed.ok) return { ok: false, status: 400, error: 'invalid_input' };
  const { videoKey } = parsed.input;

  const source = await statProfileMedia(videoKey);
  if (!source || source.size <= 0) return { ok: false, status: 404, error: 'media_missing' };

  if (!(await profileClipToolsAvailable())) return { ok: false, status: 501, error: 'ffmpeg_unavailable' };

  // Claimed synchronously right after the check — no await in between, so two
  // concurrent requests from one member can never both get past it.
  if (clipsInFlight.has(userId)) {
    return { ok: false, status: 409, error: 'clip_in_progress', retryAfter: CLIP_IN_PROGRESS_RETRY_AFTER_SEC };
  }
  clipsInFlight.add(userId);
  try {
    return await probeRenderAttach(userId, ownerTag, parsed.input);
  } finally {
    clipsInFlight.delete(userId);
  }
}

async function probeRenderAttach(userId: string, ownerTag: string, input: CardClipInput): Promise<CardClipResult> {
  const { videoKey } = input;
  // The client's duration is never trusted: a range is clamped against what the
  // file really holds, so `end` past the source (or past 30 s from `start`) is
  // cut back rather than rendered as a frozen tail. "What it holds" is the
  // PICTURE: the clip is video-only, so an audio track running past the last
  // frame must not stretch the range into a tail with nothing to encode.
  const probe = await probeProfileVideo(videoKey);
  if (!probe || !probe.hasVideo) return { ok: false, status: 400, error: 'invalid_input' };
  const clip = planCardClip(input, videoTimelineSec(probe));
  if (!clip) return { ok: false, status: 400, error: 'invalid_input' };

  const rendered = await renderProfileCardClip(videoKey, ownerTag, clip, probe.fps);
  if (!rendered.ok) {
    return rendered.reason === 'busy'
      ? { ok: false, status: 503, error: 'media_busy', retryAfter: PROFILE_CLIP_RETRY_AFTER_SEC }
      : { ok: false, status: 500, error: 'clip_failed' };
  }

  const { loopKey, posterKey } = rendered;
  let attached: AttachResult;
  try {
    attached = await attachOwnCardMedia(
      userId,
      'video',
      { cardMediaKey: videoKey, cardPosterKey: posterKey, cardLoopKey: loopKey },
      clip,
    );
  } catch (e) {
    await deleteProfileMediaFiles([loopKey, posterKey]);
    throw e;
  }
  if (!attached.ok) {
    await deleteProfileMediaFiles([loopKey, posterKey]);
    return attached.error === 'media_claimed'
      ? { ok: false, status: 409, error: 'media_claimed' }
      : { ok: false, status: 404, error: 'media_missing' };
  }
  return {
    ok: true,
    media: await resolveCardMedia({ kind: 'video', media: videoKey, poster: posterKey, loop: loopKey }),
    clip,
  };
}

// ─── Abandoned-upload sweep ─────────────────────────────────────────────────

/** Pure: which stale entries may go — `.tmp` leftovers always, keys only when no profile references them. */
export function planOrphanSweep(
  entries: readonly OwnProfileMediaEntry[],
  referenced: ReadonlySet<string>,
): OwnProfileMediaEntry[] {
  return entries.filter((e) => e.key === null || !referenced.has(e.key));
}

/** One sweep per member per process per this long — the folder listing is not free, uploads come in bursts. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_MEMO_MAX = 10_000;
const lastSweepAt = new Map<string, number>();

/**
 * Reclaim the caller's OWN card media uploads that were never attached (older
 * than PROFILE_UPLOAD_ORPHAN_AGE_MS, owner tag = theirs, referenced by no
 * UserProfile), plus their stale `.tmp` leftovers. Fired best-effort from the
 * upload and remove routes; bounded (card-media-storage's scan/file caps, and at
 * most once per member per SWEEP_INTERVAL_MS per process). NEVER throws — a
 * sweep failure must not fail the request that triggered it. Returns the number
 * of files unlinked.
 *
 * The reference check and the unlink run under the member's profile row lock —
 * the same lock setOwnCardMedia attaches under (and re-stats inside) — so a key
 * is never unlinked between an attach's check and its commit.
 */
export async function sweepOwnUnattachedCardMedia(userId: string, now: number = Date.now()): Promise<number> {
  try {
    const last = lastSweepAt.get(userId);
    if (last !== undefined && now - last < SWEEP_INTERVAL_MS) return 0;
    if (lastSweepAt.size >= SWEEP_MEMO_MAX) lastSweepAt.clear();
    lastSweepAt.set(userId, now);

    const entries = await listStaleOwnProfileMedia(ownerTagFor(userId), { now });
    if (entries.length === 0) return 0;
    return await prisma.$transaction(
      async (tx) => {
        await lockOwnProfile(tx, userId);
        const keys = entries.map((e) => e.key).filter((k): k is string => !!k);
        const rows = keys.length
          ? await tx.userProfile.findMany({
              where: {
                OR: [{ cardMediaKey: { in: keys } }, { cardPosterKey: { in: keys } }, { cardLoopKey: { in: keys } }],
              },
              select: { cardMediaKey: true, cardPosterKey: true, cardLoopKey: true },
            })
          : [];
        const referenced = new Set(
          rows.flatMap((r) => [r.cardMediaKey, r.cardPosterKey, r.cardLoopKey]).filter((k): k is string => !!k),
        );
        const doomed = planOrphanSweep(entries, referenced);
        await deleteOwnProfileMediaEntries(doomed);
        return doomed.length;
      },
      // A busy pool must not turn a background sweep into a thrown maxWait.
      { maxWait: 10_000, timeout: 15_000 },
    );
  } catch {
    return 0;
  }
}
