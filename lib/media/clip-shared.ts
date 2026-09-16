// 视频截取 — the pure contract shared by the in-browser trimmer
// (components/media/VideoTrimmer.tsx) and every server route that renders a
// clip (today: 名片 POST /api/me/profile/media/clip). Import-free and
// client-safe, so the handle the member drags and the range the server cuts
// can never disagree about rounding, bounds or the length cap.
//
// Times are seconds (floats). They are rounded to CLIP_TIME_STEP on both sides:
// the UI shows tenths, and a range that survived a JSON round trip must
// normalise to the same value the trimmer displayed.

export const CLIP_TIME_STEP = 0.1;
/** Shortest clip any surface may cut — a 0-frame range is never meaningful. */
export const CLIP_MIN_LENGTH_DEFAULT = 1;

export interface ClipRange {
  start: number;
  end: number;
}

/** A rendered clip as stored beside the media it was cut from. */
export interface StoredClip extends ClipRange {
  /** Frame used as the poster, inside [start, end]. */
  cover: number;
  /** Duration of the SOURCE when the clip was cut (so an editor can open at the old range without re-probing). */
  duration: number;
}

/**
 * Round to CLIP_TIME_STEP; never negative, never -0. The epsilon keeps a value
 * the UI displayed (9.95 → 99.4999… tenths in binary) rounding the way a
 * person reads it, so a dragged 9.95 is stored as 10.0, not 9.9.
 */
export function roundClipTime(sec: number): number {
  const v = Number((Math.round(sec / CLIP_TIME_STEP + 1e-6) * CLIP_TIME_STEP).toFixed(1));
  return v > 0 ? v : 0;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Floor to CLIP_TIME_STEP (epsilon absorbs 0.6 / 0.1 = 5.999…) — a clip may never end past its source. */
function floorClipTime(sec: number): number {
  return Number((Math.floor(sec / CLIP_TIME_STEP + 1e-6) * CLIP_TIME_STEP).toFixed(1));
}

export interface ClipBounds {
  /** Longest allowed clip, seconds. */
  maxLength: number;
  /** Shortest allowed clip, seconds (clamped down to the source duration for very short sources). */
  minLength?: number;
}

/**
 * The range a source of `duration` seconds yields when nothing was chosen:
 * the whole thing when it fits, otherwise the first `maxLength` seconds.
 */
export function defaultClipRange(duration: number, bounds: ClipBounds): ClipRange {
  if (!finite(duration) || duration <= 0) return { start: 0, end: 0 };
  return { start: 0, end: Number(Math.min(floorClipTime(duration) || duration, bounds.maxLength).toFixed(1)) };
}

/**
 * Clamp any requested range into a valid one for this source, or null when
 * the request is not numbers / the source has no duration. Never throws.
 *
 *  - start ∈ [0, duration − minLength]
 *  - end   ∈ [start + minLength, min(duration, start + maxLength)]
 *  - a source shorter than minLength yields its whole length
 */
export function normalizeClipRange(raw: unknown, duration: number, bounds: ClipBounds): ClipRange | null {
  if (!raw || typeof raw !== 'object') return null;
  const { start, end } = raw as Record<string, unknown>;
  if (!finite(start) || !finite(end) || !finite(duration) || duration <= 0) return null;
  const dur = floorClipTime(duration) || duration;
  const maxLength = Math.max(CLIP_TIME_STEP, bounds.maxLength);
  const minLength = Math.min(Math.max(CLIP_TIME_STEP, bounds.minLength ?? CLIP_MIN_LENGTH_DEFAULT), dur, maxLength);

  let s = roundClipTime(Math.min(Math.max(0, start), Math.max(0, dur - minLength)));
  let e = roundClipTime(Math.min(Math.max(end, s + minLength), dur, s + maxLength));
  if (e - s < minLength - 1e-9) {
    // Only reachable through rounding at the very end of the source.
    s = roundClipTime(Math.max(0, e - minLength));
  }
  e = Number(e.toFixed(1));
  s = Number(s.toFixed(1));
  return e > s ? { start: s, end: e } : null;
}

/** Cover frame inside the range; defaults to half a second in (skipping a black first frame) or the midpoint of a tiny clip. */
export function normalizeCover(cover: unknown, range: ClipRange): number {
  const len = range.end - range.start;
  const fallback = roundClipTime(range.start + Math.min(0.5, len / 2));
  if (!finite(cover)) return fallback;
  return roundClipTime(Math.min(Math.max(cover, range.start), range.end - Math.min(CLIP_TIME_STEP, len / 2)));
}

/** Move the whole window by `delta`, keeping its length, inside [0, duration]. */
export function shiftClipRange(range: ClipRange, delta: number, duration: number): ClipRange {
  const len = range.end - range.start;
  const start = roundClipTime(Math.min(Math.max(0, range.start + delta), Math.max(0, duration - len)));
  return { start, end: Number((start + len).toFixed(1)) };
}

/**
 * Drag one edge to `value`, honouring the bounds. Dragging the start past the
 * max length pulls the end along (and vice versa) so the window never exceeds
 * `maxLength` — the gesture a member expects from a trim bar.
 */
export function resizeClipRange(
  range: ClipRange,
  edge: 'start' | 'end',
  value: number,
  duration: number,
  bounds: ClipBounds,
): ClipRange {
  const minLength = Math.min(bounds.minLength ?? CLIP_MIN_LENGTH_DEFAULT, duration);
  if (edge === 'start') {
    const start = roundClipTime(Math.min(Math.max(0, value), Math.max(0, range.end - minLength)));
    const end = range.end - start > bounds.maxLength ? roundClipTime(start + bounds.maxLength) : range.end;
    return { start, end: Math.min(end, duration) };
  }
  const end = roundClipTime(Math.max(Math.min(duration, value), range.start + minLength));
  const start = end - range.start > bounds.maxLength ? roundClipTime(end - bounds.maxLength) : range.start;
  return { start: Math.max(0, start), end };
}

/** `m:ss.s` (or `h:mm:ss.s`) — the one time format a trimmer shows. */
export function formatClipTime(sec: number): string {
  const t = finite(sec) && sec > 0 ? roundClipTime(sec) : 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Evenly spaced thumbnail timestamps for a filmstrip of `count` frames (centre of each slot). */
export function filmstripTimes(duration: number, count: number): number[] {
  if (!finite(duration) || duration <= 0 || count <= 0) return [];
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => Number((((i + 0.5) * duration) / n).toFixed(2)));
}

/** Parse a stored / posted clip (`{start,end,cover,duration}`); null when any field is not a sane number. */
export function parseStoredClip(raw: unknown): StoredClip | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (![o.start, o.end, o.cover, o.duration].every(finite)) return null;
  const duration = o.duration as number;
  if (duration <= 0) return null;
  const range = normalizeClipRange({ start: o.start, end: o.end }, duration, { maxLength: Number.MAX_SAFE_INTEGER, minLength: CLIP_TIME_STEP });
  if (!range) return null;
  return { ...range, cover: normalizeCover(o.cover, range), duration: roundClipTime(duration) };
}
