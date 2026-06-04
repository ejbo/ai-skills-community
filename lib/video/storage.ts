// Video object storage — LOCAL DISK adapter. Self-hosted: the browser uploads
// the file directly to our own route (POST /api/videos/upload), which streams it
// to disk under LOCAL_STORAGE_DIR/videos. Playback streams back from disk with
// HTTP Range support (GET /api/videos/file/[...key]). No cloud, no Vercel Blob.
//
// External -> internal roadmap: to use an internal S3-compatible store later,
// swap saveVideoStream/openVideoRange/deleteVideoFile for an S3 implementation;
// the routes/components only depend on the functions exported here.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { env } from '@/lib/env';

const VIDEO_ROOT = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR, 'videos');

const VIDEO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export function isAllowedVideoType(type: string): boolean {
  return type in VIDEO_EXT;
}
export function isAllowedImageType(type: string): boolean {
  return type in IMAGE_EXT;
}

/** Pick a file extension from the content type, falling back to the filename. */
export function extFor(kind: 'source' | 'poster', contentType: string, filename: string): string {
  const fromType = (kind === 'poster' ? IMAGE_EXT : VIDEO_EXT)[contentType];
  if (fromType) return fromType;
  const m = filename.match(/\.([a-zA-Z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : kind === 'poster' ? 'jpg' : 'mp4';
}

/** A fresh unguessable storage key, e.g. "source/V1StGXR8.mp4". */
export function newVideoKey(kind: 'source' | 'poster', ext: string): string {
  return `${kind}/${nanoid()}.${ext}`;
}

/** Absolute path for a key, guarding against path traversal (returns null if unsafe). */
export function videoFileAbsPath(key: string): string | null {
  const full = path.resolve(VIDEO_ROOT, key);
  if (full !== VIDEO_ROOT && !full.startsWith(VIDEO_ROOT + path.sep)) return null;
  return full;
}

/** Root-relative URL the player/img uses (basePath applied at render via withBasePath). */
export function videoPublicUrl(key: string): string {
  return `/api/videos/file/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function contentTypeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Stream a web ReadableStream (the raw request body) to disk, enforcing a max
 * byte cap. Cleans up the partial file on error. Returns bytes written.
 */
export async function saveVideoStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const full = videoFileAbsPath(key);
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

export interface VideoFileStat {
  size: number;
  contentType: string;
}

export function statVideoFile(key: string): VideoFileStat | null {
  const full = videoFileAbsPath(key);
  if (!full) return null;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) return null;
    return { size: st.size, contentType: contentTypeForKey(key) };
  } catch {
    return null;
  }
}

/** A Node read stream for a (possibly partial) byte range of a stored file. */
export function openVideoRange(key: string, start: number, end: number): fs.ReadStream | null {
  const full = videoFileAbsPath(key);
  if (!full) return null;
  return fs.createReadStream(full, { start, end });
}

export async function deleteVideoFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  const full = videoFileAbsPath(key);
  if (!full) return;
  await fsp.unlink(full).catch(() => undefined);
}
