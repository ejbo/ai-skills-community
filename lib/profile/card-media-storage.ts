// 名片媒体 — LOCAL DISK adapter for the photo / short video a member puts on
// their 名片 (POST /api/profile/media/upload → PUT /api/me/profile/media →
// GET /api/profile/media/[...key]).
//
// Storage: `<uploads root>/profile-card/<key>`, key = `image|video|poster|loop/
// <ownerTag>-<nanoid>.<ext>` (shape: PROFILE_MEDIA_KEY_RE in lib/profile/shared.ts).
// It deliberately rides the EXISTING uploads root so the `/_uploads/` nginx
// handoff (MEDIA_X_ACCEL_REDIRECT) already covers it — a new root would serve
// empty bodies on every box that has the flag on until someone pasted a new
// internal location. Paths go through image-storage's traversal guard.
//
// What is PUBLIC is decided by the serving route, not by the disk: a card photo,
// a poster and a generated hover loop are served only while an active member's
// profile references them; the uploaded VIDEO ORIGINAL is never served (the card
// promises an 8-second muted loop — the original has full length, audio and the
// phone's container metadata). See profileMediaServeTarget.
//
// Keys are BOUND TO THEIR UPLOADER without a ledger table: the id part starts
// with an HMAC tag of the uploader's user id (AUTH_SECRET), so PUT /api/me/
// profile/media can refuse a key minted for anyone else — including a key its
// owner just released. That is the only env this module reads; the tests mock
// `@/lib/env`, every other helper here stays pure.
//
// ffmpeg work (hover loop + server poster) copies the house contract from
// lib/votes/storage.ts: best-effort, NEVER throws, no ffmpeg / no queue slot ⇒
// null, `.tmp` then rename, a sanity cap on our own output. The helpers are
// private copies because every existing one is hard-wired to its own root.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { env } from '@/lib/env';
import { tryRunMediaJob } from '@/lib/uploads/job-queue';
import { openLazyFileBody, uploadFileAbsPath, uploadXAccelUri } from '@/lib/uploads/image-storage';
import {
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_LOOP_SECONDS,
  PROFILE_MEDIA_KINDS,
  PROFILE_POSTER_MAX_BYTES,
  PROFILE_VIDEO_MAX_BYTES,
  isValidProfileMediaKey,
  type ProfileMediaKind,
} from '@/lib/profile/shared';

/** Sub-folder of the uploads root. Part of the nginx-visible path — never rename. */
export const PROFILE_MEDIA_DIR = 'profile-card';

// ─── Upload kinds / types ───────────────────────────────────────────────────

/** What a client may upload. `loop` is server-generated only — no request can select it. */
export const PROFILE_UPLOAD_KINDS = ['image', 'video', 'poster'] as const;
export type ProfileUploadKind = (typeof PROFILE_UPLOAD_KINDS)[number];

export function isProfileUploadKind(v: unknown): v is ProfileUploadKind {
  return typeof v === 'string' && (PROFILE_UPLOAD_KINDS as readonly string[]).includes(v);
}

// No AVIF: its EXIF/XMP live in ISOBMFF items this module does not rewrite, so
// an AVIF card photo would be published with its GPS intact. The settings UI
// re-encodes every photo to WebP/JPEG in the browser before uploading, so only a
// non-UI client ever sends one — and it is refused (400 unsupported_type), also
// when AVIF bytes arrive under another image type (stripImageMetadata sniffs).
// Legacy stored `.avif` keys still serve with the right type (CONTENT_TYPES).
/** The image MIME types a card photo / poster upload accepts — the route's advertised allowlist. */
export const PROFILE_UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The video MIME types a card video upload accepts. */
export const PROFILE_UPLOAD_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const IMAGE_EXTS = new Set(['jpg', 'png', 'webp', 'gif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);

// Browsers occasionally send no type (or octet-stream) for a real .webm/.mov;
// only then does the filename's extension get a say — and only from the same
// closed set, so a name can never pick an extension the serving side would
// label as something else.
const GENERIC_TYPES = new Set(['', 'application/octet-stream']);

/**
 * The extension to store an upload under, or null when the declared type is not
 * acceptable for that kind (⇒ 400 unsupported_type). svg / html are never
 * reachable: neither map nor the extension sets contain them.
 */
export function profileMediaExtFor(kind: ProfileUploadKind, contentType: string, filename = ''): string | null {
  const type = contentType.split(';')[0].trim().toLowerCase();
  const isVideo = kind === 'video';
  const fromType = (isVideo ? VIDEO_TYPES : IMAGE_TYPES)[type];
  if (fromType) return fromType;
  if (!GENERIC_TYPES.has(type)) return null;
  const m = /\.([a-z0-9]{1,5})$/i.exec(filename.trim());
  const raw = m ? m[1].toLowerCase() : '';
  const ext = raw === 'jpeg' ? 'jpg' : raw === 'm4v' ? 'mp4' : raw;
  return (isVideo ? VIDEO_EXTS : IMAGE_EXTS).has(ext) ? ext : null;
}

/** Product cap per upload kind (the route additionally clamps with MAX_UPLOAD_SAFETY_BYTES). */
export function profileUploadMaxBytes(kind: ProfileUploadKind): number {
  if (kind === 'video') return PROFILE_VIDEO_MAX_BYTES;
  if (kind === 'poster') return PROFILE_POSTER_MAX_BYTES;
  return PROFILE_IMAGE_MAX_BYTES;
}

// ─── Owner tag (key ↔ uploader binding) ─────────────────────────────────────

/** Characters of base64url(HMAC) at the head of a key's id. 60 bits — unforgeable without AUTH_SECRET. */
export const PROFILE_MEDIA_OWNER_TAG_LEN = 10;

/** Pure: the tag every key minted for `userId` starts with. */
export function profileMediaOwnerTag(userId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`profile-card-media:${userId}`)
    .digest('base64url')
    .slice(0, PROFILE_MEDIA_OWNER_TAG_LEN);
}

/** The tag for a user under this deploy's AUTH_SECRET. Server-only. */
export function ownerTagFor(userId: string): string {
  return profileMediaOwnerTag(userId, env.AUTH_SECRET);
}

/**
 * A fresh unguessable key carrying its uploader's tag, e.g.
 * `video/Ab3dE_9xYz-V1StGXR8_Z5jdHi6B-myT.mp4` (id = 10 + 1 + 21 = 32 chars,
 * inside PROFILE_MEDIA_KEY_RE's {8,40}).
 */
export function newProfileMediaKey(kind: ProfileMediaKind, ext: string, ownerTag: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(ownerTag) || ownerTag.length !== PROFILE_MEDIA_OWNER_TAG_LEN) {
    throw new Error('invalid_owner_tag');
  }
  return `${kind}/${ownerTag}-${nanoid()}.${ext}`;
}

/** The owner tag inside a key, or null for a malformed / pre-tag (legacy) key. */
export function profileMediaKeyTag(key: unknown): string | null {
  if (!isValidProfileMediaKey(key)) return null;
  const id = key.slice(key.indexOf('/') + 1, key.lastIndexOf('.'));
  if (id.length <= PROFILE_MEDIA_OWNER_TAG_LEN + 1 || id[PROFILE_MEDIA_OWNER_TAG_LEN] !== '-') return null;
  return id.slice(0, PROFILE_MEDIA_OWNER_TAG_LEN);
}

/** Pure, constant-time: was this key minted under `ownerTag`? Legacy untagged keys never match. */
export function isProfileMediaKeyTaggedFor(key: unknown, ownerTag: string): boolean {
  const tag = profileMediaKeyTag(key);
  if (tag === null) return false;
  const a = Buffer.from(tag);
  const b = Buffer.from(ownerTag);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Server-only: was this key uploaded by `userId`? */
export function isProfileMediaKeyOwnedBy(key: unknown, userId: string): boolean {
  return isProfileMediaKeyTaggedFor(key, ownerTagFor(userId));
}

// ─── Keys → paths / types / URIs ────────────────────────────────────────────

/**
 * Absolute path for a card media key, or null. The SHAPE check runs first, so
 * nothing outside `profile-card/{image,video,poster,loop}/` — the editor's
 * `images/`, `stickers/`, a `../` walk — is ever resolvable through this module.
 */
export function profileMediaAbsPath(key: string): string | null {
  if (!isValidProfileMediaKey(key)) return null;
  return uploadFileAbsPath(`${PROFILE_MEDIA_DIR}/${key}`);
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/** Media-aware content type (image-storage's map knows images only). */
export function profileMediaContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** nginx internal URI — the existing `/_uploads/` location aliases the uploads root. */
export function profileMediaXAccelUri(key: string): string {
  return uploadXAccelUri(`${PROFILE_MEDIA_DIR}/${key}`);
}

export type ProfileMediaServeTarget =
  | { column: 'cardMediaKey'; kind: 'image' }
  | { column: 'cardPosterKey'; kind: 'video' }
  | { column: 'cardLoopKey'; kind: 'video' };

/**
 * Which UserProfile column (and card media kind) must reference a key before
 * the public route may serve it — null ⇒ never servable. `video/` originals
 * are null on purpose: a card only ever plays the generated loop and shows the
 * poster, so the full-length, with-audio upload has no public URL at all.
 */
export function profileMediaServeTarget(key: unknown): ProfileMediaServeTarget | null {
  if (!isValidProfileMediaKey(key)) return null;
  switch (key.slice(0, key.indexOf('/'))) {
    case 'image':
      return { column: 'cardMediaKey', kind: 'image' };
    case 'poster':
      return { column: 'cardPosterKey', kind: 'video' };
    case 'loop':
      return { column: 'cardLoopKey', kind: 'video' };
    default:
      return null;
  }
}

// ─── HTTP Range ─────────────────────────────────────────────────────────────

export type ByteRange =
  | { type: 'none' }
  | { type: 'range'; start: number; end: number }
  | { type: 'unsatisfiable' };

/**
 * One `Range: bytes=…` header against a file of `size` bytes (RFC 9110 §14).
 *
 *   bytes=a-b  → a..min(b, size-1)       (a > b is invalid ⇒ ignored)
 *   bytes=a-   → a..size-1
 *   bytes=-n   → the LAST n bytes         (n = 0 ⇒ unsatisfiable)
 *   a ≥ size   → unsatisfiable (416)
 *
 * The suffix form is the one the house routes get wrong: their shared
 * `/^bytes=(\d*)-(\d*)$/` reads `bytes=-500` as 0-500. Anything malformed, and
 * multi-range requests, are IGNORED (a full 200) as the RFC allows — a player
 * never depends on a 416 for a header it could not have meant.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (!header || !Number.isSafeInteger(size) || size <= 0) return { type: 'none' };
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return { type: 'none' };
  const [, a, b] = m;
  if (!a && !b) return { type: 'none' };

  if (!a) {
    const n = Number(b);
    if (!Number.isSafeInteger(n)) return { type: 'none' };
    if (n === 0) return { type: 'unsatisfiable' };
    return { type: 'range', start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(a);
  if (!Number.isSafeInteger(start)) return { type: 'none' };
  let end = b ? Number(b) : size - 1;
  if (!Number.isSafeInteger(end)) end = size - 1;
  if (b && end < start) return { type: 'none' };
  if (start >= size) return { type: 'unsatisfiable' };
  return { type: 'range', start, end: Math.min(end, size - 1) };
}

// ─── Image metadata (EXIF / XMP / IPTC) ─────────────────────────────────────
//
// A card photo is shown to anonymous visitors, and a phone JPEG copied to a
// desktop still carries GPS coordinates, the device serial and a timestamp.
// So the stored bytes are rewritten BEFORE a key is handed out: every metadata
// segment/chunk is dropped at the container level — no re-encode, so no quality
// loss and no ffmpeg dependency. The one thing kept is the EXIF Orientation
// value (rebuilt as a 26-byte TIFF with that single tag), because browsers
// rotate by it and dropping it would turn every portrait phone photo sideways.
// Colour-relevant data (JPEG ICC/Adobe, PNG iCCP/sRGB/gAMA) is kept.
//
// Formats are sniffed from the BYTES, not the declared type (a browser decodes a
// PNG served as image/jpeg just fine). JPEG, PNG, WebP and GIF are rewritten.
// AVIF is recognised but REFUSED: its EXIF lives in ISOBMFF items this module
// cannot strip, and a pass-through published the uploader's GPS. Anything else
// is not an image and is refused too.

export type SniffedImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function ascii(b: Uint8Array, at: number, n: number): string {
  if (at < 0 || at + n > b.length) return '';
  let s = '';
  for (let i = at; i < at + n; i++) s += String.fromCharCode(b[i]);
  return s;
}

function hasBytes(b: Uint8Array, at: number, bytes: readonly number[]): boolean {
  if (at + bytes.length > b.length) return false;
  return bytes.every((v, i) => b[at + i] === v);
}

const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function isAvifBrand(b: Uint8Array): boolean {
  if (ascii(b, 4, 4) !== 'ftyp') return false;
  const boxEnd = Math.min(u32be(b, 0), b.length);
  const brands = [ascii(b, 8, 4)];
  for (let o = 16; o + 4 <= boxEnd; o += 4) brands.push(ascii(b, o, 4));
  return brands.includes('avif') || brands.includes('avis');
}

/** What the bytes actually are (null = not an image format a card accepts). */
export function sniffImageFormat(b: Uint8Array): SniffedImageFormat | null {
  if (hasBytes(b, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (hasBytes(b, 0, PNG_SIGNATURE)) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  const gif = ascii(b, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  if (b.length >= 16 && isAvifBrand(b)) return 'avif';
  return null;
}

/** EXIF Orientation (1–8) from a TIFF block (IFD0 only), or null. */
export function readTiffOrientation(t: Uint8Array): number | null {
  if (t.length < 8) return null;
  const le = t[0] === 0x49 && t[1] === 0x49;
  const be = t[0] === 0x4d && t[1] === 0x4d;
  if (!le && !be) return null;
  const u16 = (o: number) => (o >= 0 && o + 2 <= t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : -1);
  const u32 = (o: number) => (o >= 0 && o + 4 <= t.length ? (le ? u32le(t, o) : u32be(t, o)) : -1);
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  const count = u16(ifd);
  if (count <= 0) return null;
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) !== 0x0112) continue;
    const type = u16(e + 2);
    const v = type === 3 ? u16(e + 8) : type === 4 ? u32(e + 8) : -1;
    return v >= 1 && v <= 8 ? v : null;
  }
  return null;
}

/** A TIFF block holding ONLY an Orientation tag (big-endian, 26 bytes). */
export function orientationOnlyTiff(orientation: number): Uint8Array {
  return Uint8Array.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

const tiffOf = (exif: Uint8Array) => (hasBytes(exif, 0, EXIF_PREFIX) ? exif.subarray(EXIF_PREFIX.length) : exif);

// JPEG ────────────────────────────────────────────────────────────────────────

/** APPn / COM segments worth keeping: JFIF (layout), ICC (colour), Adobe (colour transform). */
function keepJpegSegment(marker: number, payload: Uint8Array): boolean {
  if (marker === 0xfe) return false; // COM
  if (marker < 0xe0 || marker > 0xef) return true; // DQT, DHT, SOFn, DRI, …
  if (marker === 0xe0) return ascii(payload, 0, 5) === 'JFIF\0';
  if (marker === 0xe2) return ascii(payload, 0, 12) === 'ICC_PROFILE\0';
  if (marker === 0xee) return ascii(payload, 0, 5) === 'Adobe';
  return false; // APP1 Exif/XMP, APP13 IPTC, MPF, Ducky, …
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let exifAt = 1; // after SOI, or after a leading JFIF APP0
  let orientation = 0;
  let i = 2;
  while (i < b.length) {
    // Like libjpeg, skip extraneous bytes before a marker instead of failing.
    if (b[i] !== 0xff) {
      const next = b.indexOf(0xff, i);
      if (next < 0) break;
      i = next;
    }
    while (i + 1 < b.length && b[i + 1] === 0xff) i++; // fill bytes
    if (i + 1 >= b.length) break;
    const m = b[i + 1];
    if (m === 0x00) {
      i += 2;
      continue;
    }
    if (m === 0xd9) {
      // EOI — everything after it (MPF secondary images with their own EXIF, trailers) is dropped.
      out.push(b.subarray(i, i + 2));
      break;
    }
    if (m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) {
      out.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    const segEnd = i + 2 + len;
    if (m === 0xda) {
      // SOS header, then entropy-coded data up to the next real marker.
      let j = segEnd;
      for (;;) {
        const ff = b.indexOf(0xff, j);
        if (ff < 0 || ff + 1 >= b.length) {
          j = b.length;
          break;
        }
        const n = b[ff + 1];
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) j = ff + 2;
        else if (n === 0xff) j = ff + 1;
        else {
          j = ff;
          break;
        }
      }
      out.push(b.subarray(i, j));
      i = j;
      continue;
    }
    const payload = b.subarray(i + 4, segEnd);
    if (keepJpegSegment(m, payload)) {
      out.push(b.subarray(i, segEnd));
      if (m === 0xe0 && out.length === 2) exifAt = 2;
    } else if (m === 0xe1 && !orientation && hasBytes(payload, 0, EXIF_PREFIX)) {
      orientation = readTiffOrientation(payload.subarray(EXIF_PREFIX.length)) ?? 0;
    }
    i = segEnd;
  }
  if (orientation > 1) {
    const tiff = orientationOnlyTiff(orientation);
    const len = 2 + EXIF_PREFIX.length + tiff.length;
    out.splice(exifAt, 0, Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...EXIF_PREFIX, ...tiff]));
  }
  return Buffer.concat(out);
}

// PNG ─────────────────────────────────────────────────────────────────────────

const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

let crcTable: Uint32Array | null = null;
function crc32(parts: readonly Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = crcTable[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([head.subarray(4), data]), 0);
  return Buffer.concat([head, data, crc]);
}

function stripPng(b: Uint8Array): Uint8Array | null {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let afterIhdr = -1;
  let orientation = 0;
  let i = 8;
  let sawEnd = false;
  while (i < b.length && !sawEnd) {
    if (i + 12 > b.length) return null;
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (len > 0x7fffffff || end > b.length) return null;
    if (PNG_METADATA_CHUNKS.has(type)) {
      if (type === 'eXIf' && !orientation) orientation = readTiffOrientation(tiffOf(b.subarray(i + 8, i + 8 + len))) ?? 0;
    } else {
      out.push(b.subarray(i, end));
      if (type === 'IHDR') afterIhdr = out.length;
    }
    sawEnd = type === 'IEND';
    i = end;
  }
  if (afterIhdr < 0) return null;
  // eXIf must precede IDAT; right after IHDR always does.
  if (orientation > 1) out.splice(afterIhdr, 0, pngChunk('eXIf', orientationOnlyTiff(orientation)));
  return Buffer.concat(out);
}

// WebP ────────────────────────────────────────────────────────────────────────

const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

function stripWebp(b: Uint8Array): Uint8Array | null {
  const riffEnd = Math.min(8 + u32le(b, 4), b.length);
  const chunks: Uint8Array[] = [];
  let vp8x = -1;
  let orientation = 0;
  let i = 12;
  while (i + 8 <= riffEnd) {
    const fourcc = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    if (i + 8 + size > riffEnd) return null;
    const next = Math.min(i + 8 + size + (size & 1), riffEnd);
    if (fourcc === 'EXIF') {
      if (!orientation) orientation = readTiffOrientation(tiffOf(b.subarray(i + 8, i + 8 + size))) ?? 0;
    } else if (fourcc !== 'XMP ') {
      if (fourcc === 'VP8X') vp8x = chunks.length;
      chunks.push(b.subarray(i, next));
    }
    i = next;
  }
  if (chunks.length === 0) return null;
  const keepExif = orientation > 1 && vp8x >= 0; // EXIF is only legal in the extended format
  if (vp8x >= 0 && chunks[vp8x].length > 8) {
    const copy = Buffer.from(chunks[vp8x]);
    copy[8] = (copy[8] & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG)) | (keepExif ? VP8X_EXIF_FLAG : 0);
    chunks[vp8x] = copy;
  }
  if (keepExif) {
    const tiff = orientationOnlyTiff(orientation);
    const head = Buffer.alloc(8);
    head.write('EXIF', 0, 'latin1');
    head.writeUInt32LE(tiff.length, 4);
    chunks.push(Buffer.concat([head, tiff])); // 26 bytes — even, no pad
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

// GIF ─────────────────────────────────────────────────────────────────────────

const GIF_KEEP_APPS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0']); // loop count

function stripGif(b: Uint8Array): Uint8Array | null {
  if (b.length < 13) return null;
  const skipSubBlocks = (at: number): number => {
    let o = at;
    while (o < b.length) {
      const n = b[o];
      if (n === 0) return o + 1;
      o += 1 + n;
    }
    return -1;
  };
  let i = 13;
  if (b[10] & 0x80) i += 3 * 2 ** ((b[10] & 0x07) + 1); // global colour table
  if (i > b.length) return null;
  const out: Uint8Array[] = [b.subarray(0, i)];
  while (i < b.length) {
    const intro = b[i];
    if (intro === 0x3b) break; // trailer
    if (intro === 0x21) {
      if (i + 2 > b.length) return null;
      const label = b[i + 1];
      const end = skipSubBlocks(i + 2);
      if (end < 0) return null;
      const app = label === 0xff ? ascii(b, i + 3, 11) : '';
      const keep = label === 0xf9 || label === 0x01 || (label === 0xff && GIF_KEEP_APPS.has(app));
      if (keep) out.push(b.subarray(i, end)); // drops comments, XMP DataXMP, …
      i = end;
      continue;
    }
    if (intro === 0x2c) {
      if (i + 11 > b.length) return null;
      let o = i + 10;
      if (b[i + 9] & 0x80) o += 3 * 2 ** ((b[i + 9] & 0x07) + 1); // local colour table
      const end = skipSubBlocks(o + 1); // +1: LZW minimum code size
      if (end < 0) return null;
      out.push(b.subarray(i, end));
      i = end;
      continue;
    }
    break; // unknown block: a decoder stops here too
  }
  out.push(Uint8Array.from([0x3b]));
  return Buffer.concat(out);
}

export type ImageMetadataStrip =
  | { ok: true; format: SniffedImageFormat; bytes: Uint8Array; changed: boolean }
  | { ok: false };

/**
 * Pure: the image with its metadata removed (orientation kept). `ok: false` when
 * the bytes are not a well-formed image of an accepted format — AVIF included,
 * whatever type it was declared as (its metadata cannot be removed here).
 */
export function stripImageMetadata(bytes: Uint8Array): ImageMetadataStrip {
  const format = sniffImageFormat(bytes);
  if (!format || format === 'avif') return { ok: false };
  const out =
    format === 'jpeg' ? stripJpeg(bytes) : format === 'png' ? stripPng(bytes) : format === 'webp' ? stripWebp(bytes) : stripGif(bytes);
  if (!out || out.length === 0) return { ok: false };
  const view = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength); // no copy of a 10 MB photo
  const changed = out.length !== bytes.length || Buffer.compare(view(out), view(bytes)) !== 0;
  return { ok: true, format, bytes: changed ? out : bytes, changed };
}

// ─── Disk I/O ───────────────────────────────────────────────────────────────

/**
 * Resolve when the stream emits `event`; reject on 'error' or a 'close' that
 * comes first. A bare `once('drain')` never settles once the stream has errored
 * (ENOSPC/EIO destroy it and 'drain' never fires), which hung the upload request
 * and left its partial file on disk.
 */
function settleWritable(ws: fs.WriteStream, event: 'drain' | 'finish'): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ws.off(event, onOk);
      ws.off('error', onError);
      ws.off('close', onClose);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onClose = () => {
      cleanup();
      reject(ws.errored ?? new Error('write_closed'));
    };
    if (ws.errored || ws.destroyed) {
      reject(ws.errored ?? new Error('write_closed'));
      return;
    }
    ws.once(event, onOk);
    ws.once('error', onError);
    ws.once('close', onClose);
  });
}

/**
 * Stream a raw request body to disk under a byte cap. Returns bytes written.
 * Throws `file_too_large` / `empty_body` / `invalid_key` / the write error; the
 * partial file is always removed on failure (a 0-byte file would be a
 * servable-but-broken key).
 */
export async function saveProfileMediaStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const full = profileMediaAbsPath(key);
  if (!full) throw new Error('invalid_key');
  await fsp.mkdir(path.dirname(full), { recursive: true });

  const ws = fs.createWriteStream(full);
  // Always listening: an 'error' between two awaits must not become an
  // uncaughtException — settleWritable / the errored check below surface it.
  ws.on('error', () => undefined);
  let written = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      written += value.byteLength;
      if (written > maxBytes) throw new Error('file_too_large');
      if (ws.errored || ws.destroyed) throw ws.errored ?? new Error('write_closed');
      if (!ws.write(value)) await settleWritable(ws, 'drain');
    }
    const finished = settleWritable(ws, 'finish');
    ws.end();
    await finished;
    if (written === 0) throw new Error('empty_body');
    return written;
  } catch (e) {
    reader.cancel().catch(() => undefined);
    await destroyAndClose(ws);
    await fsp.unlink(full).catch(() => undefined);
    throw e;
  }
}

/**
 * Destroy a write stream and wait until its fd is really closed. The open is
 * asynchronous: unlinking right after `destroy()` can run BEFORE the pending
 * open creates the file, which then survives as a 0-byte orphan. Bounded, so a
 * stream that never emits 'close' cannot hang the request either.
 */
async function destroyAndClose(ws: fs.WriteStream): Promise<void> {
  if (!ws.closed) {
    const closed = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    ws.destroy();
    await closed;
  }
}

/**
 * Rewrite a stored `image/` or `poster/` file without its metadata (see the
 * section above) and return its final size. null ⇒ not a well-formed accepted
 * image — the caller refuses the upload and deletes the key. `.tmp` then
 * rename, so a reader never sees a half-written photo. Throws only on I/O failure.
 */
export async function stripStoredImageMetadata(key: string): Promise<number | null> {
  if (!isValidProfileMediaKey(key, 'image') && !isValidProfileMediaKey(key, 'poster')) return null;
  const full = profileMediaAbsPath(key);
  if (!full) return null;
  const result = stripImageMetadata(await fsp.readFile(full));
  if (!result.ok) return null;
  if (!result.changed) return result.bytes.length;
  const tmp = `${full}.tmp`;
  try {
    await fsp.writeFile(tmp, result.bytes);
    await fsp.rename(tmp, full);
  } catch (e) {
    await fsp.unlink(tmp).catch(() => undefined);
    throw e;
  }
  return result.bytes.length;
}

export interface ProfileMediaStat {
  size: number;
  contentType: string;
}

/** Async stat of a stored file; null for a bad key, a missing file or a non-file. */
export async function statProfileMedia(key: string | null | undefined): Promise<ProfileMediaStat | null> {
  if (!key) return null;
  const full = profileMediaAbsPath(key);
  if (!full) return null;
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) return null;
    return { size: st.size, contentType: profileMediaContentType(key) };
  } catch {
    return null;
  }
}

/**
 * A web ReadableStream over bytes start..end (inclusive) of a card media file
 * that opens the file LAZILY — on the first pull — and closes it on EOF, error
 * or cancel. The mechanics (and why a createReadStream body leaked one fd per
 * HEAD) live in image-storage's openLazyFileBody, shared with the public
 * uploads route so the two byte servers cannot drift apart.
 */
export function openProfileMediaBody(key: string, start: number, end: number): ReadableStream<Uint8Array> | null {
  const full = profileMediaAbsPath(key);
  if (!full) return null;
  return openLazyFileBody(full, start, end);
}

/** Best-effort unlink of every given key (missing files and bad keys ignored). */
export async function deleteProfileMediaFiles(keys: readonly (string | null | undefined)[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      if (!key) return;
      const full = profileMediaAbsPath(key);
      if (full) await fsp.unlink(full).catch(() => undefined);
    }),
  );
}

// ─── Abandoned-upload sweep ─────────────────────────────────────────────────
//
// Upload and attach are two requests, so an upload whose attach never happened
// (tab closed mid-flow, a video no loop/poster could be cut for, a non-UI
// client) leaves files nobody references — up to PROFILE_VIDEO_MAX_BYTES each.
// Nothing serves them (the gated route needs an attachment; the public uploads
// route refuses `profile-card/`), but they still fill the volume PostgreSQL
// lives on. The owner tag in every key lets a member's own requests reclaim
// THEIR OWN leftovers without a ledger table: list the four kind folders, keep
// entries minted under the caller's tag and older than the cutoff, and (in
// profile-store.ts) skip anything a UserProfile still references.

/** An upload still unattached after this long is abandoned (the editor attaches seconds after uploading). */
export const PROFILE_UPLOAD_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
/** Directory entries read per kind folder per sweep — keeps one request's work bounded. */
export const PROFILE_SWEEP_MAX_SCAN_PER_DIR = 5_000;
/** Files a single sweep may reclaim; the rest wait for the member's next request. */
export const PROFILE_SWEEP_MAX_FILES = 25;

export interface OwnProfileMediaEntry {
  /** Path under the `profile-card/` folder: the key itself, or a `.tmp` leftover's file name. */
  relPath: string;
  /** The media key for a finished upload; null for a `.tmp` leftover (never referenced by anything). */
  key: string | null;
}

// `<key>.tmp` (stripStoredImageMetadata) and `<key>.tmp.jpg|mp4` (ffmpeg outputs).
const TMP_SUFFIX_RE = /^\.tmp(?:\.[a-z0-9]{1,5})?$/;

/**
 * Pure: one directory entry of `profile-card/<kind>/`, as the sweep sees it —
 * null unless it was minted under `ownerTag` (a finished key of that kind, or a
 * `.tmp` leftover of one). Key ids are base64url, so the first `.` is the
 * extension's and `.tmp` can only be a suffix.
 */
export function classifyOwnProfileMediaEntry(
  kind: ProfileMediaKind,
  name: string,
  ownerTag: string,
): OwnProfileMediaEntry | null {
  if (typeof name !== 'string' || !name.startsWith(`${ownerTag}-`)) return null;
  const tmpAt = name.indexOf('.tmp');
  const key = `${kind}/${tmpAt >= 0 ? name.slice(0, tmpAt) : name}`;
  if (!isProfileMediaKeyTaggedFor(key, ownerTag) || !isValidProfileMediaKey(key, kind)) return null;
  if (tmpAt < 0) return { relPath: key, key };
  return TMP_SUFFIX_RE.test(name.slice(tmpAt)) ? { relPath: `${kind}/${name}`, key: null } : null;
}

/**
 * The caller's own card media files last written before `now - maxAgeMs`.
 * Best-effort and bounded (PROFILE_SWEEP_MAX_SCAN_PER_DIR entries read per
 * folder, PROFILE_SWEEP_MAX_FILES returned); never throws. lstat, so a symlink
 * is never followed or reported.
 */
export async function listStaleOwnProfileMedia(
  ownerTag: string,
  opts: { now?: number; maxAgeMs?: number; maxScanPerDir?: number; maxFiles?: number } = {},
): Promise<OwnProfileMediaEntry[]> {
  const cutoff = (opts.now ?? Date.now()) - (opts.maxAgeMs ?? PROFILE_UPLOAD_ORPHAN_AGE_MS);
  const maxScan = opts.maxScanPerDir ?? PROFILE_SWEEP_MAX_SCAN_PER_DIR;
  const maxFiles = opts.maxFiles ?? PROFILE_SWEEP_MAX_FILES;
  const out: OwnProfileMediaEntry[] = [];
  for (const kind of PROFILE_MEDIA_KINDS) {
    if (out.length >= maxFiles) break;
    const dir = uploadFileAbsPath(`${PROFILE_MEDIA_DIR}/${kind}`);
    if (!dir) continue;
    try {
      const handle = await fsp.opendir(dir);
      let scanned = 0;
      // for-await closes the directory handle on exhaustion, break and throw alike.
      for await (const ent of handle) {
        if (++scanned > maxScan || out.length >= maxFiles) break;
        const entry = classifyOwnProfileMediaEntry(kind, ent.name, ownerTag);
        if (!entry) continue;
        const st = await fsp.lstat(path.join(dir, ent.name)).catch(() => null);
        if (st?.isFile() && st.mtimeMs < cutoff) out.push(entry);
      }
    } catch {
      // A missing folder (nothing of that kind uploaded yet) or an I/O error: skip it.
    }
  }
  return out;
}

/** Best-effort unlink of sweep entries (anything that does not resolve inside `profile-card/` is ignored). */
export async function deleteOwnProfileMediaEntries(entries: readonly OwnProfileMediaEntry[]): Promise<void> {
  const root = uploadFileAbsPath(PROFILE_MEDIA_DIR);
  if (!root) return;
  await Promise.all(
    entries.map(async ({ relPath }) => {
      const full = uploadFileAbsPath(`${PROFILE_MEDIA_DIR}/${relPath}`);
      if (full && full.startsWith(root + path.sep)) await fsp.unlink(full).catch(() => undefined);
    }),
  );
}

// ─── ffmpeg: hover loop + poster ────────────────────────────────────────────

/** Long edge of the generated loop / poster. A card is ≤ 360 CSS px wide, so 720 covers 2× DPR. */
const DERIVED_MAX_EDGE = 720;
/** Sanity bound on OUR OWN loop output (8 s at ≤720 px, CRF 28 lands well under 3 MB). */
const LOOP_MAX_BYTES = 16 * 1024 * 1024;

// Budgets: this runs inside the upload request, which must answer inside nginx's
// proxy_read_timeout 300s. 5 s queue wait + 10 s poster (+ one retry) + 25 s
// loop keeps the worst case near a minute; blowing any budget just means no
// loop / no server poster — the client-captured poster still covers the card.
const JOB_MAX_WAIT_MS = 5_000;
const POSTER_TIMEOUT_MS = 10_000;
const LOOP_TIMEOUT_MS = 25_000;
const DETECT_TIMEOUT_MS = 10_000;
const FFPROBE_TIMEOUT_MS = 10_000;

// Both derivatives are PUBLIC while the original is not, so neither may carry
// the source's container metadata (a phone MOV's ©xyz location, creation time,
// device model): ffmpeg copies global tags into its output unless told not to.
const NO_METADATA = ['-map_metadata', '-1', '-map_chapters', '-1'];

// Fit inside the box keeping aspect, THEN force even sides with a ≥2 clamp —
// libx264 dies on an odd side and `force_original_aspect_ratio=decrease` happily
// produces one (full story in lib/votes/storage.ts#makeVotePreviewClip).
const EVEN_BOX_FILTER =
  `scale='min(${DERIVED_MAX_EDGE},iw)':'min(${DERIVED_MAX_EDGE},ih)':force_original_aspect_ratio=decrease,` +
  `scale='max(2\\,trunc(iw/2)*2)':'max(2\\,trunc(ih/2)*2)'`;
const BOX_FILTER = `scale='min(${DERIVED_MAX_EDGE},iw)':'min(${DERIVED_MAX_EDGE},ih)':force_original_aspect_ratio=decrease`;

let ffmpegProbe: Promise<boolean> | null = null;
function hasFfmpeg(): Promise<boolean> {
  if (!ffmpegProbe) {
    ffmpegProbe = new Promise<boolean>((resolve) => {
      try {
        const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
        // Cached for the life of the process: a hung `-version` must not leave
        // every later upload awaiting a promise that never settles.
        const timer = setTimeout(() => {
          p.kill('SIGKILL');
          resolve(false);
        }, DETECT_TIMEOUT_MS);
        const done = (ok: boolean) => {
          clearTimeout(timer);
          resolve(ok);
        };
        p.on('error', () => done(false));
        p.on('close', (code) => done(code === 0));
      } catch {
        resolve(false);
      }
    });
  }
  return ffmpegProbe;
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const p = spawn('ffmpeg', args, { stdio: 'ignore' });
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        resolve(false);
      }, timeoutMs);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      p.on('error', () => done(false));
      p.on('close', (code) => done(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/** Move a finished `.tmp` output into place when it looks sane; always cleans the tmp. */
async function promoteOutput(tmp: string, out: string, maxBytes: number): Promise<boolean> {
  try {
    const st = await fsp.stat(tmp);
    if (!st.isFile() || st.size === 0 || st.size > maxBytes) throw new Error('bad_output');
    await fsp.rename(tmp, out);
    return true;
  } catch {
    await fsp.unlink(tmp).catch(() => undefined);
    return false;
  }
}

async function makePoster(src: string, ownerTag: string): Promise<string | null> {
  const key = newProfileMediaKey('poster', 'jpg', ownerTag);
  const out = profileMediaAbsPath(key);
  if (!out) return null;
  const tmp = `${out}.tmp.jpg`;
  await fsp.mkdir(path.dirname(out), { recursive: true });
  // 0.5 s skips the black/fade-in first frame most phone clips open with; a
  // clip shorter than that yields nothing, so retry at 0.
  for (const at of ['0.5', '0']) {
    const ok = await runFfmpeg(
      [
        '-y',
        '-ss',
        at,
        '-i',
        src,
        '-map',
        '0:V:0',
        ...NO_METADATA,
        '-frames:v',
        '1',
        '-vf',
        BOX_FILTER,
        '-q:v',
        '3',
        '-update',
        '1',
        tmp,
      ],
      POSTER_TIMEOUT_MS,
    );
    if (ok && (await promoteOutput(tmp, out, PROFILE_POSTER_MAX_BYTES))) return key;
    await fsp.unlink(tmp).catch(() => undefined);
  }
  return null;
}

async function makeLoop(src: string, ownerTag: string): Promise<string | null> {
  const key = newProfileMediaKey('loop', 'mp4', ownerTag);
  const out = profileMediaAbsPath(key);
  if (!out) return null;
  const tmp = `${out}.tmp.mp4`;
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const ok = await runFfmpeg(
    [
      '-y',
      // Input-side seek + duration: only the first PROFILE_LOOP_SECONDS are decoded.
      '-ss',
      '0',
      '-t',
      String(PROFILE_LOOP_SECONDS),
      '-i',
      src,
      '-map',
      '0:V:0', // first non-cover-art video stream
      '-an', // a card loop is always muted
      ...NO_METADATA,
      '-vf',
      EVEN_BOX_FILTER,
      '-r',
      '30', // a 240 fps slow-mo source must not balloon the loop
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart', // first frame on hover, not after the moov atom downloads
      tmp,
    ],
    LOOP_TIMEOUT_MS,
  );
  if (!ok) {
    await fsp.unlink(tmp).catch(() => undefined);
    return null;
  }
  return (await promoteOutput(tmp, out, LOOP_MAX_BYTES)) ? key : null;
}

export interface ProfileVideoDerivatives {
  posterKey: string | null;
  loopKey: string | null;
}

/**
 * Generate the ≤ PROFILE_LOOP_SECONDS muted hover loop and a server poster for
 * an uploaded card video, sharing ONE media-queue slot. Both keys carry
 * `ownerTag` (the uploader's), so they attach like any upload of theirs. NEVER
 * throws; either key may be null (no ffmpeg, queue busy, undecodable source,
 * bad output).
 *
 * The original itself gets no processing (no faststart remux): nothing ever
 * plays it — only these two derivatives are servable.
 */
export async function makeProfileVideoDerivatives(videoKey: string, ownerTag: string): Promise<ProfileVideoDerivatives> {
  const none: ProfileVideoDerivatives = { posterKey: null, loopKey: null };
  try {
    if (!isValidProfileMediaKey(videoKey, 'video')) return none;
    const src = profileMediaAbsPath(videoKey);
    if (!src) return none;
    if (!(await hasFfmpeg())) return none;
    const job = await tryRunMediaJob(async () => {
      const posterKey = await makePoster(src, ownerTag).catch(() => null);
      const loopKey = await makeLoop(src, ownerTag).catch(() => null);
      return { posterKey, loopKey };
    }, JOB_MAX_WAIT_MS);
    return job.ran ? job.value : none;
  } catch {
    return none;
  }
}

/** Duration in seconds (one decimal) via ffprobe; null on any failure. */
export function probeProfileVideoDurationSec(videoKey: string): Promise<number | null> {
  const full = profileMediaAbsPath(videoKey);
  if (!full) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', full], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        resolve(null);
      }, FFPROBE_TIMEOUT_MS);
      let out = '';
      p.stdout.on('data', (d) => {
        out += String(d);
      });
      p.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return resolve(null);
        const sec = Number.parseFloat(out.trim());
        resolve(Number.isFinite(sec) && sec > 0 ? Math.round(sec * 10) / 10 : null);
      });
    } catch {
      resolve(null);
    }
  });
}
