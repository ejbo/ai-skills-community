// 视频截取 — the pure geometry + keyboard half of <VideoTrimmer/>.
//
// Import-free apart from the clip contract (lib/media/clip-shared.ts) and
// unit-tested (tests/video-trimmer.test.ts). Every range this module returns
// has been through `normalizeClipRange` — the SAME function the server runs on
// the posted body — so what the handles show is exactly what gets cut. Nothing
// here re-implements clamping: it only turns pointer positions and key presses
// into the shared `shiftClipRange` / `resizeClipRange` calls.

import {
  CLIP_TIME_STEP,
  defaultClipRange,
  normalizeClipRange,
  resizeClipRange,
  roundClipTime,
  shiftClipRange,
  type ClipBounds,
  type ClipRange,
} from '@/lib/media/clip-shared';

/** Bounds on the frames a filmstrip captures: enough to recognise a scene, cheap enough to decode on a phone. */
export const FILMSTRIP_MIN_FRAMES = 4;
export const FILMSTRIP_MAX_FRAMES = 12;
/** Rendered height of the filmstrip track, px (h-12). */
export const FILMSTRIP_HEIGHT_PX = 48;

/**
 * How many thumbnails a track of `trackWidth` px shows for a video of `aspect`
 * (width / height): as many as fit at the video's own shape, clamped — a
 * landscape clip gets a few wide frames, a portrait one more narrow ones, so a
 * slot crops as little of each frame as the clamp allows.
 */
export function filmstripFrameCount(trackWidth: number, aspect: number, height = FILMSTRIP_HEIGHT_PX): number {
  if (!(trackWidth > 0) || !(aspect > 0) || !(height > 0)) return FILMSTRIP_MIN_FRAMES;
  const fit = Math.round(trackWidth / (height * aspect));
  return Math.min(FILMSTRIP_MAX_FRAMES, Math.max(FILMSTRIP_MIN_FRAMES, fit));
}

/** Pixels a pointer must travel on the selection body before a press becomes a drag (else it is a click-to-seek). */
export const DRAG_SLOP_PX = 3;

/**
 * Playback within this many seconds of the range end wraps back to the start.
 * A `timeupdate` / animation frame lands every ~16–250 ms, so waiting for the
 * exact end would show a frame or two past it.
 */
export const LOOP_END_EPSILON = 0.04;

/**
 * The duration the range math works in: the source floored to CLIP_TIME_STEP
 * (a 12.37 s source is a 12.3 s timeline). Using the raw value would let a
 * shifted window round up to 12.4 — past the last frame and different from the
 * range the server normalises to.
 */
export function clipTimelineDuration(duration: number): number {
  return defaultClipRange(duration, { maxLength: Number.MAX_SAFE_INTEGER }).end;
}

/** Position of `sec` on a track of `duration`, as a 0–1 ratio (clamped). */
export function ratioOf(sec: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(sec)) return 0;
  return Math.min(1, Math.max(0, sec / duration));
}

/** The time under a pointer at `clientX` over a track spanning `left`…`left + width`. */
export function timeAtClientX(clientX: number, left: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return ratioOf(((clientX - left) / width) * duration, duration) * duration;
}

/** Seconds a pixel offset on the track represents. */
export function secondsForPixels(dx: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return (dx / width) * duration;
}

/** Final gate for every range the trimmer emits: the shared normaliser, or the fallback when it refuses. */
export function commitRange(candidate: ClipRange, duration: number, bounds: ClipBounds, fallback: ClipRange): ClipRange {
  return normalizeClipRange(candidate, duration, bounds) ?? fallback;
}

/**
 * The range a trimmer should show for `value` on a source of `duration`:
 * the default range when nothing is chosen yet (or the stored one no longer
 * fits at all), otherwise the value normalised for this source.
 */
export function initialRangeFor(value: ClipRange | null, duration: number, bounds: ClipBounds): ClipRange | null {
  if (!(duration > 0)) return null;
  const fallback = defaultClipRange(duration, bounds);
  if (!value) return fallback.end > fallback.start ? fallback : null;
  return normalizeClipRange(value, duration, bounds) ?? (fallback.end > fallback.start ? fallback : null);
}

export function rangesEqual(a: ClipRange | null, b: ClipRange | null): boolean {
  if (!a || !b) return a === b;
  return a.start === b.start && a.end === b.end;
}

/** Does the range cover the whole (timeline) source? Used for the 「整段」 readout. */
export function isWholeSource(range: ClipRange, duration: number): boolean {
  return range.start === 0 && range.end >= clipTimelineDuration(duration);
}

/**
 * Where a playhead must jump for the preview to loop `range`: the range start
 * once playback reaches the end (or sits clearly before the start), else null.
 */
export function loopJumpTarget(currentTime: number, range: ClipRange): number | null {
  if (currentTime >= range.end - LOOP_END_EPSILON) return range.start;
  if (currentTime < range.start - 0.25) return range.start;
  return null;
}

/** A seek made while the preview is looping lands inside the range (the loop would yank it back anyway). */
export function snapIntoRange(sec: number, range: ClipRange): number {
  if (sec < range.start || sec >= range.end - LOOP_END_EPSILON) return range.start;
  return sec;
}

export type TrimTarget = 'start' | 'end' | 'window';

/**
 * A key press on a handle (`start` / `end`, role="slider") or on the selection
 * body (`window`): ←/↓ and →/↑ step CLIP_TIME_STEP (Shift: 1 s), Home/End jump
 * to the extreme that target can reach, PageDown/PageUp step 10 s.
 * Returns null for keys the trimmer does not own (so the event keeps its default).
 */
export function nudgeRange(
  range: ClipRange,
  target: TrimTarget,
  key: string,
  shiftKey: boolean,
  duration: number,
  bounds: ClipBounds,
): ClipRange | null {
  const dur = clipTimelineDuration(duration);
  const step = shiftKey ? 1 : CLIP_TIME_STEP;
  let delta: number | null = null;
  let jump: 'min' | 'max' | null = null;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      delta = -step;
      break;
    case 'ArrowRight':
    case 'ArrowUp':
      delta = step;
      break;
    case 'PageDown':
      delta = -10;
      break;
    case 'PageUp':
      delta = 10;
      break;
    case 'Home':
      jump = 'min';
      break;
    case 'End':
      jump = 'max';
      break;
    default:
      return null;
  }

  let next: ClipRange;
  if (target === 'window') {
    const d = jump === 'min' ? -range.start : jump === 'max' ? dur - range.end : (delta as number);
    next = shiftClipRange(range, d, dur);
  } else {
    const current = range[target];
    const value =
      jump === 'min' ? (target === 'start' ? 0 : range.start) : jump === 'max' ? (target === 'start' ? range.end : dur) : current + (delta as number);
    next = resizeClipRange(range, target, value, dur, bounds);
  }
  return commitRange(next, duration, bounds, range);
}

/** Drag one edge (from the range at gesture start) to `sec`. */
export function dragEdge(origin: ClipRange, edge: 'start' | 'end', sec: number, duration: number, bounds: ClipBounds): ClipRange {
  return commitRange(resizeClipRange(origin, edge, sec, clipTimelineDuration(duration), bounds), duration, bounds, origin);
}

/**
 * A pointer drag of one edge, RELATIVE to the press: the edge moves by the
 * pointer's travel since the press (`dxPx` on a track `trackWidth` px wide), never
 * to the time under the pointer. The handles sit OUTSIDE the selection and their
 * hit area is wider still, so a finger lands 8–20 px from the edge it grabs — an
 * absolute mapping jumped the edge by that grab offset on the first pixel (and, at
 * the maximum length, dragged the whole window along). Same model as a window drag.
 */
export function dragEdgeByPixels(
  origin: ClipRange,
  edge: 'start' | 'end',
  dxPx: number,
  trackWidth: number,
  duration: number,
  bounds: ClipBounds,
): ClipRange {
  if (!Number.isFinite(dxPx) || dxPx === 0) return origin;
  return dragEdge(origin, edge, origin[edge] + secondsForPixels(dxPx, trackWidth, duration), duration, bounds);
}

/**
 * A time typed by hand (the trimmer's no-preview fallback): plain seconds
 * (`12`, `12.5`, `12,5` — a French decimal comma) or a clock `m:ss(.s)` /
 * `h:mm:ss(.s)` like the readouts show. null for anything else (empty, negative,
 * a seconds/minutes field ≥ 60 inside a clock, not a number).
 */
export function parseClipTimeInput(text: string): number | null {
  const s = text.trim().replace(/,/g, '.');
  if (!s) return null;
  if (/^\d+(\.\d*)?$|^\.\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d*)?)$/.exec(s);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min >= 60 && m[1] !== undefined) return null;
  if (sec >= 60) return null;
  const total = h * 3600 + min * 60 + sec;
  return Number.isFinite(total) ? total : null;
}

/** Seconds as a hand-editable field value: one decimal only when it has one (`12`, `12.5`). */
export function clipTimeInputValue(sec: number): string {
  return Number.isFinite(sec) ? String(roundClipTime(sec)) : '';
}

/** Drag the whole window (from the range at gesture start) by `deltaSec`. */
export function dragWindow(origin: ClipRange, deltaSec: number, duration: number, bounds: ClipBounds): ClipRange {
  return commitRange(shiftClipRange(origin, deltaSec, clipTimelineDuration(duration)), duration, bounds, origin);
}

/** Canvas size for a captured frame: the video's own aspect, `maxHeight` tall (never upscaled, integer px, never 0). */
export function frameCanvasSize(videoWidth: number, videoHeight: number, maxHeight: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(videoWidth) || 1);
  const h = Math.max(1, Math.round(videoHeight) || 1);
  const height = Math.max(1, Math.min(h, Math.round(maxHeight)));
  return { width: Math.max(1, Math.round((w / h) * height)), height };
}

/** Canvas size for a full frame bounded by `maxEdge` on the long side (never upscaled). */
export function fitFrameLongEdge(videoWidth: number, videoHeight: number, maxEdge: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(videoWidth) || 1);
  const h = Math.max(1, Math.round(videoHeight) || 1);
  const long = Math.max(w, h);
  if (long <= maxEdge) return { width: w, height: h };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
