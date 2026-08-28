// 投票活动 media — LOCAL DISK adapter. Mirrors lib/uploads/post-media-storage.ts
// under its own root: organizers bulk-upload entry images/videos (plus video
// posters and an activity cover) via POST /api/votes/[id]/upload (raw body);
// bytes stream back through GET /api/votes/media/[...key] (login + unguessable
// key, Range support). Own namespace = own ledger (VoteEntry rows), so keys are
// never shared with post-media and no cross-table refcounting is needed.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { tryRunMediaJob } from '@/lib/uploads/job-queue';

const MEDIA_ROOT = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORAGE_DIR || './storage',
  'vote-media',
);

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

const VIDEO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

// Entry videos are deliberately uncapped (contest submissions can be huge —
// same product decision as shorts); the burst limiter + creator-only upload
// permission bound abuse. Images get generous safety caps.
export const MAX_VOTE_VIDEO_BYTES = Number.MAX_SAFE_INTEGER;
export const MAX_VOTE_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_VOTE_POSTER_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VOTE_COVER_BYTES = 20 * 1024 * 1024; // 20 MB

// Extensions we will ever write/serve; the filename fallback is clamped to
// this set so a bogus filename can never store an arbitrary extension.
const ALLOWED_EXT = new Set(['jpg', 'png', 'webp', 'avif', 'gif', 'mp4', 'webm', 'mov']);

export type VoteMediaKind = 'image' | 'video' | 'poster' | 'cover';

export function isAllowedVoteImageType(type: string): boolean {
  return type in IMAGE_EXT;
}

export function isAllowedVoteVideoType(type: string): boolean {
  return type in VIDEO_EXT;
}

export function maxBytesForVoteKind(kind: VoteMediaKind): number {
  if (kind === 'video') return MAX_VOTE_VIDEO_BYTES;
  if (kind === 'image') return MAX_VOTE_IMAGE_BYTES;
  if (kind === 'cover') return MAX_VOTE_COVER_BYTES;
  return MAX_VOTE_POSTER_BYTES;
}

/** Pick a file extension from the content type, falling back to the filename. */
export function voteMediaExtFor(kind: VoteMediaKind, contentType: string, filename: string): string {
  const fromType = (kind === 'video' ? VIDEO_EXT : IMAGE_EXT)[contentType];
  if (fromType) return fromType;
  const m = filename.match(/\.([a-zA-Z0-9]{1,5})$/);
  const fromName = m ? m[1].toLowerCase() : '';
  const normalized = fromName === 'jpeg' ? 'jpg' : fromName;
  if (ALLOWED_EXT.has(normalized)) return normalized;
  return kind === 'video' ? 'mp4' : 'jpg';
}

/** A fresh unguessable storage key, e.g. "video/V1StGXR8.mp4". */
export function newVoteMediaKey(kind: VoteMediaKind, ext: string): string {
  return `${kind}/${nanoid()}.${ext}`;
}

const VOTE_MEDIA_KEY_RE = /^(image|video|poster|cover)\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/;

/** Shape check for keys echoed back by clients (poster attach, cover PATCH). */
export function isValidVoteMediaKey(key: string, kind: VoteMediaKind): boolean {
  return VOTE_MEDIA_KEY_RE.test(key) && key.startsWith(`${kind}/`);
}

/** Absolute path for a key, guarding against path traversal (returns null if unsafe). */
export function voteMediaAbsPath(key: string): string | null {
  const full = path.resolve(MEDIA_ROOT, key);
  if (full !== MEDIA_ROOT && !full.startsWith(MEDIA_ROOT + path.sep)) return null;
  return full;
}

/** Root-relative URL (basePath applied at render via withBasePath). */
export function voteMediaPublicUrl(key: string): string {
  return `/api/votes/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Inverse of voteMediaPublicUrl — the storage key behind a stored URL (null if foreign). */
export function voteMediaKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const prefix = '/api/votes/media/';
  if (!url.startsWith(prefix)) return null;
  try {
    return url.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

export function voteMediaContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Stream a web ReadableStream (the raw request body) to disk, enforcing a max
 * byte cap. Cleans up the partial file on error. Returns bytes written.
 */
export async function saveVoteMediaStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const full = voteMediaAbsPath(key);
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

export interface VoteMediaStat {
  size: number;
  contentType: string;
}

export async function statVoteMediaAsync(key: string): Promise<VoteMediaStat | null> {
  const full = voteMediaAbsPath(key);
  if (!full) return null;
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) return null;
    return { size: st.size, contentType: voteMediaContentType(key) };
  } catch {
    return null;
  }
}

/**
 * nginx internal URI for X-Accel-Redirect offload (paired with
 * `location /_votemedia/`, aliased to this module's MEDIA_ROOT).
 */
export function voteMediaXAccelUri(key: string): string {
  return `/_votemedia/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** A Node read stream for a (possibly partial) byte range of a stored file. */
export function openVoteMediaRange(key: string, start: number, end: number): fs.ReadStream | null {
  const full = voteMediaAbsPath(key);
  if (!full) return null;
  return fs.createReadStream(full, { start, end });
}

export async function deleteVoteMediaFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  const full = voteMediaAbsPath(key);
  if (!full) return;
  await fsp.unlink(full).catch(() => undefined);
}

// ─── ffmpeg helpers (faststart remux + duration probe) ──────────────────────
// Same contract as lib/video/storage.ts: best-effort by design — NEVER throw,
// no-op without ffmpeg/ffprobe on PATH, and no-op when the shared media queue
// can't give the remux a slot inside MEDIA_JOB_MAX_WAIT_MS (see job-queue.ts).

const FASTSTART_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB perf guard

// Hard caps on the child processes. A `-c copy` remux of a multi-GB file is
// minutes at worst; past these the child is stuck rather than slow, and killing
// it is strictly better than holding a media-job slot (and the uploader's
// request) open forever. A timeout is treated exactly like "ffmpeg missing".
const FFMPEG_TIMEOUT_MS = 180_000;
const DETECT_TIMEOUT_MS = 10_000; // `-version` answers in milliseconds or not at all
const FFPROBE_TIMEOUT_MS = 30_000;

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

export async function faststartRemuxVoteMedia(key: string, size: number): Promise<boolean> {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'mp4' && ext !== 'mov') return false;
  if (size > FASTSTART_MAX_BYTES) return false;
  const full = voteMediaAbsPath(key);
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

/** Video duration in whole seconds via ffprobe; null on any failure. */
export async function probeVoteMediaDurationSec(key: string): Promise<number | null> {
  const full = voteMediaAbsPath(key);
  if (!full) return null;
  return new Promise((resolve) => {
    try {
      const p = spawn(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', full],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
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
        resolve(Number.isFinite(sec) && sec > 0 ? Math.round(sec) : null);
      });
    } catch {
      resolve(null);
    }
  });
}
