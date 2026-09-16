'use client';

// 视频截取 — the reusable in-browser trimmer. Controlled, NO network of its own
// (it only plays `src`), and no knowledge of where the clip goes: the 名片 editor
// uses it through <VideoTrimDialog/>, and any upload flow (shorts, votes, zones,
// discussion) can drop it in the same way.
//
// ── Props ───────────────────────────────────────────────────────────────────
//   src           final URL: a blob: object URL of a picked file, or a
//                 withBasePath'ed same-origin URL (same-origin matters: the
//                 filmstrip draws frames onto a canvas). Changing it resets the
//                 trimmer (duration, frames, playback).
//   value         the selected ClipRange, or null until the duration is known —
//                 the trimmer then emits `defaultClipRange` (a source shorter
//                 than maxLength is selected whole). A value that does not fit
//                 the source is re-emitted normalised.
//   onChange      every range the trimmer emits has been through
//                 `normalizeClipRange` (lib/media/clip-shared.ts) — the same call
//                 the server makes on the posted body, so what the handles show
//                 is exactly what gets cut.
//   maxLength     longest selection, seconds. minLength defaults to
//                 CLIP_MIN_LENGTH_DEFAULT (1 s).
//   cover         cover frame, seconds (null ⇒ `normalizeCover(undefined, range)`).
//                 Always shown clamped into the range, like the server clamps it.
//   onCoverChange presence enables 「用当前画面作封面」 and the cover marker.
//   onDuration    the source's duration once the browser knows it.
//   onError       'decode' (the browser cannot play the codec — e.g. HEVC in some
//                 Chrome builds; a remote URL that answers 404 reports this too,
//                 the media element cannot tell them apart) or 'network' (the
//                 transfer broke). The second argument carries the duration when
//                 the metadata had already been read (a codec failure usually
//                 has it), so a host can still offer a range by numbers. The
//                 trimmer shows its own message; the host decides what to do.
//   disabled      freezes every control (e.g. while a server renders the clip).
//
// ── Behaviour ───────────────────────────────────────────────────────────────
//   · The preview loops the selection (rAF while playing + `timeupdate` for
//     throttled background tabs): past `end` it seeks back to `start`. Muted by
//     default; autoplays muted unless the viewer prefers reduced motion (then it
//     rests on the cover frame).
//   · Timeline: filmstrip (4–12 thumbnails — as many as fit the track at the
//     video's own aspect — captured client-side, object URLs revoked on unmount
//     / src change, skipped silently when the codec cannot be decoded), the selection as an ink frame with two grip
//     handles (outside the window, so a 1 s selection still has two grabbable
//     handles), the rest dimmed, a thin playhead.
//   · Handles are role="slider": ←/→ ±0.1 s, Shift ±1 s, PageUp/PageDown ±10 s,
//     Home/End. The window body is a slider too (moves both edges). Every drag is
//     RELATIVE to the press (an edge or the window moves by the pointer's travel,
//     never to the time under it — the grab point sits outside the edge).
//     Dragging a handle scrubs the preview to that edge; releasing resumes the
//     loop if it was playing. A press on the window without travel seeks inside it.
//   · Clicking the track seeks the playhead (snapped into the selection while
//     playing — the loop would yank it back anyway). Mouse can scrub by
//     dragging; touch seeks on tap only, so a finger can still scroll the page.
//   · `touch-action: none` sits ONLY on the handles and the window.
//   · Bytes: a blob: source preloads `auto` (it is local); a remote one preloads
//     `metadata` only, and the filmstrip's own detached element does too — it
//     seeks to each thumbnail time and fetches just those ranges. Two `auto`
//     elements downloaded an owner-only original twice.
//   · Per-frame updates (playhead, clock, cover badge) are written straight to
//     the DOM — a 60 fps React re-render of the whole trimmer buys nothing.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ImageIcon, Loader2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import {
  CLIP_MIN_LENGTH_DEFAULT,
  filmstripTimes,
  formatClipTime,
  normalizeCover,
  roundClipTime,
  type ClipRange,
} from '@/lib/media/clip-shared';
import { captureFilmstrip } from './filmstrip';
import {
  DRAG_SLOP_PX,
  FILMSTRIP_HEIGHT_PX,
  dragEdgeByPixels,
  dragWindow,
  filmstripFrameCount,
  initialRangeFor,
  isWholeSource,
  loopJumpTarget,
  nudgeRange,
  rangesEqual,
  ratioOf,
  secondsForPixels,
  snapIntoRange,
  timeAtClientX,
  type TrimTarget,
} from './trim-math';

export interface VideoTrimmerProps {
  /** Final URL (blob: or withBasePath'ed same-origin URL). */
  src: string;
  /** null until the duration is known → the trimmer emits defaultClipRange. */
  value: ClipRange | null;
  onChange: (range: ClipRange) => void;
  /** Seconds. */
  maxLength: number;
  /** Seconds; default CLIP_MIN_LENGTH_DEFAULT. */
  minLength?: number;
  /** Optional cover frame, seconds. */
  cover?: number | null;
  /** Presence enables 「用当前画面作封面」. */
  onCoverChange?: (sec: number) => void;
  onDuration?: (sec: number) => void;
  /**
   * Upper bound for the timeline, seconds — the length a server probe measured
   * for the PICTURE (e.g. the upload's durationSec). A file whose audio outlasts
   * its video reports the longer track to the browser; without this cap the
   * member could select seconds the server will clamp away.
   */
  maxDuration?: number | null;
  /** `info.duration`: the source's length when the metadata was read before the failure, else null. */
  onError?: (reason: 'decode' | 'network', info: { duration: number | null }) => void;
  disabled?: boolean;
  className?: string;
}

/** A new `src` is a new trimmer: keying the inner component resets duration, frames and playback in one move. */
export function VideoTrimmer(props: VideoTrimmerProps) {
  return <TrimmerInner key={props.src} {...props} />;
}

type Gesture = {
  kind: TrimTarget | 'scrub';
  pointerId: number;
  startX: number;
  origin: ClipRange;
  wasPlaying: boolean;
  moved: boolean;
};

const MEDIA_ERR_NETWORK = 2;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function TrimmerInner({
  src,
  value,
  onChange,
  maxLength,
  minLength = CLIP_MIN_LENGTH_DEFAULT,
  cover = null,
  onCoverChange,
  onDuration,
  maxDuration = null,
  onError,
  disabled = false,
  className = '',
}: VideoTrimmerProps) {
  const t = useTranslations('ui');
  const locale = useLocale();

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const coverBadgeRef = useRef<HTMLSpanElement>(null);

  const [sourceDuration, setSourceDuration] = useState(0);
  // The timeline the member edits: the browser's duration, capped at the
  // server-known picture length when the host knows it.
  const duration =
    maxDuration != null && maxDuration > 0 && sourceDuration > 0 ? Math.min(sourceDuration, maxDuration) : sourceDuration;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorReason, setErrorReason] = useState<'decode' | 'network'>('decode');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [frames, setFrames] = useState<(string | null)[]>([]);
  const [dragging, setDragging] = useState<Gesture['kind'] | null>(null);
  const [coverAnnounce, setCoverAnnounce] = useState('');

  const bounds = useMemo(() => ({ maxLength, minLength }), [maxLength, minLength]);
  // What the trimmer shows: the value normalised for this source (or the
  // default range). Rendering THIS — not `value` — means no empty first frame
  // while the host echoes the emitted default back.
  const range = useMemo(() => initialRangeFor(value, duration, bounds), [value, duration, bounds]);
  const coverSec = range && onCoverChange ? normalizeCover(cover ?? undefined, range) : null;

  // Latest values for handlers that outlive a render (rAF, media events, gestures).
  const rangeRef = useRef<ClipRange | null>(range);
  const durationRef = useRef(duration);
  const coverRef = useRef<number | null>(coverSec);
  const gestureRef = useRef<Gesture | null>(null);
  const probingRef = useRef(false);
  const failedRef = useRef(false);
  const acceptedRef = useRef(false);
  const autoplayedRef = useRef(false);
  const pointerTypeRef = useRef<string>('mouse');
  const seekRafRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onChange, onDuration, onError, onCoverChange });
  useEffect(() => {
    rangeRef.current = range;
    durationRef.current = duration;
    coverRef.current = coverSec;
    callbacksRef.current = { onChange, onDuration, onError, onCoverChange };
  });

  // Report the EFFECTIVE duration — again when a later maxDuration shortens it.
  useEffect(() => {
    if (duration > 0) callbacksRef.current.onDuration?.(duration);
  }, [duration]);

  // ── emit the default / normalised range once the duration is known ─────────
  useEffect(() => {
    if (range && !rangesEqual(range, value)) callbacksRef.current.onChange(range);
  }, [range, value]);

  // ── per-frame DOM writes ──────────────────────────────────────────────────
  const paint = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const time = v.currentTime;
    const d = durationRef.current;
    if (playheadRef.current) playheadRef.current.style.left = `${ratioOf(time, d) * 100}%`;
    if (clockRef.current) clockRef.current.textContent = formatClipTime(time);
    if (coverBadgeRef.current) {
      const c = coverRef.current;
      // style, not the `hidden` attribute: the badge's inline-flex class would beat the UA [hidden] rule.
      coverBadgeRef.current.style.display = c != null && v.paused && Math.abs(time - c) < 0.06 ? '' : 'none';
    }
  }, []);

  useEffect(() => {
    paint();
  }, [paint, range, duration, coverSec, playing]);

  const emit = useCallback((next: ClipRange) => {
    if (rangesEqual(next, rangeRef.current)) return;
    rangeRef.current = next;
    callbacksRef.current.onChange(next);
  }, []);

  const seekNow = useCallback(
    (sec: number) => {
      const v = videoRef.current;
      if (!v) return;
      if (seekRafRef.current) {
        cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = 0;
      }
      pendingSeekRef.current = null;
      v.currentTime = Math.max(0, sec);
      paint();
    },
    [paint],
  );

  /** Coalesce drag / key seeks to one per frame — a fast drag fires far more pointer events than a decoder can seek. */
  const seekSoon = useCallback(
    (sec: number) => {
      pendingSeekRef.current = sec;
      if (seekRafRef.current) return;
      seekRafRef.current = requestAnimationFrame(() => {
        seekRafRef.current = 0;
        const v = videoRef.current;
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (v && target != null) {
          v.currentTime = Math.max(0, target);
          paint();
        }
      });
    },
    [paint],
  );

  useEffect(() => {
    const v = videoRef.current;
    return () => {
      if (seekRafRef.current) cancelAnimationFrame(seekRafRef.current);
      // Release the decoder (and a blob URL's bytes) on a REAL unmount only: the
      // element is detached by then. React's dev double-mount runs this cleanup on
      // a live element, and stripping its src there would leave the preview blank
      // (the src prop has not changed, so React never sets it again).
      if (v && !v.isConnected) {
        v.pause();
        v.removeAttribute('src');
        try {
          v.load();
        } catch {
          /* torn down */
        }
      }
    };
  }, []);

  // ── media element lifecycle ───────────────────────────────────────────────
  const fail = useCallback((reason: 'decode' | 'network') => {
    if (failedRef.current) return;
    failedRef.current = true;
    setErrorReason(reason);
    setStatus('error');
    const d = videoRef.current?.duration;
    callbacksRef.current.onError?.(reason, { duration: typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null });
  }, []);

  /**
   * Decide whether the source is trimmable yet. Called from every media event
   * that can carry the answer; `final` once the element has data (no more
   * metadata is coming), so a missing picture is then a decode failure.
   */
  const evaluateSource = useCallback(
    (final: boolean) => {
      const v = videoRef.current;
      if (!v || failedRef.current || acceptedRef.current) return;
      // Audio-only, or a video track this browser cannot decode (it may still
      // play the sound): there is no picture to trim against.
      if (!(v.videoWidth > 0 && v.videoHeight > 0)) {
        if (final) fail('decode');
        // A `metadata` preload may stop right here and never deliver the data that
        // would settle it either way: let it read on until loadeddata / error.
        else if (v.preload !== 'auto') v.preload = 'auto';
        return;
      }
      if (Number.isFinite(v.duration) && v.duration > 0) {
        acceptedRef.current = true;
        setSourceDuration(v.duration);
        setStatus('ready');
        return;
      }
      // Recorded / streamed WebM often reports Infinity until the end has been
      // seen: seek far past it, the durationchange that follows carries the value.
      if (!probingRef.current) {
        probingRef.current = true;
        v.currentTime = Number.MAX_SAFE_INTEGER;
      }
    },
    [fail],
  );

  function onDurationChange() {
    const v = videoRef.current;
    if (!v || !probingRef.current || !Number.isFinite(v.duration) || !(v.duration > 0)) return;
    probingRef.current = false;
    v.currentTime = 0;
    evaluateSource(true);
  }

  function onMediaError() {
    const v = videoRef.current;
    fail(v?.error?.code === MEDIA_ERR_NETWORK ? 'network' : 'decode');
  }

  // Start the loop (or rest on the cover) the first time the source is ready.
  useEffect(() => {
    if (status !== 'ready' || !range || autoplayedRef.current) return;
    autoplayedRef.current = true;
    const v = videoRef.current;
    if (!v) return;
    if (prefersReducedMotion()) {
      seekNow(coverRef.current ?? range.start);
      return;
    }
    seekNow(range.start);
    void v.play().catch(() => setPlaying(false));
  }, [status, range, seekNow]);

  // ── loop engine ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      const r = rangeRef.current;
      if (v && r && !gestureRef.current) {
        const jump = loopJumpTarget(v.currentTime, r);
        if (jump != null) v.currentTime = jump;
      }
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, paint]);

  function onTimeUpdate() {
    // rAF is paused in a background tab; timeupdate (~4 Hz) keeps the loop honest there.
    const v = videoRef.current;
    const r = rangeRef.current;
    if (v && r && !v.paused && !gestureRef.current) {
      const jump = loopJumpTarget(v.currentTime, r);
      if (jump != null) v.currentTime = jump;
    }
    paint();
  }

  function onEnded() {
    const v = videoRef.current;
    const r = rangeRef.current;
    if (!v || !r || gestureRef.current) return;
    v.currentTime = r.start;
    void v.play().catch(() => setPlaying(false));
  }

  // If the selection moves away from the playhead while playing, restart at the new start.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !range || v.paused || gestureRef.current) return;
    if (v.currentTime < range.start - 0.05 || v.currentTime >= range.end) v.currentTime = range.start;
  }, [range]);

  // ── filmstrip ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready' || !(duration > 0)) return;
    const controller = new AbortController();
    const urls: string[] = [];
    const v = videoRef.current;
    // Counted once, from the track as laid out when the source became ready;
    // a later resize just stretches the slots (object-cover) instead of re-decoding.
    const count = filmstripFrameCount(trackRef.current?.clientWidth ?? 0, v && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9);
    const times = filmstripTimes(duration, count);
    setFrames(times.map(() => null));
    void captureFilmstrip(
      src,
      times,
      (i, url) => {
        urls.push(url);
        setFrames((prev) => {
          const next = prev.length === times.length ? [...prev] : times.map(() => null);
          next[i] = url;
          return next;
        });
      },
      { signal: controller.signal, frameHeight: FILMSTRIP_HEIGHT_PX * 2 },
    );
    return () => {
      controller.abort();
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [status, duration, src]);

  // ── transport ─────────────────────────────────────────────────────────────
  function togglePlay() {
    const v = videoRef.current;
    const r = rangeRef.current;
    if (!v || !r || status !== 'ready') return;
    if (v.paused) {
      if (v.currentTime < r.start || v.currentTime >= r.end - 0.05) v.currentTime = r.start;
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }

  function setCoverFromPlayhead() {
    const v = videoRef.current;
    const r = rangeRef.current;
    if (!v || !r || !onCoverChange) return;
    const next = normalizeCover(v.currentTime, r);
    v.pause();
    seekNow(next);
    onCoverChange(next);
    setCoverAnnounce(t('trim_cover_set', { time: formatClipTime(next) }));
  }

  // ── gestures ──────────────────────────────────────────────────────────────
  function trackBox(): { left: number; width: number } | null {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? { left: rect.left, width: rect.width } : null;
  }

  const edgePreviewTime = (r: ClipRange, edge: 'start' | 'end') => (edge === 'start' ? r.start : Math.max(r.start, r.end - 0.05));

  function beginGesture(kind: Gesture['kind'], e: ReactPointerEvent<HTMLElement>) {
    pointerTypeRef.current = e.pointerType;
    if (disabled || status !== 'ready' || !range) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    if (kind !== 'scrub') e.currentTarget.focus({ preventScroll: true });
    const v = videoRef.current;
    const wasPlaying = !!v && !v.paused;
    gestureRef.current = { kind, pointerId: e.pointerId, startX: e.clientX, origin: range, wasPlaying, moved: false };
    if (kind === 'start' || kind === 'end') {
      v?.pause();
      seekSoon(edgePreviewTime(range, kind));
    }
    setDragging(kind);
  }

  function moveGesture(e: ReactPointerEvent<HTMLElement>) {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const box = trackBox();
    const d = durationRef.current;
    if (!box || !(d > 0)) return;
    if (g.kind === 'start' || g.kind === 'end') {
      g.moved = true;
      // Relative to the press, never "edge = time under the pointer": the grab point sits
      // 8–20 px outside the edge (handle + hit area), which would jump it on the first pixel.
      const next = dragEdgeByPixels(g.origin, g.kind, e.clientX - g.startX, box.width, d, bounds);
      emit(next);
      seekSoon(edgePreviewTime(next, g.kind));
    } else if (g.kind === 'window') {
      const dx = e.clientX - g.startX;
      if (!g.moved && Math.abs(dx) < DRAG_SLOP_PX) return;
      if (!g.moved) {
        g.moved = true;
        videoRef.current?.pause();
      }
      const next = dragWindow(g.origin, secondsForPixels(dx, box.width, d), d, bounds);
      emit(next);
      seekSoon(next.start);
    } else {
      g.moved = true;
      seekSoon(timeAtClientX(e.clientX, box.left, box.width, d));
    }
  }

  function endGesture(e: ReactPointerEvent<HTMLElement>, cancelled: boolean) {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    setDragging(null);
    const v = videoRef.current;
    const r = rangeRef.current;
    if (!v || !r) return;
    if (g.kind === 'window' && !g.moved) {
      if (cancelled) return;
      // A press without travel on the selection = click-to-seek inside it.
      const box = trackBox();
      if (box) {
        const sec = timeAtClientX(e.clientX, box.left, box.width, durationRef.current);
        seekNow(g.wasPlaying ? snapIntoRange(sec, r) : Math.min(Math.max(sec, r.start), r.end));
      }
      return;
    }
    if (g.wasPlaying) {
      seekNow(r.start);
      void v.play().catch(() => setPlaying(false));
    }
  }

  function onTrackPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    pointerTypeRef.current = e.pointerType;
    // Touch seeks on tap (click) only: a finger starting a page scroll here must not move the playhead.
    if (e.pointerType === 'touch') return;
    if ((e.target as Element).closest('[data-trim-control]')) return;
    if (disabled || status !== 'ready' || !range) return;
    if (e.button !== 0) return;
    const v = videoRef.current;
    const box = trackBox();
    if (!v || !box) return;
    const sec = timeAtClientX(e.clientX, box.left, box.width, duration);
    if (!v.paused) {
      seekNow(snapIntoRange(sec, range));
      return;
    }
    seekNow(sec);
    beginGesture('scrub', e);
  }

  function onTrackClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (pointerTypeRef.current !== 'touch') return;
    if ((e.target as Element).closest('[data-trim-control]')) return;
    if (disabled || status !== 'ready' || !range) return;
    const v = videoRef.current;
    const box = trackBox();
    if (!v || !box) return;
    const sec = timeAtClientX(e.clientX, box.left, box.width, duration);
    seekNow(v.paused ? sec : snapIntoRange(sec, range));
  }

  function onSliderKey(target: TrimTarget, e: ReactKeyboardEvent<HTMLElement>) {
    if (disabled || !range || !(duration > 0)) return;
    const next = nudgeRange(range, target, e.key, e.shiftKey, duration, bounds);
    if (!next) return;
    e.preventDefault();
    if (rangesEqual(next, range)) return;
    emit(next);
    const v = videoRef.current;
    if (v && v.paused) seekSoon(target === 'end' ? edgePreviewTime(next, 'end') : next.start);
  }

  // ── render ────────────────────────────────────────────────────────────────
  const oneDecimal = useMemo(() => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), [locale]);
  const upToOneDecimal = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);

  const ready = status === 'ready' && !!range && duration > 0;
  const startPct = ready ? ratioOf(range.start, duration) * 100 : 0;
  const endPct = ready ? ratioOf(range.end, duration) * 100 : 100;
  const lengthSec = ready ? roundClipTime(range.end - range.start) : 0;
  const whole = ready && isWholeSource(range, duration);
  const controlsOff = disabled || !ready;
  const effectiveMin = Math.min(minLength, duration);
  const coverPct = ready && coverSec != null ? ratioOf(coverSec, duration) * 100 : 0;

  const ink = 'bg-zinc-900 dark:bg-zinc-100';
  const grip = 'block h-3.5 w-[3px] rounded-full bg-white/90 dark:bg-zinc-900/80';
  const iconBtn =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:focus-visible:ring-zinc-100/30';

  return (
    <div className={`min-w-0 ${className}`}>
      {/* Preview */}
      {/* Once the source failed there is no picture to reserve room for: the panel shrinks to its message. */}
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-inset ring-black/10 dark:ring-white/10 ${
          status === 'error' ? 'min-h-[7.5rem]' : 'h-[min(42vh,340px)] min-h-[180px]'
        }`}
      >
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload={src.startsWith('blob:') ? 'auto' : 'metadata'}
          disablePictureInPicture
          className={status === 'error' ? 'invisible absolute inset-0 h-full w-full' : 'h-full w-full object-contain'}
          onLoadedMetadata={() => evaluateSource(false)}
          onLoadedData={() => evaluateSource(true)}
          onCanPlay={() => evaluateSource(true)}
          onDurationChange={onDurationChange}
          onError={onMediaError}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={onTimeUpdate}
          onSeeked={paint}
          onEnded={onEnded}
          onVolumeChange={() => setMuted(!!videoRef.current?.muted)}
          onClick={() => {
            if (!disabled) togglePlay();
          }}
        />
        {status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-zinc-300">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
            <span>{t('trim_loading')}</span>
          </div>
        )}
        {status === 'error' && (
          <div role="alert" className="relative flex flex-col items-center justify-center gap-2 px-6 py-6 text-center text-sm leading-relaxed text-zinc-300">
            <AlertTriangle className="h-5 w-5 text-zinc-400" aria-hidden />
            {/* A blob: source is a local file, so a failure can only be the codec; a
                remote one that fails "unsupported" may just as well be a 404. */}
            <span>
              {errorReason === 'network' ? t('trim_err_network') : src.startsWith('blob:') ? t('trim_err_decode') : t('trim_err_load')}
            </span>
          </div>
        )}
        {onCoverChange && (
          <span
            ref={coverBadgeRef}
            style={{ display: 'none' }}
            className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-zinc-950/70 px-1.5 py-0.5 text-[11px] font-medium text-white"
          >
            <ImageIcon className="h-3 w-3" aria-hidden />
            {t('trim_cover')}
          </span>
        )}
      </div>

      {/* Nothing below means anything without a playable source: the error panel stands alone. */}
      {status !== 'error' && (
        <>
          {/* Transport */}
          <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1.5">
            <button
              type="button"
              onClick={togglePlay}
              disabled={controlsOff}
              aria-label={playing ? t('trim_pause') : t('trim_play')}
              title={playing ? t('trim_pause') : t('trim_play')}
              className={iconBtn}
            >
              {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              disabled={controlsOff}
              aria-pressed={!muted}
              aria-label={muted ? t('trim_unmute') : t('trim_mute')}
              title={muted ? t('trim_unmute') : t('trim_mute')}
              className={iconBtn}
            >
              {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
            </button>
            <span className="ml-1 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              <span ref={clockRef} className="text-zinc-900 dark:text-zinc-100">
                {formatClipTime(0)}
              </span>
              <span aria-hidden> / </span>
              {formatClipTime(duration)}
            </span>
            {onCoverChange && (
              <button
                type="button"
                onClick={setCoverFromPlayhead}
                disabled={controlsOff}
                className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100/30"
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                {t('trim_set_cover')}
              </button>
            )}
          </div>

          {/* Timeline — side padding leaves room for the handles, which sit OUTSIDE the selection */}
          <div role="group" aria-label={t('trim_timeline')} className={`mt-2 select-none px-4 ${controlsOff ? 'opacity-60' : ''}`}>
            {/* Owns move / up / cancel for every gesture: a captured pointer's events still bubble here from the handle or window. */}
            <div
              ref={trackRef}
              className={`relative h-12 rounded-md bg-zinc-200 dark:bg-zinc-800 ${controlsOff ? '' : 'cursor-pointer'}`}
              onPointerDown={onTrackPointerDown}
              onPointerMove={moveGesture}
              onPointerUp={(e) => endGesture(e, false)}
              onPointerCancel={(e) => endGesture(e, true)}
              onLostPointerCapture={(e) => endGesture(e, true)}
              onClick={onTrackClick}
            >
              <div className="absolute inset-0 flex overflow-hidden rounded-md" aria-hidden>
                {frames.map((url, i) => (
                  <div key={i} className="h-full min-w-0 flex-1 overflow-hidden border-r border-black/10 last:border-r-0 dark:border-white/5">
                    {url && (
                      // eslint-disable-next-line @next/next/no-img-element -- local object URL of a captured frame
                      <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
                    )}
                  </div>
                ))}
              </div>

              {ready && (
                <>
                  {/* Outside the selection: dimmed */}
                  <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-white/75 dark:bg-zinc-950/70" style={{ width: `${startPct}%` }} aria-hidden />
                  <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md bg-white/75 dark:bg-zinc-950/70" style={{ width: `${100 - endPct}%` }} aria-hidden />

                  {/* Selection body: ink frame, draggable, slider for keyboard moves */}
                  <div
                    role="slider"
                    data-trim-control=""
                    tabIndex={disabled ? -1 : 0}
                    aria-label={t('trim_window_label')}
                    aria-valuemin={0}
                    aria-valuemax={roundClipTime(Math.max(0, duration - (range.end - range.start)))}
                    aria-valuenow={range.start}
                    aria-valuetext={t('trim_window_value', { start: formatClipTime(range.start), end: formatClipTime(range.end) })}
                    aria-disabled={disabled || undefined}
                    className={`absolute inset-y-0 z-10 touch-none border-y-[3px] border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 focus-visible:ring-offset-0 dark:border-zinc-100 dark:focus-visible:ring-zinc-100/40 ${
                      disabled ? '' : dragging === 'window' ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                    style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
                    onPointerDown={(e) => beginGesture('window', e)}
                    onKeyDown={(e) => onSliderKey('window', e)}
                  />

                  {/* Handles — outside the window edges; ≥ 28 px hit area via ::before */}
                  <div
                    role="slider"
                    data-trim-control=""
                    tabIndex={disabled ? -1 : 0}
                    aria-label={t('trim_start_label')}
                    aria-valuemin={0}
                    aria-valuemax={roundClipTime(Math.max(0, range.end - effectiveMin))}
                    aria-valuenow={range.start}
                    aria-valuetext={formatClipTime(range.start)}
                    aria-disabled={disabled || undefined}
                    className={`absolute -inset-y-px z-20 flex w-4 -translate-x-full touch-none items-center justify-center rounded-l-lg ${ink} before:absolute before:-inset-x-1.5 before:-inset-y-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950 ${
                      disabled ? '' : 'cursor-ew-resize'
                    }`}
                    style={{ left: `${startPct}%` }}
                    onPointerDown={(e) => beginGesture('start', e)}
                    onKeyDown={(e) => onSliderKey('start', e)}
                  >
                    <span className={grip} aria-hidden />
                  </div>
                  <div
                    role="slider"
                    data-trim-control=""
                    tabIndex={disabled ? -1 : 0}
                    aria-label={t('trim_end_label')}
                    aria-valuemin={roundClipTime(Math.min(duration, range.start + effectiveMin))}
                    aria-valuemax={roundClipTime(duration)}
                    aria-valuenow={range.end}
                    aria-valuetext={formatClipTime(range.end)}
                    aria-disabled={disabled || undefined}
                    className={`absolute -inset-y-px z-20 flex w-4 touch-none items-center justify-center rounded-r-lg ${ink} before:absolute before:-inset-x-1.5 before:-inset-y-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950 ${
                      disabled ? '' : 'cursor-ew-resize'
                    }`}
                    style={{ left: `${endPct}%` }}
                    onPointerDown={(e) => beginGesture('end', e)}
                    onKeyDown={(e) => onSliderKey('end', e)}
                  >
                    <span className={grip} aria-hidden />
                  </div>

                  {/* Playhead */}
                  <div
                    ref={playheadRef}
                    className="pointer-events-none absolute -bottom-1 -top-1 z-[15] w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                    style={{ left: '0%' }}
                    aria-hidden
                  />
                </>
              )}
            </div>

            {/* Cover marker lane */}
            {onCoverChange && (
              <div className="relative h-6" aria-hidden={!ready || undefined}>
                {ready && coverSec != null && (
                  <button
                    type="button"
                    data-trim-control=""
                    disabled={disabled}
                    onClick={() => {
                      videoRef.current?.pause();
                      seekNow(coverSec);
                    }}
                    aria-label={t('trim_cover_jump', { time: formatClipTime(coverSec) })}
                    title={t('trim_cover_jump', { time: formatClipTime(coverSec) })}
                    className="absolute top-1 inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full bg-zinc-900 px-1.5 text-[10px] font-medium leading-none text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 focus-visible:ring-offset-1 disabled:cursor-default motion-reduce:transition-none dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    // Kept INSIDE the lane at both ends: the chip's own p% sits on the lane's p%
                    // (translateX(-p%) of its width), so at 0 % it starts at the left edge and at
                    // 100 % it ends at the right one. Centring it (-50 %) pushed a wide label
                    // ("Couverture") past the dialog edge, clipped at the start and scrollable at the end.
                    style={{ left: `${coverPct}%`, transform: `translateX(-${coverPct}%)` }}
                  >
                    {/* The tick sits at the same p% inside the chip, i.e. exactly over the cover time. */}
                    <span className="absolute -top-1 h-1 w-px -translate-x-1/2 bg-zinc-900 dark:bg-zinc-100" style={{ left: `${coverPct}%` }} aria-hidden />
                    <ImageIcon className="h-2.5 w-2.5" aria-hidden />
                    {t('trim_cover')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Readouts: start · length · end */}
          <div className={`${onCoverChange ? 'mt-0.5' : 'mt-2'} flex items-baseline justify-between gap-3 px-1 text-xs`}>
            <span className="min-w-0 text-zinc-500 dark:text-zinc-400">
              {t('trim_start_short')} <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{formatClipTime(ready ? range.start : 0)}</span>
            </span>
            <span className="min-w-0 text-center font-medium text-zinc-900 dark:text-zinc-100">
              {ready ? t('trim_length', { length: oneDecimal.format(lengthSec), max: upToOneDecimal.format(maxLength) }) : '—'}
              {whole && <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">· {t('trim_whole')}</span>}
            </span>
            <span className="min-w-0 text-right text-zinc-500 dark:text-zinc-400">
              {t('trim_end_short')} <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{formatClipTime(ready ? range.end : 0)}</span>
            </span>
          </div>

        </>
      )}

      <span className="sr-only" aria-live="polite">
        {coverAnnounce}
      </span>
    </div>
  );
}
