// 随刷短视频 (Shorts) — pure, unit-testable helpers shared by the API routes and
// the client. NO imports at all: 'use client' components (ShortsUploadDialog)
// consume this module, so anything Node-flavored here lands in the browser
// bundle. The AI caption prompt/parser live in lib/video/shorts-caption.ts
// (server-only — its graph reaches yauzl/node:crypto via lib/skill-assist).

// ── Limits ───────────────────────────────────────────────────────────────────
/** Per-file cap for a short's source video (member upload; admin board is 5 GB). */
export const MAX_SHORT_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB
/** Per-file cap for the auto-captured poster frame. */
export const MAX_SHORT_POSTER_BYTES = 10 * 1024 * 1024; // 10 MB
/** Shorts are short: reject sources longer than this (client-probed, clamped). */
export const MAX_SHORT_DURATION_SEC = 300; // 5 min
export const MAX_SHORT_CAPTION_CHARS = 500;
/** Rolling per-user daily upload budget for shorts (separate from 讨论区's). */
export const SHORT_BYTES_PER_DAY = 2 * 1024 * 1024 * 1024; // 2 GB

// ── Storage-key validation ───────────────────────────────────────────────────
// Upload responses hand the client a storage key which it echoes back into
// POST /api/shorts. Keys are `${kind}/${nanoid()}.${ext}` from lib/video/storage
// — re-validate shape server-side so a crafted request can never point a Video
// row at an arbitrary path (ownership is checked separately against reuse).
const SOURCE_KEY_RE = /^source\/[A-Za-z0-9_-]+\.(mp4|webm|mov)$/;
const POSTER_KEY_RE = /^poster\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|avif)$/;

export function isValidShortSourceKey(key: string): boolean {
  return SOURCE_KEY_RE.test(key);
}
export function isValidShortPosterKey(key: string): boolean {
  return POSTER_KEY_RE.test(key);
}

// ── Feed cursors ─────────────────────────────────────────────────────────────
// Same contract as the discussion feed: sort=new pages with an explicit keyset
// cursor `<createdAt ISO>|<id>` (robust when the cursor row is deleted or
// featured between pages — Prisma's native cursor{} silently breaks there);
// sort=hot pages by offset `o:<n>` because the hot ordering shifts as people
// react, so keyset positions are meaningless. Duplicates across hot pages are
// absorbed client-side by an id Set.
export type ShortsSort = 'hot' | 'new';

export function parseShortsSort(value: string | null | undefined): ShortsSort {
  return value === 'new' ? 'new' : 'hot';
}

export function encodeShortsCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

export function decodeShortsCursor(
  raw: string | null | undefined,
): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const sep = raw.indexOf('|');
  if (sep <= 0) return null;
  const createdAt = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

/** Derive the (required) Video.title from a caption: first line, clamped. */
export function shortTitleFromCaption(caption: string): string {
  const firstLine = caption.split(/\r?\n/, 1)[0].trim();
  const title = firstLine.replace(/\s+/g, ' ').slice(0, 60).trim();
  return title || '短视频';
}
