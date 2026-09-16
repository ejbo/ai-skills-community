// ffmpeg / ffprobe — the ONE process layer for server-side media work that
// wants to be reused across domains (today: 名片 clips via lib/media/video-clip.ts
// and lib/profile/card-media-storage.ts). Shorts / votes / zones / discussion
// still carry their own private copies; adopt this module when next touched
// instead of adding a sixth.
//
// House contract (same as every storage module's ffmpeg helpers):
//   - NEVER throws. A missing binary, a spawn error, a non-zero exit and a
//     timeout all read as "didn't work" (false / null), never as an exception
//     on a request path.
//   - Every child is time-boxed and SIGKILLed past its budget, and the promise
//     settles even when the killed child never emits 'close' — a hung ffmpeg
//     must not hold a media-queue slot (lib/uploads/job-queue.ts) forever.
//   - Absolute paths in. Nothing here knows about keys, roots or who may read
//     a file; callers resolve those through their own traversal guards first.
//   - Every INPUT is opened under a demuxer whitelist (inputGuardArgs). An
//     uploaded "video" is attacker-chosen bytes, and ffmpeg picks the demuxer
//     from the CONTENT, not the extension: an 86-byte `ffconcat` text file
//     stored as `.mov` made ffprobe (and would have made the clip renderer)
//     read ANOTHER file from the same folder, and on libxml2 builds a DASH
//     manifest can name absolute `file:` paths. Only real video containers may
//     open; anything else fails closed ("Format not on whitelist").
//
// Deliberately NOT importing `@/lib/env` (like job-queue.ts): the pure helpers
// below are unit-tested without a validated environment. The binaries are the
// plain `ffmpeg` / `ffprobe` names on PATH, exactly like the house modules;
// `setMediaToolBinaries` exists ONLY as a test seam (tests/video-clip.test.ts
// points it at a missing name to exercise the "no ffmpeg on this box" path)
// and is never called by application code.

import { spawn } from 'node:child_process';
import path from 'node:path';

/** `-version` answers in milliseconds or not at all. */
const DETECT_TIMEOUT_MS = 10_000;
/**
 * How long a FAILED availability check is believed. A present binary is cached
 * for the life of the process (a restart picks up a new install), but a `false`
 * can be transient — EAGAIN/EMFILE/ENOMEM on an overloaded box, or a `-version`
 * slower than DETECT_TIMEOUT_MS — and caching it forever turned every member's
 * clip into 501 ffmpeg_unavailable until someone restarted the service.
 */
export const NEGATIVE_AVAILABILITY_TTL_MS = 60_000;
/** How long a SIGKILLed child gets to emit 'close' before we stop waiting for it. */
const KILL_GRACE_MS = 2_000;
/** Bytes of stderr kept for a failure log line (ffmpeg is chatty; only the tail explains an error). */
const STDERR_TAIL_BYTES = 4_096;
/** ffprobe JSON for a sane file is a few KB; past this it is not a file we want to parse. */
const PROBE_STDOUT_MAX_BYTES = 1024 * 1024;

export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

// ─── Binaries (test seam) ───────────────────────────────────────────────────

const DEFAULT_BINARIES = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' } as const;
let binaries: { ffmpeg: string; ffprobe: string } = { ...DEFAULT_BINARIES };

interface AvailabilityEntry {
  promise: Promise<boolean>;
  /** Date.now() when a `false` settled; null while pending or once it answered true. */
  failedAt: number | null;
}
const availability = new Map<string, AvailabilityEntry>();

// ─── Input guard (demuxer + protocol whitelist) ─────────────────────────────

/**
 * The demuxers a VIDEO input may be opened with: ISO-BMFF / QuickTime
 * (`mov,mp4,m4a,3gp,3g2,mj2` is ONE demuxer with six names) and Matroska/WebM —
 * exactly the containers the upload routes accept. Everything that can make
 * ffmpeg open a second resource (concat, hls, dash, image2 patterns, sdp, …)
 * is off the list.
 */
export const DEFAULT_VIDEO_INPUT_FORMATS: readonly string[] = ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm'];

const FORMAT_NAME_RE = /^[a-z0-9_]{1,32}$/;

/**
 * `-format_whitelist <list> -protocol_whitelist file` — the INPUT options that
 * must precede every `-i` (ffmpeg) or input path (ffprobe) built for a file we
 * did not write ourselves. The protocol list makes the "only local files"
 * default explicit (a whitelisted demuxer that follows a reference, e.g. a MOV
 * data reference, still cannot reach http/udp/rtp). Throws RangeError on an
 * empty list or a name that is not a plain demuxer name, so a caller-supplied
 * list can never smuggle an extra option in.
 */
export function inputGuardArgs(formats: readonly string[] = DEFAULT_VIDEO_INPUT_FORMATS): string[] {
  if (!Array.isArray(formats) || formats.length === 0 || !formats.every((f) => typeof f === 'string' && FORMAT_NAME_RE.test(f))) {
    throw new RangeError('input formats must be plain demuxer names');
  }
  return ['-format_whitelist', formats.join(','), '-protocol_whitelist', 'file'];
}

/**
 * TEST SEAM ONLY — override the binary names (`null` restores the defaults) and
 * forget the cached availability probes. Application code never calls this; a
 * deploy that needs another ffmpeg puts it on the service's PATH.
 */
export function setMediaToolBinaries(overrides: { ffmpeg?: string; ffprobe?: string } | null): void {
  binaries = { ...DEFAULT_BINARIES, ...(overrides ?? {}) };
  availability.clear();
}

// ─── Process runner ─────────────────────────────────────────────────────────

export interface ToolRun {
  /** Exited 0 inside the budget. */
  ok: boolean;
  code: number | null;
  timedOut: boolean;
  /** Captured stdout (only when requested), capped. */
  stdout: string;
  /** Last STDERR_TAIL_BYTES of stderr, for a diagnostic log line. */
  stderrTail: string;
}

function runTool(
  bin: string,
  args: readonly string[],
  opts: { timeoutMs: number; captureStdout?: boolean; maxStdoutBytes?: number },
): Promise<ToolRun> {
  return new Promise<ToolRun>((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = '';
    let stdoutBytes = 0;
    let stderrTail = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killGrace: ReturnType<typeof setTimeout> | null = null;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killGrace) clearTimeout(killGrace);
      resolve({ ok: !timedOut && code === 0, code, timedOut, stdout, stderrTail });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...args], {
        stdio: ['ignore', opts.captureStdout ? 'pipe' : 'ignore', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve({ ok: false, code: null, timedOut: false, stdout: '', stderrTail: '' });
      return;
    }

    const budget = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : DETECT_TIMEOUT_MS;
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      // Normally 'close' follows the kill within milliseconds; if it never does,
      // settle anyway — the caller's slot matters more than this child.
      killGrace = setTimeout(() => finish(null), KILL_GRACE_MS);
    }, budget);

    const maxStdout = opts.maxStdoutBytes ?? PROBE_STDOUT_MAX_BYTES;
    child.stdout?.on('data', (d: Buffer) => {
      stdoutBytes += d.byteLength;
      if (stdoutBytes > maxStdout) {
        child.kill('SIGKILL');
        return;
      }
      stdout += d.toString('utf8');
    });
    // stderr MUST be drained: a full pipe blocks ffmpeg mid-encode until the timeout.
    child.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });
    child.on('error', () => finish(null)); // ENOENT — not installed
    child.on('close', (code) => finish(stdoutBytes > maxStdout ? null : code));
  });
}

function probeAvailable(bin: string): Promise<boolean> {
  const cached = availability.get(bin);
  // A pending check is shared; a `true` is kept for the life of the process; a
  // `false` only for NEGATIVE_AVAILABILITY_TTL_MS (see there). Bounded by
  // DETECT_TIMEOUT_MS, so a hung `-version` cannot wedge every later caller.
  if (cached && (cached.failedAt === null || Date.now() - cached.failedAt < NEGATIVE_AVAILABILITY_TTL_MS)) {
    return cached.promise;
  }
  const entry: AvailabilityEntry = { promise: Promise.resolve(false), failedAt: null };
  entry.promise = runTool(bin, ['-version'], { timeoutMs: DETECT_TIMEOUT_MS }).then((r) => {
    if (!r.ok) entry.failedAt = Date.now();
    return r.ok;
  });
  availability.set(bin, entry);
  return entry.promise;
}

/** Is `ffmpeg` runnable on this box? `true` cached per process, `false` re-checked after a minute. */
export function hasFfmpeg(): Promise<boolean> {
  return probeAvailable(binaries.ffmpeg);
}

/** Is `ffprobe` runnable on this box? `true` cached per process, `false` re-checked after a minute. */
export function hasFfprobe(): Promise<boolean> {
  return probeAvailable(binaries.ffprobe);
}

/**
 * Run ffmpeg with `args` inside `timeoutMs`. true only for exit 0 in time.
 * Never throws. Note that exit 0 does NOT prove a usable output (ffmpeg happily
 * writes a frameless mp4 for a seek past the end) — lib/media/video-clip.ts
 * verifies what it renders.
 */
export async function runFfmpeg(args: readonly string[], timeoutMs: number): Promise<boolean> {
  return (await runFfmpegDetailed(args, timeoutMs)).ok;
}

/** runFfmpeg with the exit details (stderr tail for a log line). Never throws. */
export function runFfmpegDetailed(args: readonly string[], timeoutMs: number): Promise<ToolRun> {
  return runTool(binaries.ffmpeg, args, { timeoutMs });
}

// ─── ffprobe ────────────────────────────────────────────────────────────────

export interface MediaProbe {
  /** Container duration (falls back to the video stream's), seconds, > 0. */
  durationSec: number;
  /**
   * The first real video stream's OWN duration (stream `duration`, or Matroska's
   * `DURATION` tag), never more than durationSec; null when there is no video or
   * the stream reports none. Differs from durationSec when an audio track
   * outlasts the picture — use videoTimelineSec() to bound a video-only cut.
   */
  videoDurationSec: number | null;
  /** DISPLAY width/height of the first real video stream (rotation applied); null without video. */
  width: number | null;
  height: number | null;
  /** Frame rate of that stream, frames/second (see pickSourceFrameRate); null when unknown. */
  fps: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

function positive(v: unknown): number | null {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `30000/1001` → 29.97; `0/0` / garbage → null. Bounded to something a real video could be. */
export function parseFrameRate(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(v.trim());
  if (!m) return null;
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  const fps = num / den;
  return fps > 0 && fps <= 1000 ? Math.round(fps * 1000) / 1000 : null;
}

/**
 * Pure: the stream's frame rate from ffprobe's two figures.
 *
 * `avg_frame_rate` is frames ÷ duration; `r_frame_rate` is the base rate every
 * timestamp fits. They agree on a constant-rate file. They split on a
 * variable-rate one — a screen recording of a mostly static screen can average
 * 0.6 fps while its bursts run at 30 — and there the AVERAGE is the wrong basis
 * (re-timing to it drops every burst frame). So:
 *   - avg unusable (missing, 0/0, below 1 fps) ⇒ r_frame_rate
 *   - r clearly above avg (> 10 %: variable rate)   ⇒ r_frame_rate
 *   - otherwise ⇒ avg (29.97 stays 29.97 rather than rounding up to r's 30)
 * A genuine slideshow reports both below 1 and gets that value; the encoder
 * clamps it (clipOutputFps). A bogus r (a 90000/1 timebase) is refused by
 * parseFrameRate and falls back to avg.
 */
export function pickSourceFrameRate(avgRaw: unknown, rRaw: unknown): number | null {
  const avg = parseFrameRate(avgRaw);
  const r = parseFrameRate(rRaw);
  if (avg === null || avg < 1) return r ?? avg;
  if (r !== null && r > avg * 1.1) return r;
  return avg;
}

/** Matroska's per-stream `DURATION` tag (`HH:MM:SS.nnnnnnnnn`) in seconds, or null. */
export function parseDurationTag(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,3}):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

/**
 * The part of a file a VIDEO-ONLY cut can use: the video stream's own duration
 * when ffprobe reports one, else the container's. A clip range must be clamped
 * against this, not durationSec — past the last frame ffmpeg writes a frameless
 * output and the poster has nothing to grab.
 */
export function videoTimelineSec(probe: Pick<MediaProbe, 'durationSec' | 'videoDurationSec'>): number {
  return probe.videoDurationSec ?? probe.durationSec;
}

function rotationOf(stream: Record<string, unknown>): number {
  const sides = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const s of sides) {
    const r = s && typeof s === 'object' ? (s as Record<string, unknown>).rotation : undefined;
    const n = typeof r === 'number' ? r : typeof r === 'string' ? Number.parseFloat(r) : Number.NaN;
    if (Number.isFinite(n)) return n;
  }
  const tags = stream.tags && typeof stream.tags === 'object' ? (stream.tags as Record<string, unknown>) : {};
  const legacy = Number.parseFloat(String(tags.rotate ?? ''));
  return Number.isFinite(legacy) ? legacy : 0;
}

/**
 * Pure: `ffprobe -print_format json -show_format -show_streams` output → MediaProbe,
 * or null when there is no usable duration. The video stream is the first one
 * that is not an attached picture (an mp4's cover art is a "video" stream too).
 */
export function parseProbeOutput(json: unknown): MediaProbe | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const streams = (Array.isArray(root.streams) ? root.streams : []).filter(
    (s): s is Record<string, unknown> => !!s && typeof s === 'object',
  );
  const video = streams.find((s) => {
    if (s.codec_type !== 'video') return false;
    const disp = s.disposition && typeof s.disposition === 'object' ? (s.disposition as Record<string, unknown>) : {};
    return disp.attached_pic !== 1;
  });
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  const format = root.format && typeof root.format === 'object' ? (root.format as Record<string, unknown>) : {};
  const durationSec = positive(format.duration) ?? positive(video?.duration);
  if (durationSec === null) return null;

  let width: number | null = null;
  let height: number | null = null;
  let fps: number | null = null;
  let videoDurationSec: number | null = null;
  if (video) {
    const w = positive(video.width);
    const h = positive(video.height);
    if (w !== null && h !== null) {
      const quarterTurn = Math.abs(Math.round(rotationOf(video))) % 180 === 90;
      width = quarterTurn ? h : w;
      height = quarterTurn ? w : h;
    }
    fps = pickSourceFrameRate(video.avg_frame_rate, video.r_frame_rate);
    const tags = video.tags && typeof video.tags === 'object' ? (video.tags as Record<string, unknown>) : {};
    const own = positive(video.duration) ?? parseDurationTag(tags.DURATION);
    videoDurationSec = own === null ? null : Math.min(own, durationSec);
  }
  return { durationSec, videoDurationSec, width, height, fps, hasVideo: !!video, hasAudio };
}

export interface ProbeOptions {
  /** Demuxers the file may be opened with (inputGuardArgs); default DEFAULT_VIDEO_INPUT_FORMATS. */
  inputFormats?: readonly string[];
}

/** Pure: the ffprobe argv for probeMediaFile. Throws RangeError on a relative path or a bad format list. */
export function buildProbeArgs(absPath: string, opts: ProbeOptions = {}): string[] {
  // Absolute ⇒ never starts with '-', so it can never be read as an option.
  if (typeof absPath !== 'string' || !path.isAbsolute(absPath) || absPath.includes('\0')) {
    throw new RangeError('input must be an absolute path');
  }
  return [
    '-v',
    'error',
    ...inputGuardArgs(opts.inputFormats),
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    absPath,
  ];
}

/**
 * Probe a media file (ABSOLUTE path) with ffprobe. null when ffprobe is missing,
 * fails, times out, the file is not one of `opts.inputFormats` (default: video
 * containers only), or it has no usable duration. Never throws.
 */
export async function probeMediaFile(
  absPath: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  opts: ProbeOptions = {},
): Promise<MediaProbe | null> {
  let args: string[];
  try {
    args = buildProbeArgs(absPath, opts);
  } catch {
    return null;
  }
  const run = await runTool(binaries.ffprobe, args, { timeoutMs, captureStdout: true });
  if (!run.ok) return null;
  try {
    return parseProbeOutput(JSON.parse(run.stdout));
  } catch {
    return null;
  }
}
