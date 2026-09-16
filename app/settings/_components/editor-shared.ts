// 设置页编辑器 — the pure half shared by 个人资料 / 名片 / 主页板块.
//
// Import-free apart from the profile contract (lib/profile/shared.ts), so it is
// client-safe AND unit-tested (tests/settings-editors.test.ts). Every rule a
// form applies before it talks to the API lives here, and each one defers to
// the SAME sanitizer the server runs: a form can never show "valid" for a value
// the PUT would silently drop.

import {
  CARD_STYLES,
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_SECTIONS,
  PROFILE_VIDEO_MAX_BYTES,
  parseCardConfig,
  sanitizeInterests,
  sanitizeProfileLink,
  type CardConfig,
  type ProfileLink,
  type ProfileSection,
} from '@/lib/profile/shared';

/** Array move that ignores out-of-range targets (↑ on the first row is a no-op, not a wrap). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Length as the server counts it (code points — a CJK extension char or emoji is ONE). */
export function codePointLength(s: string): number {
  return Array.from(s).length;
}

// ─── 兴趣标签 ────────────────────────────────────────────────────────────

/** Separators a member types between tags: ASCII + fullwidth comma, 顿号, semicolons, newlines. */
const INTEREST_SPLIT_RE = /[,，、;；\n\r]+/;

export function splitInterestInput(raw: string): string[] {
  return raw
    .split(INTEREST_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AddInterestsResult {
  next: string[];
  /** The existing tag a typed value collided with (case-insensitive) — the chip to flash. */
  duplicate: string | null;
  /** true when at least one value was refused because the list is full. */
  full: boolean;
}

/**
 * Append typed tags through `sanitizeInterests` (the server's own rule), and
 * report WHY nothing changed so the input can say so instead of eating the text.
 */
export function addInterests(current: readonly string[], raw: string): AddInterestsResult {
  const pieces = splitInterestInput(raw);
  const base = sanitizeInterests(current);
  if (pieces.length === 0) return { next: base, duplicate: null, full: false };
  const next = sanitizeInterests([...base, ...pieces]);
  const typed = sanitizeInterests(pieces);
  let duplicate: string | null = null;
  for (const piece of typed) {
    const hit = base.find((t) => t.toLowerCase() === piece.toLowerCase());
    if (hit) {
      duplicate = hit;
      break;
    }
  }
  const fresh = typed.filter((p) => !base.some((t) => t.toLowerCase() === p.toLowerCase()));
  return { next, duplicate, full: fresh.length > next.length - base.length };
}

// ─── 外链 ────────────────────────────────────────────────────────────────

export interface LinkRow {
  /** Client-only React key; never sent. */
  id: string;
  label: string;
  url: string;
}

export type LinkRowState = 'empty' | 'valid' | 'invalid';

/** A row with no URL AND no label is a blank line the member never filled — dropped, not an error. */
export function linkRowState(row: Pick<LinkRow, 'label' | 'url'>): LinkRowState {
  if (!row.url.trim() && !row.label.trim()) return 'empty';
  return sanitizeProfileLink({ label: row.label, url: row.url }) ? 'valid' : 'invalid';
}

/** What the PUT receives: sanitized links in row order, plus the ids of rows that block the save. */
export function linksForSave(rows: readonly LinkRow[]): { links: ProfileLink[]; invalidIds: string[] } {
  const links: ProfileLink[] = [];
  const invalidIds: string[] = [];
  for (const row of rows) {
    const state = linkRowState(row);
    if (state === 'empty') continue;
    const link = sanitizeProfileLink({ label: row.label, url: row.url });
    if (!link) invalidIds.push(row.id);
    else links.push(link);
  }
  return { links, invalidIds };
}

// ─── 名片 ────────────────────────────────────────────────────────────────

/** Field-wise equality after both sides went through the parser (so '' vs a stored default never reads as dirty). */
export function cardConfigsEqual(a: unknown, b: unknown): boolean {
  const x = parseCardConfig(a);
  const y = parseCardConfig(b);
  return (Object.keys(x) as (keyof CardConfig)[]).every((k) => x[k] === y[k]);
}

/**
 * 恢复默认外观 — the look goes back to the defaults, the WORDS stay: a member
 * who wrote a status line and a corner label should not lose them to a style reset.
 */
export function resetCardLook(card: CardConfig, defaults: Readonly<CardConfig>): CardConfig {
  return { ...defaults, status: card.status, label: card.label };
}

export function isCardStyle(v: unknown): v is CardConfig['style'] {
  return typeof v === 'string' && (CARD_STYLES as readonly string[]).includes(v);
}

/** Which effect controls apply to a style — the editor renders only those. */
export function cardEffectsFor(style: CardConfig['style']): {
  tilt: boolean;
  pattern: boolean;
  mediaTone: boolean;
  reflective: boolean;
  label: boolean;
} {
  return {
    tilt: style !== 'minimal',
    pattern: style === 'holo',
    mediaTone: style === 'holo',
    reflective: style === 'reflective',
    label: style === 'reflective',
  };
}

/**
 * Declared MIME type → the CARD upload route's canonical extension
 * (profileMediaExtFor's closed maps). No AVIF: the route refuses it (its
 * EXIF/XMP live in ISOBMFF items the server cannot strip), so the card picker
 * does not offer it either — the copy (settings.ce_media_caps, docs) says the same.
 */
const IMAGE_FORMATS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/**
 * 头像 / 主页背景图 (`/api/uploads/image`) still take AVIF: the picked photo is
 * re-encoded to WebP/JPEG in the browser first either way (./strip-image.ts).
 */
const PHOTO_FORMATS: Record<string, string> = { ...IMAGE_FORMATS, 'image/avif': 'avif' };
const VIDEO_FORMATS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
const IMAGE_EXTS = new Set(Object.values(IMAGE_FORMATS));
const PHOTO_EXTS = new Set(Object.values(PHOTO_FORMATS));
const VIDEO_EXTS = new Set(Object.values(VIDEO_FORMATS));
/** Types a browser reports when the OS has no mapping for the extension (a .mov on some Windows setups). */
const GENERIC_TYPES = new Set(['', 'application/octet-stream']);

/** `accept` attribute for the card media picker (the upload route's own allowlist). */
export const CARD_MEDIA_ACCEPT = [...Object.keys(IMAGE_FORMATS), ...Object.keys(VIDEO_FORMATS)].join(',');
/** `accept` for the plain image pickers (头像 / 主页背景图). */
export const IMAGE_ACCEPT = Object.keys(PHOTO_FORMATS).join(',');

export type MediaFormat = { kind: 'image' | 'video'; ext: string };

/** The extension a generic-typed file's NAME claims (jpeg→jpg, m4v→mp4), or ''. */
function nameExt(name: string | undefined): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec((name ?? '').trim());
  const raw = m ? m[1].toLowerCase() : '';
  return raw === 'jpeg' ? 'jpg' : raw === 'm4v' ? 'mp4' : raw;
}

/**
 * What a picked CARD media file IS, by the same rule as the card upload route
 * (`profileMediaExtFor`): the declared type decides; only a GENERIC type lets the
 * file name's extension speak, and only from the same closed set (jpeg→jpg,
 * m4v→mp4). A type outside the allowlist is refused even with a friendly name.
 */
export function mediaFormatOf(file: { type: string; name?: string }): MediaFormat | null {
  const type = file.type.split(';')[0].trim().toLowerCase();
  if (IMAGE_FORMATS[type]) return { kind: 'image', ext: IMAGE_FORMATS[type] };
  if (VIDEO_FORMATS[type]) return { kind: 'video', ext: VIDEO_FORMATS[type] };
  if (!GENERIC_TYPES.has(type)) return null;
  const ext = nameExt(file.name);
  if (IMAGE_EXTS.has(ext)) return { kind: 'image', ext };
  if (VIDEO_EXTS.has(ext)) return { kind: 'video', ext };
  return null;
}

/**
 * The same rule for the 头像 / 主页背景图 pickers, whose route also takes AVIF.
 * Images only — null for anything else.
 */
export function photoFormatOf(file: { type: string; name?: string }): MediaFormat | null {
  const type = file.type.split(';')[0].trim().toLowerCase();
  if (PHOTO_FORMATS[type]) return { kind: 'image', ext: PHOTO_FORMATS[type] };
  if (!GENERIC_TYPES.has(type)) return null;
  const ext = nameExt(file.name);
  return PHOTO_EXTS.has(ext) ? { kind: 'image', ext } : null;
}

export type CardFileCheck =
  | { ok: true; kind: 'image' | 'video'; ext: string; maxBytes: number }
  | { ok: false; error: 'unsupported_type' | 'file_too_large' | 'empty'; kind: 'image' | 'video' | null; maxBytes: number };

/**
 * Client pre-check mirroring the upload route: type allowlist (with the route's
 * extension fallback) + per-kind cap. The server re-checks everything; this only
 * saves a member from uploading 200 MB to learn it was 201.
 */
export function checkCardFile(file: { type: string; size: number; name?: string }): CardFileCheck {
  const format = mediaFormatOf(file);
  if (!format) return { ok: false, error: 'unsupported_type', kind: null, maxBytes: 0 };
  const { kind, ext } = format;
  const maxBytes = kind === 'image' ? PROFILE_IMAGE_MAX_BYTES : PROFILE_VIDEO_MAX_BYTES;
  if (file.size <= 0) return { ok: false, error: 'empty', kind, maxBytes };
  if (file.size > maxBytes) return { ok: false, error: 'file_too_large', kind, maxBytes };
  return { ok: true, kind, ext, maxBytes };
}

// ─── 照片去元数据 (pure half of ./strip-image.ts) ─────────────────────────

/** Longest edge a re-encoded photo keeps — far above any card / banner render size. */
export const STRIP_MAX_EDGE = 2048;

/**
 * Every still photo is re-encoded in the browser before upload (EXIF / GPS never
 * leaves the device, orientation gets baked in). GIF is the exception: re-encoding
 * would freeze its animation, and the format carries no EXIF block.
 */
export function shouldStripImage(ext: string): boolean {
  return ext !== 'gif';
}

/** Scale (w, h) so the long edge is ≤ max — never upscales, integer px, never 0. */
export function fitLongEdge(width: number, height: number, max = STRIP_MAX_EDGE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const k = max / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** File name for the re-encoded upload: same base, extension from the encoder's real output type. */
export function strippedFileName(name: string, mime: string): string {
  const base = name.replace(/\.[^./\\]*$/, '').trim() || 'photo';
  return `${base}.${mime === 'image/webp' ? 'webp' : 'jpg'}`;
}

/** Whole megabytes for hints ("10 MB"). */
export function bytesToMb(n: number): number {
  return Math.round(n / (1024 * 1024));
}

/**
 * Error code → `settings` message key. `context` says which request failed, because
 * the same code means different things to the member: a 429 from the upload is
 * 「上传太频繁」, from the clip route (POST /api/me/profile/media/clip) it is not an
 * upload at all. Unknown codes fall back to the generic failure OF THAT REQUEST.
 */
export function cardMediaErrorKey(code: string, context: 'upload' | 'clip' = 'upload'): string {
  if (context === 'clip') {
    switch (code) {
      case 'rate_limited':
        return 'ce_err_clip_rate_limited';
      case 'clip_in_progress':
        return 'ce_err_clip_in_progress';
      case 'media_busy':
        return 'ce_err_media_busy';
      case 'media_missing':
        return 'ce_err_media_missing';
      case 'invalid_input':
      case 'payload_too_large':
        return 'ce_err_clip_invalid';
      case 'media_claimed':
        return 'ce_err_claimed';
      case 'unauthenticated':
        return 'ce_err_unauthenticated';
      case 'network_error':
        return 'ce_err_network';
      default:
        return 'ce_err_clip_failed';
    }
  }
  switch (code) {
    case 'unsupported_type':
    case 'bad_kind':
      return 'ce_err_unsupported';
    case 'file_too_large':
      return 'ce_err_too_large';
    case 'empty':
      return 'ce_err_empty';
    case 'rate_limited':
      return 'ce_err_rate_limited';
    case 'disk_full':
      return 'ce_err_disk_full';
    case 'media_claimed':
      return 'ce_err_claimed';
    case 'unauthenticated':
      return 'ce_err_unauthenticated';
    case 'network_error':
      return 'ce_err_network';
    default:
      return 'ce_err_upload_failed';
  }
}

// ─── 名片视频截取 ─────────────────────────────────────────────────────────

/**
 * What the open trimmer does after POST /api/me/profile/media/clip failed:
 *  - `poster_fallback` — the box cannot cut this clip: attach the original with a
 *    browser-captured poster at the chosen cover (the card shows only that cover).
 *    501 ffmpeg_unavailable always; 500 clip_failed only for a NEW upload — there
 *    the member is otherwise left with nothing at all, while a re-trim still has
 *    its working clip and can pick another segment.
 *  - `close` — retrying the same request cannot succeed (the key is not a usable
 *    original of this member, the original is gone, the session ended): close the
 *    dialog and say why.
 *  - `retry` — transient (server busy, a clip already rendering, rate limit,
 *    network) or fixable by picking another segment: keep the dialog and the
 *    selection, offer 重试.
 */
export type ClipFailureAction = 'poster_fallback' | 'close' | 'retry';

export function clipFailureAction(code: string, status: number, mode: 'new' | 'retrim'): ClipFailureAction {
  if (status === 501 || code === 'ffmpeg_unavailable') return 'poster_fallback';
  if (code === 'clip_failed' && mode === 'new') return 'poster_fallback';
  switch (code) {
    case 'invalid_input':
    case 'payload_too_large':
    case 'media_missing':
    case 'media_claimed':
    case 'unauthenticated':
      return 'close';
    default:
      return 'retry';
  }
}

// ─── 主页板块 ────────────────────────────────────────────────────────────

export interface LayoutDraft {
  order: ProfileSection[];
  hidden: ProfileSection[];
}

export function layoutsEqual(a: LayoutDraft, b: LayoutDraft): boolean {
  if (a.order.length !== b.order.length || a.hidden.length !== b.hidden.length) return false;
  if (!a.order.every((s, i) => s === b.order[i])) return false;
  return a.hidden.every((s) => b.hidden.includes(s));
}

/** Flip one section's 对外展示; `hidden` stays in catalog order (the parser's canonical form). */
export function toggleSectionHidden(layout: LayoutDraft, section: ProfileSection): LayoutDraft {
  const has = layout.hidden.includes(section);
  const nextHidden = has ? layout.hidden.filter((s) => s !== section) : [...layout.hidden, section];
  return { order: layout.order, hidden: PROFILE_SECTIONS.filter((s) => nextHidden.includes(s)) };
}
