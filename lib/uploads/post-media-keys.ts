// 讨论区 attachment keys, limits and URLs — the CLIENT-SAFE half of the post
// media contract (lib/uploads/post-media-storage.ts is the disk half and pulls
// in node:fs). Import-free apart from lib/files/file-types, so the upload
// route, the media route, resolveMedia (lib/discussion-media.ts), MediaPicker
// and PostMediaGallery all read ONE copy of:
//
//   - the storage-key shapes. `file/<nanoid>.<ext>` takes ANY file now (owner
//     decision 2026-09: json / py / zip / an extension-less Makefile …), so its
//     extension part is `SAFE_KEY_EXT_PATTERN` — the SAME source `safeKeyExt`
//     writes with. The writer and every reader move in lockstep: a key the
//     storage can produce that a validator rejects would make a topic edit
//     unsaveable, and (had resolveMedia ever filtered instead of refusing) drop
//     the row and unlink the file. tests/discussion-media.test.ts walks every
//     writer output through every reader.
//   - `video/<nanoid>.(mp4|webm|mov)` stays strict — a video is only ever what
//     plays inline.
//   - the per-kind count limits and byte caps (the picker pre-checks with the
//     same numbers the server enforces).
//
// Images are NOT here: they ride the shared editor image stack
// (`images/<nanoid>.<ext>`, lib/uploads/image-storage.ts) and keep its key shape.

import { INLINE_VIDEO_EXTS, INLINE_VIDEO_MIMES, SAFE_KEY_EXT_PATTERN, extFromMime, lastExtOfName, safeKeyExt } from '@/lib/files/file-types';

export type PostMediaUploadKind = 'video' | 'file';

// ── Limits ───────────────────────────────────────────────────────────────────

/** Card layout: an image gallery, ONE video (uploaded or linked), a short attachment list. */
export const MAX_POST_IMAGES = 9;
export const MAX_POST_VIDEOS = 1;
export const MAX_POST_FILES = 4;
/** Everything the picker can hold at once — the zod array cap (resolveMedia enforces the per-kind split). */
export const MAX_POST_MEDIA_ITEMS = MAX_POST_IMAGES + MAX_POST_VIDEOS + MAX_POST_FILES;

// Generous safety caps (NOT a UX limit) — tune to your disk budget. Member
// post videos are deliberately far below the admin video-board cap (5 GB).
export const MAX_POST_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB
export const MAX_POST_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

// ── Keys ─────────────────────────────────────────────────────────────────────

const VIDEO_EXT_GROUP = `(?:${Array.from(INLINE_VIDEO_EXTS).join('|')})`;

/** Any stored post-media key (what the media route will serve). `video/abc.mp4.tmp.mp4` remux temps never match: the id part has no dots. */
export const POST_MEDIA_KEY_RE = new RegExp(`^(video|file)\\/[A-Za-z0-9_-]+\\.${SAFE_KEY_EXT_PATTERN}$`);
/** A `file` attachment key — any extension `safeKeyExt` can write. */
export const POST_FILE_KEY_RE = new RegExp(`^file\\/[A-Za-z0-9_-]+\\.${SAFE_KEY_EXT_PATTERN}$`);
/** An uploaded `video` key — only the inline-playable containers. */
export const POST_VIDEO_KEY_RE = new RegExp(`^video\\/[A-Za-z0-9_-]+\\.${VIDEO_EXT_GROUP}$`);
/** An editor-image key (lib/uploads/image-storage.ts writes jpg/png/webp/avif/gif). Unchanged. */
export const POST_IMAGE_KEY_RE = /^images\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/;

/** Shape check for a key echoed back by a client or taken from a URL. */
export function isValidPostMediaKey(key: string, kind?: PostMediaUploadKind): boolean {
  if (typeof key !== 'string') return false;
  if (kind === 'video') return POST_VIDEO_KEY_RE.test(key);
  if (kind === 'file') return POST_FILE_KEY_RE.test(key);
  return POST_MEDIA_KEY_RE.test(key);
}

/**
 * The upload route's video admit list: exactly the three inline-playable
 * containers. Read from lib/files/file-types (`INLINE_VIDEO_MIMES` and its
 * MIME → extension table) rather than a local copy, so the MIME a post video is
 * admitted under and the extension its key is written with cannot drift from
 * what the media route serves inline.
 */
export function isAllowedPostVideoType(type: string): boolean {
  return INLINE_VIDEO_MIMES.has(type);
}

/**
 * The extension a NEW key carries. `video`: the MIME's container (the route
 * only admits the three video types), else the name's when it is one of them,
 * else mp4. `file`: `safeKeyExt` — the name's extension when it is
 * `[a-z0-9]{1,10}`, else the MIME hint's, else `bin`. Either way the result
 * satisfies the matching key regex, so a hostile filename can never store
 * `../`, uppercase or an empty extension. How the key is SERVED is a separate
 * decision (lib/uploads/serve.ts): an `.html` key is plain text, downloaded.
 */
export function postMediaExtFor(kind: PostMediaUploadKind, contentType: string, filename: string): string {
  if (kind === 'file') return safeKeyExt(filename, contentType);
  const fromType = extFromMime(contentType);
  if (INLINE_VIDEO_EXTS.has(fromType)) return fromType;
  const fromName = lastExtOfName(filename);
  return INLINE_VIDEO_EXTS.has(fromName) ? fromName : 'mp4';
}

/** Root-relative URL the player / viewer uses (basePath applied at render via withBasePath). */
export function postMediaPublicUrl(key: string): string {
  return `/api/discussion/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

const PUBLIC_PREFIX = '/api/discussion/media/';

/** Inverse of postMediaPublicUrl — the storage key behind a stored URL, or null for anything else. */
export function postMediaKeyFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(PUBLIC_PREFIX)) return null;
  let key: string;
  try {
    key = url.slice(PUBLIC_PREFIX.length).split('?')[0].split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  return POST_MEDIA_KEY_RE.test(key) ? key : null;
}
