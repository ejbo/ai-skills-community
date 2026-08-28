// 技术专区 media — LOCAL DISK adapter. Mirrors lib/votes/storage.ts under its
// own root (`<LOCAL_STORAGE_DIR>/zone-media`): zone covers/icons, post
// attachments (image / video / file), video posters and office → PDF preview
// renditions. Uploads arrive as raw request bodies (house protocol); bytes
// stream back through GET /api/zones/media/[...key] (login + unguessable key,
// Range support). Own namespace = own ledger (ZonePostAttachment / Zone rows),
// so keys are never shared with other media modules.
//
// Reads `process.env.LOCAL_STORAGE_DIR` DIRECTLY (not @/lib/env) so the pure
// helpers stay unit-testable without a validated environment.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { tryRunMediaJob } from '@/lib/uploads/job-queue';
import {
  MAX_ZONE_COVER_BYTES,
  MAX_ZONE_FILE_BYTES,
  MAX_ZONE_IMAGE_BYTES,
  MAX_ZONE_VIDEO_BYTES,
  ZONE_FILE_EXT,
  ZONE_FILE_EXTS,
  ZONE_IMAGE_TYPES,
  ZONE_MEDIA_KEY_RE,
  ZONE_VIDEO_TYPES,
  extOfName,
} from './shared';

const MEDIA_ROOT = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORAGE_DIR || './storage',
  'zone-media',
);

export type ZoneMediaKind = 'image' | 'video' | 'file' | 'cover' | 'icon' | 'poster' | 'preview';

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

const IMAGE_EXTS: ReadonlySet<string> = new Set(Object.values(IMAGE_EXT));
const VIDEO_EXTS: ReadonlySet<string> = new Set(Object.values(VIDEO_EXT));

/** Video posters captured client-side are small stills. */
export const MAX_ZONE_POSTER_BYTES = 10 * 1024 * 1024; // 10 MB

export function isAllowedZoneImageType(type: string): boolean {
  return ZONE_IMAGE_TYPES.has(type);
}

export function isAllowedZoneVideoType(type: string): boolean {
  return ZONE_VIDEO_TYPES.has(type);
}

/**
 * Files are accepted by MIME type OR by extension: browsers report
 * `application/octet-stream` (or nothing) for .md / .pptx / .csv depending on
 * the OS registry, so the filename is a legitimate second signal — but never
 * for a body the browser positively identified as an image or a video.
 */
export function isAllowedZoneFileType(type: string, filename: string): boolean {
  if (type in ZONE_FILE_EXT) return true;
  if (ZONE_IMAGE_TYPES.has(type) || ZONE_VIDEO_TYPES.has(type)) return false;
  return ZONE_FILE_EXTS.has(extOfName(filename));
}

export function maxBytesForZoneKind(kind: ZoneMediaKind): number {
  switch (kind) {
    case 'video':
      return MAX_ZONE_VIDEO_BYTES;
    case 'file':
    case 'preview':
      return MAX_ZONE_FILE_BYTES;
    case 'image':
      return MAX_ZONE_IMAGE_BYTES;
    case 'cover':
    case 'icon':
      return MAX_ZONE_COVER_BYTES;
    case 'poster':
      return MAX_ZONE_POSTER_BYTES;
  }
}

/**
 * Pick a file extension for a kind from the content type, falling back to the
 * filename. Always returns something that satisfies ZONE_MEDIA_KEY_RE — a bogus
 * filename can never store an arbitrary extension.
 */
export function zoneMediaExtFor(kind: ZoneMediaKind, contentType: string, filename: string): string {
  const rawName = extOfName(filename);
  const fromName = rawName === 'jpeg' ? 'jpg' : rawName;
  if (kind === 'preview') return 'pdf';
  if (kind === 'video') {
    return VIDEO_EXT[contentType] ?? (VIDEO_EXTS.has(fromName) ? fromName : 'mp4');
  }
  if (kind === 'file') {
    // The filename wins for documents: `.pptx` sent as octet-stream must not
    // become `.bin`, and `.md` sent as text/plain must stay `.md`.
    if (ZONE_FILE_EXTS.has(fromName)) return fromName;
    return ZONE_FILE_EXT[contentType] ?? 'bin';
  }
  // image | cover | icon | poster
  return IMAGE_EXT[contentType] ?? (IMAGE_EXTS.has(fromName) ? fromName : 'jpg');
}

/** A fresh unguessable storage key, e.g. "file/V1StGXR8_Z5jdHi6B-myT.pptx". */
export function newZoneMediaKey(kind: ZoneMediaKind, ext: string): string {
  return `${kind}/${nanoid()}.${ext}`;
}

/** Shape check for keys echoed back by clients (attachments, cover/icon PATCH). */
export function isValidZoneMediaKey(key: string, kind?: ZoneMediaKind): boolean {
  if (!ZONE_MEDIA_KEY_RE.test(key)) return false;
  return kind ? key.startsWith(`${kind}/`) : true;
}

/** Absolute path for a key, guarding against path traversal (returns null if unsafe). */
export function zoneMediaAbsPath(key: string): string | null {
  const full = path.resolve(MEDIA_ROOT, key);
  if (full !== MEDIA_ROOT && !full.startsWith(MEDIA_ROOT + path.sep)) return null;
  return full;
}

/** Root-relative URL (basePath applied at render via withBasePath). */
export function zoneMediaPublicUrl(key: string): string {
  return `/api/zones/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Inverse of zoneMediaPublicUrl — the storage key behind a stored URL (null if foreign). */
export function zoneMediaKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const prefix = '/api/zones/media/';
  if (!url.startsWith(prefix)) return null;
  try {
    const key = url.slice(prefix.length).split('?')[0].split('/').map(decodeURIComponent).join('/');
    return key || null;
  } catch {
    return null;
  }
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
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  // Text formats are served as text (never HTML) — safe to render inline.
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

export function zoneMediaContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Stream a web ReadableStream (the raw request body) to disk, enforcing a max
 * byte cap. Cleans up the partial file on error. Returns bytes written.
 */
export async function saveZoneMediaStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const full = zoneMediaAbsPath(key);
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

export interface ZoneMediaStat {
  size: number;
  contentType: string;
}

export async function statZoneMediaAsync(key: string): Promise<ZoneMediaStat | null> {
  const full = zoneMediaAbsPath(key);
  if (!full) return null;
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) return null;
    return { size: st.size, contentType: zoneMediaContentType(key) };
  } catch {
    return null;
  }
}

/**
 * nginx internal URI for X-Accel-Redirect offload (paired with
 * `location /_zonemedia/`, aliased to this module's MEDIA_ROOT). Pure string
 * work — deliberately no @/lib/env import here (see the header note).
 */
export function zoneMediaXAccelUri(key: string): string {
  return `/_zonemedia/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** A Node read stream for a (possibly partial) byte range of a stored file. */
export function openZoneMediaRange(key: string, start: number, end: number): fs.ReadStream | null {
  const full = zoneMediaAbsPath(key);
  if (!full) return null;
  return fs.createReadStream(full, { start, end });
}

export async function deleteZoneMediaFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  const full = zoneMediaAbsPath(key);
  if (!full) return;
  await fsp.unlink(full).catch(() => undefined);
}

// ─── ffmpeg helpers (faststart remux + probes) ──────────────────────────────
// Same contract as lib/votes/storage.ts: best-effort by design — NEVER throw,
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

/** Captures ffprobe stdout for `args`; null on any failure (incl. missing binary). */
function runFfprobe(args: string[]): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      const p = spawn('ffprobe', ['-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        resolve(null);
      }, FFPROBE_TIMEOUT_MS);
      const done = (v: string | null) => {
        clearTimeout(timer);
        resolve(v);
      };
      let out = '';
      p.stdout.on('data', (d) => {
        out += String(d);
      });
      p.on('error', () => done(null));
      p.on('close', (code) => done(code === 0 ? out : null));
    } catch {
      resolve(null);
    }
  });
}

export async function faststartRemuxZoneMedia(key: string, size: number): Promise<boolean> {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'mp4' && ext !== 'mov') return false;
  if (size > FASTSTART_MAX_BYTES) return false;
  const full = zoneMediaAbsPath(key);
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
export async function probeZoneVideoDurationSec(key: string): Promise<number | null> {
  const full = zoneMediaAbsPath(key);
  if (!full) return null;
  const out = await runFfprobe(['-show_entries', 'format=duration', '-of', 'csv=p=0', full]);
  if (out === null) return null;
  const sec = Number.parseFloat(out.trim());
  return Number.isFinite(sec) && sec > 0 ? Math.round(sec) : null;
}

/**
 * Pixel size of an image (or the first video stream) via ffprobe; null when
 * ffprobe is unavailable or the format is not decodable (e.g. AVIF on older
 * builds) — callers store null and the UI falls back to intrinsic sizing.
 */
export async function probeZoneImageSize(key: string): Promise<{ width: number; height: number } | null> {
  const full = zoneMediaAbsPath(key);
  if (!full) return null;
  const out = await runFfprobe([
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0',
    full,
  ]);
  if (out === null) return null;
  const first = out.trim().split('\n')[0] ?? '';
  const [w, h] = first.split(',').map((v) => Number.parseInt(v.trim(), 10));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}
