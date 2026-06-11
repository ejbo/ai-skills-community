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

/** A Node read stream for a stored image file (whole file; images don't need Range). */
export function openImageFile(key: string): fs.ReadStream | null {
  const full = uploadFileAbsPath(key);
  if (!full) return null;
  return fs.createReadStream(full);
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
