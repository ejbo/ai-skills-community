// 视频截取 — server-side renderer for a segment of an uploaded video (and a
// still frame from it). The in-browser trimmer (components/media/VideoTrimmer.tsx)
// decides the range with lib/media/clip-shared.ts; a route re-normalises that
// range against the REAL probed duration and hands it to renderClip/renderFrame.
//
// Two layers:
//   - PURE argument builders (`buildClipArgs`, `buildFrameArgs`, the scale
//     filters, `clipOutputFps`) — unit-tested in tests/video-clip.test.ts, so
//     the exact ffmpeg invocation is reviewable without a binary.
//   - `renderClip` / `renderFrame` — write to `<output>.tmp.<ext>` and rename
//     into place ONLY a sane output (non-empty, under a byte cap, and for a clip
//     a probe that finds a real video stream). NEVER throw; return a boolean.
//
// Absolute paths in, no keys, no roots, no queue: callers own their traversal
// guard and wrap the call in `tryRunMediaJob` (lib/uploads/job-queue.ts) with
// their own wait budget. Used by 名片 (lib/profile/card-media-storage.ts); shorts,
// votes, zones and discussion can adopt it without changes here.
//
// Every output is stripped of the source's container metadata
// (`-map_metadata -1 -map_chapters -1`, a phone MOV's location / creation time /
// device) and of the container-level encoder tag (`+bitexact`; x264 still writes
// its build/options SEI into the bitstream — no member data), because a rendered
// clip is typically PUBLISHED while its original is not.
//
// Every input is opened under the demuxer whitelist (lib/media/ffmpeg.ts
// inputGuardArgs — an uploaded file is attacker-chosen bytes, and a text
// `ffconcat` list saved as `.mov` would otherwise render ANOTHER file), and every
// run is capped at `threads` decoder/filter/encoder threads: these jobs share one
// media-queue slot and the box's cores with every other request, and an
// uncapped 4K HEVC cut held 5–6 cores for its whole run (DEFAULT_MEDIA_THREADS).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_VIDEO_INPUT_FORMATS, hasFfprobe, inputGuardArgs, probeMediaFile, runFfmpegDetailed } from '@/lib/media/ffmpeg';

// ─── Pure builders ──────────────────────────────────────────────────────────

export interface ClipArgsOptions {
  /** Absolute source path. */
  input: string;
  /** Absolute output path; the extension picks the container (`.mp4` expected). */
  output: string;
  /** Segment start in SOURCE seconds (≥ 0). */
  startSec: number;
  /** Segment end in SOURCE seconds (> startSec). */
  endSec: number;
  /** Long-edge cap in px; smaller sources are never upscaled. Both sides come out even (libx264). */
  maxEdge: number;
  /** Output frame rate (use clipOutputFps to cap without upsampling a slower source). */
  fps: number;
  /** libx264 CRF (0–51; ~23 visually clean, ~28 small). */
  crf: number;
  /** VBV peak bitrate in kbps (buffer = 2×), or null for pure CRF. */
  maxrateKbps: number | null;
  /** true ⇒ no audio track at all; false ⇒ first audio stream (if any) as AAC. */
  mute: boolean;
  /** Decoder, filter and encoder thread cap (1–16); default DEFAULT_MEDIA_THREADS. */
  threads?: number;
  /** Demuxers the input may be opened with; default DEFAULT_VIDEO_INPUT_FORMATS. */
  inputFormats?: readonly string[];
}

export interface FrameArgsOptions {
  /** Absolute source path. */
  input: string;
  /** Absolute output path (`.jpg` expected — `quality` is the mjpeg q scale). */
  output: string;
  /** Timestamp in SOURCE seconds (≥ 0). */
  atSec: number;
  /** Long-edge cap in px; never upscales. */
  maxEdge: number;
  /** mjpeg `-q:v`, 2 (best) … 31 (worst). */
  quality: number;
  /** Decoder and filter thread cap (1–16); default DEFAULT_MEDIA_THREADS. */
  threads?: number;
  /** Demuxers the input may be opened with; default DEFAULT_VIDEO_INPUT_FORMATS. */
  inputFormats?: readonly string[];
}

/**
 * Threads per decoder / filtergraph / encoder. Two keeps a 30 s 1080p cut in
 * seconds while leaving the other cores to request handlers and PostgreSQL.
 * Measured on ffmpeg 8.1 (14 cores), 10 s cut to the card's 720p30: a 4K60 HEVC
 * 10-bit source went from 5.6 cores (3.2 s wall) to 2.2 cores (6.9 s wall). It is
 * a cap per STAGE, not per process — ffmpeg ≥ 6 also runs demux, filter and mux
 * on their own threads — so a light 1080p H.264 cut still peaks near 4 cores,
 * but only for the fraction of a second such a cut takes; the long, expensive
 * decodes are the ones this bounds.
 */
export const DEFAULT_MEDIA_THREADS = 2;

const NO_METADATA = ['-map_metadata', '-1', '-map_chapters', '-1'] as const;
// +bitexact drops the muxer's `encoder=Lavf…` tag (x264's own SEI user data remains).
const BITEXACT = ['-fflags', '+bitexact', '-flags:v', '+bitexact'] as const;
const QUIET = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'] as const;

function assertAbsolute(p: unknown, name: string): asserts p is string {
  // Absolute ⇒ never begins with '-', so no path can be parsed as an ffmpeg option.
  if (typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0')) {
    throw new RangeError(`${name} must be an absolute path`);
  }
}

function assertNumber(v: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new RangeError(`${name} out of range`);
  }
}

function threadCount(v: unknown): string {
  const n = v === undefined ? DEFAULT_MEDIA_THREADS : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 16) throw new RangeError('threads out of range');
  return String(n);
}

/** Seconds as ffmpeg reads them: fixed millisecond precision, never exponent notation. */
export function ffmpegSeconds(sec: number): string {
  return (Math.round(Math.max(0, sec) * 1000) / 1000).toFixed(3);
}

/** Fit inside maxEdge² keeping the aspect ratio; never upscales. Odd sides allowed (stills). */
export function boxScaleFilter(maxEdge: number): string {
  const e = Math.floor(maxEdge);
  return `scale='min(${e},iw)':'min(${e},ih)':force_original_aspect_ratio=decrease`;
}

/**
 * boxScaleFilter, then both sides forced EVEN with a ≥ 2 clamp — libx264 refuses
 * an odd side and `force_original_aspect_ratio=decrease` produces them; a bare
 * `trunc(x/2)*2` computes 0 for a 1 px side, which libavfilter reads as "keep"
 * (full story in lib/votes/storage.ts#makeVotePreviewClip). Classic expressions
 * on purpose: `force_divisible_by` needs ffmpeg ≥ 4.4.
 */
export function evenBoxScaleFilter(maxEdge: number): string {
  return `${boxScaleFilter(maxEdge)},scale='max(2\\,trunc(iw/2)*2)':'max(2\\,trunc(ih/2)*2)'`;
}

/** The lowest output rate buildClipArgs accepts — `-r` below one frame per second is not a video. */
export const MIN_OUTPUT_FPS = 1;

/**
 * The frame rate to encode at, always inside [MIN_OUTPUT_FPS, cap]: the source's
 * own when it is inside that band (a 24 fps film stays 24 — `-r 30` would
 * duplicate frames), `cap` above it (a 240 fps slow-mo must not balloon the
 * clip), 1 below it (a slideshow at 0.5 fps is re-timed to 1 fps — each still
 * shown twice — instead of failing the whole cut). Unknown source ⇒ `cap`.
 * Pass the probe's fps (lib/media/ffmpeg.ts pickSourceFrameRate already prefers
 * r_frame_rate for a variable-rate source).
 */
export function clipOutputFps(sourceFps: number | null | undefined, cap: number): number {
  const c = Number.isFinite(cap) && cap >= MIN_OUTPUT_FPS ? cap : 30;
  if (typeof sourceFps !== 'number' || !Number.isFinite(sourceFps) || sourceFps <= 0) return c;
  return Math.max(MIN_OUTPUT_FPS, Math.min(c, Math.round(sourceFps * 1000) / 1000));
}

/**
 * ffmpeg arguments for one re-encoded segment. Throws RangeError on invalid
 * options (renderClip turns that into `false`).
 *
 * `-ss` BEFORE `-i` is a fast input seek that stays frame-accurate because we
 * transcode (ffmpeg's default `-accurate_seek` discards the frames between the
 * keyframe and the start); `-t` AFTER it is the OUTPUT duration, so the clip is
 * exactly end − start long. `0:V:0` is the first non-cover-art video stream.
 * Autorotation stays on, so a portrait phone video comes out upright and the
 * dropped rotation metadata does not matter.
 */
export function buildClipArgs(o: ClipArgsOptions): string[] {
  assertAbsolute(o.input, 'input');
  assertAbsolute(o.output, 'output');
  if (o.input === o.output) throw new RangeError('output must differ from input');
  assertNumber(o.startSec, 'startSec', 0);
  assertNumber(o.endSec, 'endSec', 0);
  if (o.endSec - o.startSec < 0.001) throw new RangeError('empty range');
  assertNumber(o.maxEdge, 'maxEdge', 2, 16_384);
  assertNumber(o.fps, 'fps', MIN_OUTPUT_FPS, 240);
  assertNumber(o.crf, 'crf', 0, 51);
  if (o.maxrateKbps !== null) assertNumber(o.maxrateKbps, 'maxrateKbps', 64, 200_000);
  const threads = threadCount(o.threads);
  const guard = inputGuardArgs(o.inputFormats ?? DEFAULT_VIDEO_INPUT_FORMATS);

  const rate =
    o.maxrateKbps === null
      ? []
      : ['-maxrate', `${Math.round(o.maxrateKbps)}k`, '-bufsize', `${Math.round(o.maxrateKbps * 2)}k`];
  const audio = o.mute ? ['-an'] : ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'];
  return [
    ...QUIET,
    '-filter_threads',
    threads,
    // Input options: demuxer/protocol whitelist, decoder threads.
    ...guard,
    '-threads',
    threads,
    '-ss',
    ffmpegSeconds(o.startSec),
    '-i',
    o.input,
    '-t',
    ffmpegSeconds(o.endSec - o.startSec),
    '-map',
    '0:V:0',
    ...audio,
    '-sn',
    '-dn',
    ...NO_METADATA,
    '-vf',
    evenBoxScaleFilter(o.maxEdge),
    '-r',
    String(o.fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(o.crf),
    ...rate,
    // Output option: encoder threads.
    '-threads',
    threads,
    '-pix_fmt',
    'yuv420p',
    // First frame on hover instead of after the moov atom downloads.
    '-movflags',
    '+faststart',
    ...BITEXACT,
    o.output,
  ];
}

/** ffmpeg arguments for one still frame at `atSec`. Throws RangeError on invalid options. */
export function buildFrameArgs(o: FrameArgsOptions): string[] {
  assertAbsolute(o.input, 'input');
  assertAbsolute(o.output, 'output');
  if (o.input === o.output) throw new RangeError('output must differ from input');
  assertNumber(o.atSec, 'atSec', 0);
  assertNumber(o.maxEdge, 'maxEdge', 2, 16_384);
  assertNumber(o.quality, 'quality', 2, 31);
  const threads = threadCount(o.threads);
  const guard = inputGuardArgs(o.inputFormats ?? DEFAULT_VIDEO_INPUT_FORMATS);
  return [
    ...QUIET,
    '-filter_threads',
    threads,
    ...guard,
    '-threads',
    threads,
    '-ss',
    ffmpegSeconds(o.atSec),
    '-i',
    o.input,
    '-map',
    '0:V:0',
    ...NO_METADATA,
    '-frames:v',
    '1',
    // The scale filter is also what converts a limited-range yuv420p source into
    // the full-range format mjpeg accepts (ffmpeg ≥ 7 refuses to open the encoder otherwise).
    '-vf',
    boxScaleFilter(o.maxEdge),
    '-q:v',
    String(Math.round(o.quality)),
    '-update',
    '1',
    ...BITEXACT,
    o.output,
  ];
}

// ─── Renderers ──────────────────────────────────────────────────────────────

/** Budget for probing a freshly rendered clip (a small, faststart local file). */
const VERIFY_PROBE_TIMEOUT_MS = 5_000;

/** `<output>.tmp.<ext>` — the matching extension keeps ffmpeg on the same container. */
export function tmpOutputPath(output: string): string {
  return `${output}.tmp${path.extname(output)}`;
}

async function promote(tmp: string, output: string, maxBytes: number): Promise<boolean> {
  try {
    const st = await fsp.stat(tmp);
    if (!st.isFile() || st.size === 0 || st.size > maxBytes) return false;
    await fsp.rename(tmp, output);
    return true;
  } catch {
    return false;
  }
}

function logFailure(what: string, detail: string): void {
  // One line, only on failure: the member sees a generic error, ops need the reason.
  console.warn(`[video-clip] ${what} failed: ${detail.replace(/\s+/g, ' ').trim().slice(-600)}`);
}

export interface RenderLimits {
  /** Hard budget for the ffmpeg child (SIGKILL past it). */
  timeoutMs: number;
  /** Largest acceptable output, bytes — a sanity bound on OUR OWN encode. */
  maxBytes: number;
}

/**
 * Render a segment (see buildClipArgs) to `output`. true ⇒ `output` now exists
 * and holds a verified clip. false ⇒ nothing was written (the tmp is always
 * removed). Never throws. Adds at most VERIFY_PROBE_TIMEOUT_MS on top of
 * `timeoutMs` for the output probe.
 *
 * Exit 0 is not enough: a seek past the last frame makes ffmpeg write a
 * frameless ~300-byte mp4 and exit 0. The probe must find a real video stream
 * with a duration before the file is renamed into place.
 */
export async function renderClip(opts: ClipArgsOptions & RenderLimits): Promise<boolean> {
  let tmp: string | null = null;
  try {
    tmp = tmpOutputPath(opts.output);
    const args = buildClipArgs({ ...opts, output: tmp });
    await fsp.mkdir(path.dirname(opts.output), { recursive: true });
    const run = await runFfmpegDetailed(args, opts.timeoutMs);
    if (!run.ok) {
      logFailure('clip', run.timedOut ? `timed out after ${opts.timeoutMs}ms` : `exit ${run.code}: ${run.stderrTail}`);
      return false;
    }
    if (await hasFfprobe()) {
      const probe = await probeMediaFile(tmp, VERIFY_PROBE_TIMEOUT_MS);
      if (!probe || !probe.hasVideo || probe.durationSec <= 0) {
        logFailure('clip', 'output has no decodable video');
        return false;
      }
    }
    if (!(await promote(tmp, opts.output, opts.maxBytes))) {
      logFailure('clip', 'output empty or over the size cap');
      return false;
    }
    tmp = null;
    return true;
  } catch (e) {
    logFailure('clip', e instanceof Error ? e.message : 'unknown error');
    return false;
  } finally {
    if (tmp) await fsp.unlink(tmp).catch(() => undefined);
  }
}

/**
 * Render one still frame (see buildFrameArgs) to `output`. Same contract as
 * renderClip: true only when a non-empty file under `maxBytes` was renamed into
 * place; never throws. A timestamp past the last frame yields no file at all,
 * so callers that must have a frame retry at an earlier time.
 */
export async function renderFrame(opts: FrameArgsOptions & RenderLimits): Promise<boolean> {
  let tmp: string | null = null;
  try {
    tmp = tmpOutputPath(opts.output);
    const args = buildFrameArgs({ ...opts, output: tmp });
    await fsp.mkdir(path.dirname(opts.output), { recursive: true });
    const run = await runFfmpegDetailed(args, opts.timeoutMs);
    // A failed frame is often an expected miss (past the end) — no log line; the caller retries.
    if (!run.ok) return false;
    if (!(await promote(tmp, opts.output, opts.maxBytes))) return false;
    tmp = null;
    return true;
  } catch {
    return false;
  } finally {
    if (tmp) await fsp.unlink(tmp).catch(() => undefined);
  }
}
