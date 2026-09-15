// Discussion post media — LOCAL DISK adapter. Mirrors the video storage model
// (lib/video/storage.ts) under its own root: members attach videos and files
// (ANY type since 2026-09 — source code, JSON, archives, Office, PDF…) to feed
// posts and forum topics; the browser POSTs the raw file to
// /api/discussion/upload, which streams it to disk under
// LOCAL_STORAGE_DIR/post-media/<kind>/. Bytes stream back through
// GET /api/discussion/media/[...key] (login + unguessable key, Range support),
// whose headers are decided by lib/uploads/serve.ts from the KEY's extension.
// Post images reuse the existing editor image stack (/api/uploads/image).
//
// Key shapes, limits and the extension rule live in the client-safe
// lib/uploads/post-media-keys.ts (re-exported here for the server callers), so
// the picker, resolveMedia and both routes can never disagree about what a
// valid key looks like.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { contentTypeFor, keyExtOf } from '@/lib/files/file-types';
import { tryRunMediaJob } from './job-queue';
import type { PostMediaUploadKind } from './post-media-keys';

export {
  MAX_POST_FILE_BYTES,
  MAX_POST_VIDEO_BYTES,
  isAllowedPostVideoType,
  isValidPostMediaKey,
  postMediaExtFor,
  postMediaKeyFromUrl,
  postMediaPublicUrl,
  type PostMediaUploadKind,
} from './post-media-keys';

const MEDIA_ROOT = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORAGE_DIR || './storage',
  'post-media',
);

/** A fresh unguessable storage key, e.g. "video/V1StGXR8.mp4" or "file/V1StGXR8.py". */
export function newPostMediaKey(kind: PostMediaUploadKind, ext: string): string {
  return `${kind}/${nanoid()}.${ext}`;
}

/** Absolute path for a key, guarding against path traversal (returns null if unsafe). */
export function postMediaAbsPath(key: string): string | null {
  const full = path.resolve(MEDIA_ROOT, key);
  if (full !== MEDIA_ROOT && !full.startsWith(MEDIA_ROOT + path.sep)) return null;
  return full;
}

/**
 * Content-Type a stored key is served with — the shared file-types table: the
 * real type only for the inline media set (mp4/webm/mov, raster images, audio,
 * PDF), `text/plain` for every text-like file (html / svg / js included),
 * octet-stream for the rest.
 */
export function postMediaContentType(key: string): string {
  return contentTypeFor(keyExtOf(key));
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

/**
 * nginx internal URI for X-Accel-Redirect offload (paired with
 * `location /_postmedia/`, aliased to this module's MEDIA_ROOT).
 */
export function postMediaXAccelUri(key: string): string {
  return `/_postmedia/${key.split('/').map(encodeURIComponent).join('/')}`;
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
// Best-effort by design — NEVER throws, no-op without ffmpeg, and no-op when
// the shared media queue can't give the remux a slot inside
// MEDIA_JOB_MAX_WAIT_MS (see lib/uploads/job-queue.ts).

const FASTSTART_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// Hard caps on the child processes. A `-c copy` remux of a multi-GB file is
// minutes at worst; past these the child is stuck rather than slow, and killing
// it is strictly better than holding a media-job slot (and the uploader's
// request) open forever. A timeout is treated exactly like "ffmpeg missing".
const FFMPEG_TIMEOUT_MS = 180_000;
const DETECT_TIMEOUT_MS = 10_000; // `-version` answers in milliseconds or not at all

let ffmpegProbe: Promise<boolean> | null = null;
function hasFfmpeg(): Promise<boolean> {
  if (!ffmpegProbe) {
    ffmpegProbe = new Promise<boolean>((resolve) => {
      try {
        const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
        // The result is cached for the life of the process, so a hung `-version`
        // would leave EVERY later upload awaiting a promise that never settles.
        const timer = setTimeout(() => {
          p.kill('SIGKILL');
          resolve(false);
        }, DETECT_TIMEOUT_MS);
        const done = (ok: boolean) => {
          clearTimeout(timer);
          resolve(ok);
        };
        p.on('error', () => done(false)); // ENOENT — not installed
        p.on('close', (code) => done(code === 0));
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
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      resolve(false); // in case 'close' never arrives; a later resolve is a no-op
    }, FFMPEG_TIMEOUT_MS);
    const done = (ok: boolean) => {
      clearTimeout(timer); // a live timer would keep the event loop alive
      resolve(ok);
    };
    p.on('error', () => done(false));
    p.on('close', (code) => done(code === 0));
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
  // Queued: the remux is a whole-file, disk-to-disk stream copy on the SAME disk
  // that serves every media byte and every PostgreSQL WAL flush. Run unbounded
  // from the upload handler, N uploaders meant N concurrent copies and playback
  // stuttered for everyone — MEDIA_JOB_CONCURRENCY bounds that.
  //
  // The WAIT for a slot is bounded (MEDIA_JOB_MAX_WAIT_MS) because this runs
  // inside the upload request: queueing past that deadline risks nginx's
  // `proxy_read_timeout 300s` firing on a request whose file is already fully
  // written — a 504 for the uploader, and an orphaned file nothing owns. On
  // `ran: false` ffmpeg was NEVER spawned and no tmp file exists, so degrade
  // exactly like a box without ffmpeg: return false, silently, and let the
  // upload succeed with a tail-`moov` file.
  const job = await tryRunMediaJob(() =>
    runFfmpeg(['-y', '-i', full, '-map', '0', '-c', 'copy', '-movflags', '+faststart', tmp]),
  );
  if (!job.ran) return false;
  if (!job.value) {
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
