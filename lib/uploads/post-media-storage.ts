// Discussion post media — LOCAL DISK adapter. Mirrors the video storage model
// (lib/video/storage.ts) under its own root: members attach videos and document
// files (PDF/PPT/Word) to feed posts; the browser POSTs the raw file to
// /api/discussion/upload, which streams it to disk under
// LOCAL_STORAGE_DIR/post-media/<kind>/. Playback/download streams back through
// GET /api/discussion/media/[...key] (login + unguessable key, Range support).
// Post images reuse the existing editor image stack (/api/uploads/image).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';

const MEDIA_ROOT = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORAGE_DIR || './storage',
  'post-media',
);

const VIDEO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const FILE_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

// Generous safety caps (NOT a UX limit) — tune to your disk budget. Member
// post videos are deliberately far below the admin video-board cap (5 GB).
export const MAX_POST_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB
export const MAX_POST_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

// Extensions we will ever write/serve. The filename fallback in postMediaExtFor
// is clamped to this set so a bogus filename can never make us store an
// arbitrary (e.g. .html / .svg) extension.
const ALLOWED_EXT = new Set(['mp4', 'webm', 'mov', 'pdf', 'ppt', 'pptx', 'doc', 'docx']);

export type PostMediaUploadKind = 'video' | 'file';

export function isAllowedPostVideoType(type: string): boolean {
  return type in VIDEO_EXT;
}

export function isAllowedPostFileType(type: string): boolean {
  return type in FILE_EXT;
}

/** Pick a file extension from the content type, falling back to the filename. */
export function postMediaExtFor(
  kind: PostMediaUploadKind,
  contentType: string,
  filename: string,
): string {
  const fromType = (kind === 'video' ? VIDEO_EXT : FILE_EXT)[contentType];
  if (fromType) return fromType;
  const m = filename.match(/\.([a-zA-Z0-9]{1,5})$/);
  const fromName = m ? m[1].toLowerCase() : '';
  if (ALLOWED_EXT.has(fromName)) return fromName;
  return kind === 'video' ? 'mp4' : 'pdf';
}

/** A fresh unguessable storage key, e.g. "video/V1StGXR8.mp4". */
export function newPostMediaKey(kind: PostMediaUploadKind, ext: string): string {
  return `${kind}/${nanoid()}.${ext}`;
}

/** Absolute path for a key, guarding against path traversal (returns null if unsafe). */
export function postMediaAbsPath(key: string): string | null {
  const full = path.resolve(MEDIA_ROOT, key);
  if (full !== MEDIA_ROOT && !full.startsWith(MEDIA_ROOT + path.sep)) return null;
  return full;
}

/** Root-relative URL the player/link uses (basePath applied at render via withBasePath). */
export function postMediaPublicUrl(key: string): string {
  return `/api/discussion/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function postMediaContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Stream a web ReadableStream (the raw request body) to disk, enforcing a max
 * byte cap. Cleans up the partial file on error. Returns bytes written.
 */
export async function savePostMediaStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const full = postMediaAbsPath(key);
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
    // A 0-byte "upload" would store a servable-but-broken key — reject it.
    if (written === 0) throw new Error('empty_body');
    return written;
  } catch (e) {
    ws.destroy();
    await fsp.unlink(full).catch(() => undefined);
    throw e;
  }
}

export interface PostMediaStat {
  size: number;
  contentType: string;
}

export async function statPostMediaAsync(key: string): Promise<PostMediaStat | null> {
  const full = postMediaAbsPath(key);
  if (!full) return null;
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) return null;
    return { size: st.size, contentType: postMediaContentType(key) };
  } catch {
    return null;
  }
}

/** A Node read stream for a (possibly partial) byte range of a stored file. */
export function openPostMediaRange(key: string, start: number, end: number): fs.ReadStream | null {
  const full = postMediaAbsPath(key);
  if (!full) return null;
  return fs.createReadStream(full, { start, end });
}

export async function deletePostMediaFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  const full = postMediaAbsPath(key);
  if (!full) return;
  await fsp.unlink(full).catch(() => undefined);
}

// ─── faststart remux (MP4/MOV moov-atom relocation) ─────────────────────────
// Same contract as lib/video/storage.ts: stream-copy the container with the
// moov atom moved to the front so playback starts before the download ends.
// Best-effort by design — NEVER throws, no-op without ffmpeg.

const FASTSTART_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

let ffmpegProbe: Promise<boolean> | null = null;
function hasFfmpeg(): Promise<boolean> {
  if (!ffmpegProbe) {
    ffmpegProbe = new Promise<boolean>((resolve) => {
      try {
        const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
        p.on('error', () => resolve(false)); // ENOENT — not installed
        p.on('close', (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
  }
  return ffmpegProbe;
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

export async function faststartRemuxPostMedia(key: string, size: number): Promise<boolean> {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'mp4' && ext !== 'mov') return false;
  if (size > FASTSTART_MAX_BYTES) return false;
  const full = postMediaAbsPath(key);
  if (!full) return false;
  if (!(await hasFfmpeg())) return false;

  const tmp = `${full}.tmp.${ext}`; // matching ext ⇒ ffmpeg keeps the same container
  const ok = await runFfmpeg(['-y', '-i', full, '-map', '0', '-c', 'copy', '-movflags', '+faststart', tmp]);
  if (!ok) {
    await fsp.unlink(tmp).catch(() => undefined);
    return false;
  }
  try {
    await fsp.rename(tmp, full); // atomic replace on the same filesystem
    return true;
  } catch {
    await fsp.unlink(tmp).catch(() => undefined);
    return false;
  }
}
