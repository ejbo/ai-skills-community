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
// 'preview' is never uploaded — makeVotePreviewClip generates it (6 s, ≤640px,
// no audio), so this is a sanity bound on our OWN output, not a product cap: a
// clip that lands over it means the encode went wrong and is thrown away.
export const MAX_VOTE_PREVIEW_BYTES = 20 * 1024 * 1024; // 20 MB

// Extensions we will ever write/serve; the filename fallback is clamped to
// this set so a bogus filename can never store an arbitrary extension.
const ALLOWED_EXT = new Set(['jpg', 'png', 'webp', 'avif', 'gif', 'mp4', 'webm', 'mov']);

// 'preview' is SERVER-GENERATED only (see makeVotePreviewClip); it is part of
// this union so keys/paths/caps go through the same helpers, NOT because a
// client may ask for one. Both upload routes derive their kind from a closed
// literal set (`x-upload-kind` maps to image/video/poster/cover in
// app/api/votes/[id]/upload and to image/video/poster in
// .../submissions/upload), so no request can select it, and no echoed-key
// check ever passes 'preview' to isValidVoteMediaKey.
export type VoteMediaKind = 'image' | 'video' | 'poster' | 'cover' | 'preview';

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
  if (kind === 'preview') return MAX_VOTE_PREVIEW_BYTES;
  return MAX_VOTE_POSTER_BYTES;
}

/** Pick a file extension from the content type, falling back to the filename. */
export function voteMediaExtFor(kind: VoteMediaKind, contentType: string, filename: string): string {
  // Preview clips are always OUR mp4 — no upload, so no type/filename to trust.
  if (kind === 'preview') return 'mp4';
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

const VOTE_MEDIA_KEY_RE = /^(image|video|poster|cover|preview)\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/;

/**
 * Shape check for keys echoed back by clients (poster attach, cover PATCH).
 * `kind` is always a LITERAL at the call site (a zod enum value or a fixed
 * string), never request input — a `preview/` key is never echoed by anyone,
 * so nothing can claim one through here.
 */
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

function runFfmpeg(args: string[], timeoutMs: number = FFMPEG_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      resolve(false); // in case 'close' never arrives; a later resolve is a no-op
    }, timeoutMs);
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

// ─── 卡片悬停预览片段 (hover preview clip) ──────────────────────────────────
// 作品卡片要像 Geek Videos 卡片那样 hover 自动播放，而契约是**只播这段专门生成
// 的短片，永远不播原片**（components/video/VideoCard.tsx / CLAUDE.md "Video
// delivery"）—— 作品视频是不限大小的，拿原片当 hover 预览等于每次划过卡片就拉一
// 个几百 MB 的文件。这里就是那段短片的生成器，契约与 faststartRemuxVoteMedia 完全
// 一致：best-effort，永不抛，没有 ffmpeg / 排不上队 ⇒ 静默返回 null，卡片退回封面图。

const PREVIEW_SECONDS = 6;
const PREVIEW_MAX_EDGE = 640; // 长边上限；短边按比例，且强制偶数（libx264 要求）

// Unlike the faststart remux (a whole-file copy, cost ∝ size) this only ever
// decodes+encodes the FIRST few seconds, so size barely matters — the guard is
// only against pathological files whose container index alone is expensive to
// parse. Generous on purpose: MAX_UPLOAD_SAFETY_BYTES already bounds intake.
const PREVIEW_SOURCE_MAX_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB

// Both budgets are DELIBERATELY tighter than the remux's (180 s / 45 s): this
// runs in the SAME request, right after the remux + ffprobe, and the whole
// handler answers inside nginx's `proxy_read_timeout 300s`. The queue's own
// arithmetic (lib/uploads/job-queue.ts) already spends 45 + 180 + 30 = 255 s
// worst case, so 5 + 20 = 25 s leaves the worst case at 280 s — a real margin
// rather than the 5 s a 10 + 30 budget would have left. 20 s is still lavish
// for encoding 6 s at ≤640px veryfast (measured well under 2 s), and blowing
// either budget just means no preview: the card falls back to the poster.
const PREVIEW_FFMPEG_TIMEOUT_MS = 20_000;
const PREVIEW_JOB_MAX_WAIT_MS = 5_000;

/**
 * Generate the short hover-preview clip for an entry video. Returns the new
 * `preview/<nanoid>.mp4` key, or null when there is no preview to be had
 * (not a video key, no ffmpeg, no queue slot, ffmpeg failed, or the output
 * looks wrong). NEVER throws — the caller stamps the key when it gets one and
 * otherwise leaves the entry poster-only.
 */
export async function makeVotePreviewClip(
  sourceKey: string,
  sizeBytes: number,
): Promise<string | null> {
  if (!sourceKey.startsWith('video/')) return null;
  if (!Number.isFinite(sizeBytes) || sizeBytes > PREVIEW_SOURCE_MAX_BYTES) return null;
  const src = voteMediaAbsPath(sourceKey);
  if (!src) return null;
  if (!(await hasFfmpeg())) return null;

  const key = newVoteMediaKey('preview', 'mp4');
  const out = voteMediaAbsPath(key);
  if (!out) return null;
  // Write to `.tmp` and rename: a crashed/killed ffmpeg must never leave a
  // half-written file at a key the entry row already points at.
  const tmp = `${out}.tmp.mp4`;
  try {
    await fsp.mkdir(path.dirname(out), { recursive: true });
  } catch {
    return null;
  }

  const job = await tryRunMediaJob(
    () =>
      runFfmpeg(
        [
          '-y',
          // Input seeking + input-side duration: ffmpeg reads only the first
          // PREVIEW_SECONDS of the source instead of decoding the whole file.
          '-ss',
          '0',
          '-t',
          String(PREVIEW_SECONDS),
          '-i',
          src,
          // `0:V:0` = first NON-attached-pic video stream, so an mp4 carrying
          // cover art can't turn the preview into a single still frame.
          '-map',
          '0:V:0',
          '-an', // hover previews are muted anyway
          // Fit inside PREVIEW_MAX_EDGE² keeping the aspect ratio, THEN round
          // both sides to an even number. The rounding pass is not optional:
          // `force_original_aspect_ratio=decrease` happily yields an odd side
          // (verified: a 1078×1002 source → 639×594) and libx264 dies with
          // "width not divisible by 2". A bare `:-2` instead of the box would
          // also let a portrait source through at 640×1138 — bigger than the
          // landscape case it is supposed to bound.
          //
          // The `max(2, …)` clamp matters: a plain `trunc(x/2)*2` computes 0 for
          // a 1-pixel side, and libavfilter reads a computed 0 as "keep the
          // source size", so the odd side survives and libx264 fails exactly the
          // way the rounding was there to prevent (verified on a 1280×2 source:
          // without the clamp ⇒ `height not divisible by 2 (640x1)`; with it ⇒
          // 640×2). Written with classic expressions rather than
          // `force_divisible_by=2` so it also runs on pre-4.4 ffmpeg — a filter
          // this box cannot parse would silently mean NO previews at all.
          '-vf',
          `scale='min(${PREVIEW_MAX_EDGE},iw)':'min(${PREVIEW_MAX_EDGE},ih)':force_original_aspect_ratio=decrease,scale='max(2\\,trunc(iw/2)*2)':'max(2\\,trunc(ih/2)*2)'`,
          // Cap the output frame rate. Without it the clip inherits the source's:
          // a 240 fps slow-mo phone video produced a 1.16 MB "preview" from the
          // same 6 seconds that a 30 fps source turns into 129 KB. `-r` rather
          // than `fps='min(30,source_fps)'` for the same portability reason as
          // above, and it costs nothing on slower sources (a 24 fps source came
          // out 122 KB with the cap vs 124 KB without).
          '-r',
          '30',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '30',
          '-pix_fmt',
          'yuv420p', // baseline-safe chroma; some sources are yuv444/10-bit
          '-movflags',
          '+faststart', // the point is instant first frame on hover
          tmp,
        ],
        PREVIEW_FFMPEG_TIMEOUT_MS,
      ),
    PREVIEW_JOB_MAX_WAIT_MS,
  );
  // ran:false ⇒ ffmpeg was never spawned and no tmp file exists (job-queue.ts).
  if (!job.ran) return null;
  if (!job.value) {
    await fsp.unlink(tmp).catch(() => undefined);
    return null;
  }

  try {
    const st = await fsp.stat(tmp);
    // 0 bytes = ffmpeg "succeeded" writing nothing; over the cap = something
    // went wrong with the encode. Either way it is not worth serving.
    if (!st.isFile() || st.size === 0 || st.size > MAX_VOTE_PREVIEW_BYTES) {
      throw new Error('bad_preview');
    }
    await fsp.rename(tmp, out); // atomic on the same filesystem
    return key;
  } catch {
    await fsp.unlink(tmp).catch(() => undefined);
    return null;
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
