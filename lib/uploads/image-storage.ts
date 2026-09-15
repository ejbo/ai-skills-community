// Generic image upload storage — LOCAL DISK adapter, shared by the rich-text
// editor (skill overview, video description, comments/reviews). Mirrors the
// video storage model (lib/video/storage.ts) but is NOT admin-scoped and lives
// under its own root so any logged-in author can attach images.
//
// External -> internal roadmap: swap saveImageStream/openImageFile/statImageFile
// for an S3 implementation; routes/components only depend on what's exported here.
//
// Note: reads process.env.LOCAL_STORAGE_DIR directly (not the validated
// `@/lib/env`) so the pure helpers — especially the path-traversal guard — stay
// unit-testable without the full app env. The default matches lib/env.ts.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || './storage', 'uploads');

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

/** Generous safety cap (NOT a UX limit) — tune to your disk budget. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// Extensions we will ever write/serve. The filename fallback in imageExtFor is
// clamped to this set so a bogus filename can never make us store an arbitrary
// (e.g. .html / .svg) extension, regardless of which caller invokes it.
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);

export function isAllowedImageType(type: string): boolean {
  return type in IMAGE_EXT;
}

/** Pick a file extension from the content type, falling back to the filename. */
export function imageExtFor(contentType: string, filename: string): string {
  const fromType = IMAGE_EXT[contentType];
  if (fromType) return fromType;
  const m = filename.match(/\.([a-zA-Z0-9]{1,5})$/);
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'jpeg') return 'jpg';
  return ALLOWED_EXT.has(ext) ? ext : 'png';
}

/** A fresh unguessable storage key, e.g. "images/V1StGXR8.png". */
export function newImageKey(ext: string): string {
  return `images/${nanoid()}.${ext}`;
}

/**
 * A fresh sticker key, e.g. "stickers/V1StGXR8.gif" — same uploads root (so the
 * public /api/uploads/[...key] route serves it for free), separate namespace
 * because the `/api/uploads/stickers/` URL prefix is the render-time signal
 * that an embedded image is a 表情包 (see lib/stickers.ts).
 */
export function newStickerKey(ext: string): string {
  return `stickers/${nanoid()}.${ext}`;
}

/** Absolute path for a key, guarding against path traversal (returns null if unsafe). */
export function uploadFileAbsPath(key: string): string | null {
  const full = path.resolve(UPLOAD_ROOT, key);
  if (full !== UPLOAD_ROOT && !full.startsWith(UPLOAD_ROOT + path.sep)) return null;
  return full;
}

/** Root-relative URL the <img> uses (basePath applied at render via withBasePath). */
export function imagePublicUrl(key: string): string {
  return `/api/uploads/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function contentTypeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Stream a web ReadableStream (the raw request body) to disk, enforcing a max
 * byte cap. Cleans up the partial file on error. Returns bytes written.
 */
export async function saveImageStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const full = uploadFileAbsPath(key);
  if (!full) throw new Error('invalid_key');
  await fsp.mkdir(path.dirname(full), { recursive: true });

  const ws = fs.createWriteStream(full);
  let written = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      written += value.byteLength;
      if (written > maxBytes) throw new Error('file_too_large');
      if (!ws.write(value)) {
        await new Promise<void>((resolve) => ws.once('drain', resolve));
      }
    }
    await new Promise<void>((resolve, reject) =>
      ws.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );
    return written;
  } catch (e) {
    ws.destroy();
    await fsp.unlink(full).catch(() => undefined);
    throw e;
  }
}

export interface ImageFileStat {
  size: number;
  contentType: string;
}

export function statImageFile(key: string): ImageFileStat | null {
  const full = uploadFileAbsPath(key);
  if (!full) return null;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) return null;
    return { size: st.size, contentType: contentTypeForKey(key) };
  } catch {
    return null;
  }
}

/**
 * Async variant — a busy feed page pulls dozens of images through the serving
 * route, and every synchronous statSync there blocks the single JS thread.
 * Keep the sync export: /api/stickers/add validates a key with it off the hot path.
 */
export async function statImageFileAsync(key: string): Promise<ImageFileStat | null> {
  const full = uploadFileAbsPath(key);
  if (!full) return null;
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) return null;
    return { size: st.size, contentType: contentTypeForKey(key) };
  } catch {
    return null;
  }
}

/**
 * nginx internal URI for X-Accel-Redirect offload (paired with
 * `location /_uploads/`, aliased to this module's UPLOAD_ROOT). Pure string
 * work — deliberately no @/lib/env import here (see the header note).
 */
export function uploadXAccelUri(key: string): string {
  return `/_uploads/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** A Node read stream for a stored image file (whole file; images don't need Range). */
export function openImageFile(key: string): fs.ReadStream | null {
  const full = uploadFileAbsPath(key);
  if (!full) return null;
  return fs.createReadStream(full);
}

/**
 * Top-level folders of the uploads root that the PUBLIC `/api/uploads/[...key]`
 * route must never serve. `profile-card/` holds 名片 media, which rides this root
 * only for the `/_uploads/` nginx handoff: whether a card file is public is
 * decided by `/api/profile/media/[...key]` (attached to an active member's card,
 * never a video original) — served from here, every never-attached upload and
 * every original would be an anonymous, year-cached download.
 */
export const GATED_UPLOAD_NAMESPACES: readonly string[] = ['profile-card'];

/**
 * May the public uploads route serve this key? It must resolve inside the
 * uploads root (the traversal guard) and its FIRST resolved segment must not be
 * a gated namespace. Decided on the RESOLVED path, not the raw string, so
 * `images/../profile-card/…`, `./profile-card/…` and a case variant (a macOS
 * dev volume is case-insensitive) are refused as well.
 */
export function isPublicUploadKey(key: string): boolean {
  if (typeof key !== 'string' || !key || key.includes('\0')) return false;
  const full = uploadFileAbsPath(key);
  if (!full || full === UPLOAD_ROOT) return false;
  const first = path.relative(UPLOAD_ROOT, full).split(path.sep)[0]?.toLowerCase() ?? '';
  return !!first && !GATED_UPLOAD_NAMESPACES.includes(first);
}

const LAZY_READ_CHUNK_BYTES = 256 * 1024;

/**
 * A web ReadableStream over bytes start..end (inclusive) of an ABSOLUTE path
 * (already through a traversal guard) that opens the file LAZILY — on the first
 * pull — and closes it on EOF, error or cancel. null for an invalid range.
 *
 * Why not `Readable.toWeb(fs.createReadStream())`: createReadStream opens the fd
 * at construction, and a body nobody reads is never destroyed — Next answers a
 * HEAD from the GET handler without cancelling the body, and a client that
 * disconnects before piping starts does the same. Each such request pinned one
 * fd until the process ran out (EMFILE takes the whole site down).
 * `highWaterMark: 0` is load-bearing: with the default of 1 the stream pulls
 * once on construction, which would open the file before anyone reads.
 *
 * The response length is already on the wire when bytes flow, so a file that
 * SHRANK fails the body (`short_read`) instead of ending it early, and one that
 * grew is cut at `end`.
 */
export function openLazyFileBody(fullPath: string, start: number, end: number): ReadableStream<Uint8Array> | null {
  if (!fullPath || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
  let handle: fsp.FileHandle | null = null;
  let done = false;
  let pos = start;
  const release = async () => {
    done = true;
    const h = handle;
    handle = null;
    await h?.close().catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (done) return;
          if (!handle) {
            const opened = await fsp.open(fullPath, 'r');
            if (done) {
              // cancelled while the open was in flight
              await opened.close().catch(() => undefined);
              return;
            }
            handle = opened;
          }
          const want = Math.min(LAZY_READ_CHUNK_BYTES, end - pos + 1);
          const chunk = new Uint8Array(want);
          const { bytesRead } = await handle.read(chunk, 0, want, pos);
          if (bytesRead <= 0) throw new Error('short_read');
          pos += bytesRead;
          controller.enqueue(bytesRead === want ? chunk : chunk.subarray(0, bytesRead));
          if (pos > end) {
            await release();
            controller.close();
          }
        } catch (e) {
          await release();
          controller.error(e);
        }
      },
      async cancel() {
        await release();
      },
    },
    { highWaterMark: 0 },
  );
}

/** The whole stored upload (`size` from its stat) as a lazy body; null for a bad key or an empty file. */
export function openImageFileBody(key: string, size: number): ReadableStream<Uint8Array> | null {
  const full = uploadFileAbsPath(key);
  if (!full || !Number.isSafeInteger(size) || size <= 0) return null;
  return openLazyFileBody(full, 0, size - 1);
}

/**
 * Delete a stored image (best-effort; ignores missing files). Mirrors
 * deleteVideoFile so callers can reclaim disk when an image is dereferenced.
 * Not yet wired to *Md edits/deletes — orphan reclamation is a follow-up; see
 * docs/superpowers/specs/2026-06-08-rich-text-editor-design.md.
 */
export async function deleteImageFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  const full = uploadFileAbsPath(key);
  if (!full) return;
  await fsp.unlink(full).catch(() => undefined);
}
