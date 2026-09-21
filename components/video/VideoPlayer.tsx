'use client';

// 长视频播放器 — a player with its OWN controls, because subtitles here are drawn
// by us (components/video/player/SubtitleOverlay.tsx): the viewer can move and
// restyle them and show 中 + EN at once, none of which a native `::cue` allows.
// That decision forces the rest: with native `controls` the fullscreen button
// fullscreens the <video> ELEMENT, and anything we draw next to it disappears —
// so the FRAME is what goes fullscreen, and the frame needs its own bar.
//
// View counting lives in <ViewPing> (counts on page open); this is playback only.
//
// ── What is in the frame ────────────────────────────────────────────────────
//   backdrop   a blurred copy of the poster behind the <video>, so a portrait
//              (or any non-16:9) video is letterboxed by its own colours, not by
//              black bars. `object-contain` always — the video is never cropped.
//   poster     <CoverImage> honouring the shared cover contract until first play.
//   subtitles  fetched + parsed VTT (useSubtitleCues), the active cue resolved
//              per animation frame while playing (timeupdate is ~4 Hz — a quarter
//              second late is visible on speech). <track> elements exist ONLY so
//              the places our overlay cannot reach (iPhone's native fullscreen,
//              Picture-in-Picture) still get captions: they are `disabled` — never
//              fetched — until one of those modes starts.
//   controls   scrubber (buffered + hover time), play, volume, time, CC, speed,
//              PiP, fullscreen. Auto-hide after 2.6 s of stillness WHILE PLAYING.
//
// ── Keyboard (when the player or a non-control inside it has focus) ──────────
//   Space / K play·pause   ← → ±5 s   J L ±10 s   ↑ ↓ volume   M mute
//   F fullscreen   C subtitles on/off   < > speed   0–9 jump to n×10 %
//
// ── The rest ────────────────────────────────────────────────────────────────
//   · Seek requests from the AI panel arrive over the watch bus (`[12:34]` links);
//     progress goes back out for the 文稿 tab (4 Hz).
//   · `?t=<seconds>` in the URL starts there; otherwise the last position of this
//     video (per browser) is resumed, with a chip offering 从头播放.
//   · While a subtitle job is running the track state is polled, so a viewer who
//     arrived right after publish gets subtitles without a reload.
//   · Per-frame writes (scrubber fill, clock) go straight to the DOM; React state
//     only changes when something a person can see as a STATE changes.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import {
  Captions,
  CaptionsOff,
  Gauge,
  Loader2,
  Lock,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CoverImage } from '@/components/media/CoverImage';
import { usePortalHost } from '@/components/usePortalHost';
import { withBasePath } from '@/lib/base-path';
import { activeCueText } from '@/lib/video/subtitles-shared';
import { bilingualOrder, resolveSubtitleMode, subtitleBaseFontPx, type SubtitleMode } from '@/lib/video/subtitle-style';
import { formatDuration } from '@/lib/video/types';
import { SubtitleOverlay, type SubtitleLine } from './player/SubtitleOverlay';
import { SubtitleSettings, type SubtitleSettingsLabels } from './player/SubtitleSettings';
import { useSubtitleCues } from './player/useSubtitleCues';
import { useSubtitlePrefs } from './player/useSubtitlePrefs';
import { onSeekRequest, publishTime } from './player/watch-bus';

export interface PlayerSubtitles {
  status: 'none' | 'processing' | 'ready' | 'failed';
  zhUrl: string | null;
  enUrl: string | null;
}

interface Props {
  src: string | null;
  poster: string | null;
  posterAspect?: string | null;
  posterPos?: string | null;
  slug: string;
  title: string;
  durationSec: number;
  subtitles: PlayerSubtitles;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const HIDE_AFTER_MS = 2600;
const CONTROL_BAR_PX = 64;
const POLL_MS = 20_000;
const POLL_MAX = 150; // ~50 min
const RESUME_MIN_SEC = 15;
const RESUME_TAIL_SEC = 30;
const RESUME_SAVE_MS = 5000;
/** A frame shorter than this cannot hold the settings popover — use a bottom sheet instead. */
const POPOVER_MIN_FRAME_HEIGHT = 420;
/** Width the settings popover takes from the frame's right edge (19rem panel + its margins). */
const SETTINGS_POPOVER_PX = 330;

const VOLUME_KEY = 'video:volume';
const resumeKey = (slug: string) => `video:pos:${slug}`;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

type VideoWithVendor = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('button, a, input, select, textarea, [role="slider"], [role="switch"], [role="radio"], [data-player-panel]');
}

export function VideoPlayer({ src, poster, posterAspect, posterPos, slug, title, durationSec, subtitles: initialSubs }: Props) {
  const t = useTranslations('video');
  const locale = useLocale();
  const portalHost = usePortalHost();

  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<VideoWithVendor>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overBar = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState(durationSec > 0 ? durationSec : 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [nativeCaptions, setNativeCaptions] = useState(false); // iPhone fullscreen / PiP
  const [controlsVisible, setControlsVisible] = useState(true);
  const [panel, setPanel] = useState<null | 'subtitles' | 'speed'>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverTime, setHoverTime] = useState<{ x: number; sec: number } | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [pipSupported, setPipSupported] = useState(false);

  // ── subtitles: track state (polled while a job runs) + cues + preferences ──
  const [subs, setSubs] = useState<PlayerSubtitles>(initialSubs);
  useEffect(() => setSubs(initialSubs), [initialSubs.status, initialSubs.zhUrl, initialSubs.enUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (subs.status !== 'processing') return;
    let polls = 0;
    let alive = true;
    const id = setInterval(async () => {
      if (++polls > POLL_MAX || document.hidden) return;
      try {
        const res = await fetch(`/api/videos/${slug}/subtitles`, { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { status: PlayerSubtitles['status']; zhUrl: string | null; enUrl: string | null };
        if (data.status !== 'processing') setSubs({ status: data.status, zhUrl: data.zhUrl, enUrl: data.enUrl });
      } catch {
        /* next tick */
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [subs.status, slug]);

  const prefs = useSubtitlePrefs(locale);
  const has = useMemo(() => ({ zh: Boolean(subs.zhUrl), en: Boolean(subs.enUrl) }), [subs.zhUrl, subs.enUrl]);
  const mode: SubtitleMode = prefs.ready ? resolveSubtitleMode(prefs.mode, has) : 'off';
  const zhCues = useSubtitleCues(mode === 'zh' || mode === 'both' ? subs.zhUrl : null);
  const enCues = useSubtitleCues(mode === 'en' || mode === 'both' ? subs.enUrl : null);
  const [cue, setCue] = useState<{ zh: string; en: string }>({ zh: '', en: '' });
  const cueRef = useRef(cue);
  cueRef.current = cue;

  const syncCue = useCallback(
    (time: number) => {
      const zh = zhCues ? activeCueText(zhCues, time) : '';
      const en = enCues ? activeCueText(enCues, time) : '';
      if (zh !== cueRef.current.zh || en !== cueRef.current.en) setCue({ zh, en });
    },
    [zhCues, enCues],
  );

  // ── per-frame DOM writes ─────────────────────────────────────────────────
  const paint = useCallback(
    (time: number) => {
      const d = videoRef.current?.duration;
      const total = d && Number.isFinite(d) ? d : duration;
      const ratio = total > 0 ? Math.min(1, Math.max(0, time / total)) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${ratio})`;
      if (thumbRef.current) thumbRef.current.style.left = `${ratio * 100}%`;
      if (clockRef.current) {
        const text = formatDuration(time);
        if (clockRef.current.textContent !== text) {
          clockRef.current.textContent = text;
          // The slider's value is a DOM write too (once a second), not a React render per frame.
          scrubRef.current?.setAttribute('aria-valuenow', String(Math.round(time)));
          scrubRef.current?.setAttribute('aria-valuetext', text);
        }
      }
    },
    [duration],
  );

  const paintBuffer = useCallback(() => {
    const el = videoRef.current;
    if (!el || !bufferRef.current) return;
    const total = Number.isFinite(el.duration) ? el.duration : duration;
    let end = 0;
    for (let i = 0; i < el.buffered.length; i++) {
      if (el.buffered.start(i) <= el.currentTime + 0.5 && el.buffered.end(i) > end) end = el.buffered.end(i);
    }
    bufferRef.current.style.transform = `scaleX(${total > 0 ? Math.min(1, end / total) : 0})`;
  }, [duration]);

  // rAF loop while playing: precise cue boundaries, smooth scrubber, throttled bus.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let lastPublish = 0;
    const tick = (now: number) => {
      const el = videoRef.current;
      if (el) {
        if (!scrubbing) paint(el.currentTime);
        syncCue(el.currentTime);
        if (now - lastPublish > 250) {
          lastPublish = now;
          publishTime(el.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, scrubbing, paint, syncCue]);

  // Cues can arrive (or the mode change) while paused — resolve once for the current time.
  useEffect(() => {
    const el = videoRef.current;
    syncCue(el ? el.currentTime : 0);
  }, [syncCue]);

  // ── frame size (font size, overlay clamping, popover-vs-sheet) ────────────
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame((f) => (f.w === el.clientWidth && f.h === el.clientHeight ? f : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [src]);

  // ── stored volume, PiP support, start position ───────────────────────────
  useEffect(() => {
    const raw = readStore(VOLUME_KEY);
    if (raw) {
      try {
        const v = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
        if (typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1) setVolume(v.volume);
        if (typeof v.muted === 'boolean') setMuted(v.muted);
      } catch {
        /* ignore */
      }
    }
    setPipSupported(typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted, src]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = rate;
  }, [rate, src]);

  // Where to start: `?t=754` wins; else resume where this browser left off
  // (negative = "a resume, show the chip"). Applied once the duration is known.
  const startAt = useRef<number | null>(null);
  const onMetadata = useCallback(
    (el: HTMLVideoElement) => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
      const want = startAt.current;
      startAt.current = null;
      if (want !== null && Number.isFinite(el.duration)) {
        const sec = Math.abs(want);
        if (sec < el.duration - (want < 0 ? RESUME_TAIL_SEC : 1)) {
          el.currentTime = sec;
          if (want < 0) setResumedFrom(sec);
        }
      }
      paint(el.currentTime);
    },
    [paint],
  );
  useEffect(() => {
    const fromUrl = Number(new URLSearchParams(window.location.search).get('t'));
    if (Number.isFinite(fromUrl) && fromUrl > 0) startAt.current = fromUrl;
    else {
      const saved = Number(readStore(resumeKey(slug)));
      if (Number.isFinite(saved) && saved >= RESUME_MIN_SEC) startAt.current = -saved;
    }
    // The <video> is server-rendered, so the browser starts loading it while the
    // HTML is still streaming: `loadedmetadata` (and `error`) routinely fire BEFORE
    // React hydrates and attaches the handlers below, and an event nobody heard
    // never comes back. Catch up from the element's own state.
    const el = videoRef.current;
    if (!el) return;
    if (el.error) setFailed(true);
    else if (el.readyState >= 1) onMetadata(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per source; onMetadata only closes over stable setters + paint
  }, [slug, src]);

  // ── controls visibility ──────────────────────────────────────────────────
  const stateRef = useRef({ playing, panel, scrubbing });
  stateRef.current = { playing, panel, scrubbing };

  const armHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const s = stateRef.current;
      if (s.playing && !s.panel && !s.scrubbing && !overBar.current) setControlsVisible(false);
    }, HIDE_AFTER_MS);
  }, []);

  const wake = useCallback(() => {
    setControlsVisible(true);
    armHide();
  }, [armHide]);

  useEffect(() => {
    if (!playing || panel) setControlsVisible(true);
    if (playing) armHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [playing, panel, armHide]);

  // ── actions ──────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused || el.ended) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const seekTo = useCallback(
    (sec: number) => {
      const el = videoRef.current;
      if (!el) return;
      const total = Number.isFinite(el.duration) ? el.duration : duration;
      const next = Math.min(Math.max(0, sec), total > 0 ? Math.max(0, total - 0.05) : sec);
      el.currentTime = next;
      paint(next);
      syncCue(next);
      publishTime(next);
    },
    [duration, paint, syncCue],
  );

  const seekBy = useCallback(
    (delta: number) => {
      const el = videoRef.current;
      if (el) seekTo(el.currentTime + delta);
    },
    [seekTo],
  );

  const changeVolume = useCallback((next: number, nextMuted?: boolean) => {
    const v = Math.min(1, Math.max(0, next));
    const m = nextMuted ?? v === 0;
    setVolume(v);
    setMuted(m);
    writeStore(VOLUME_KEY, JSON.stringify({ volume: v, muted: m }));
  }, []);

  const toggleMute = useCallback(() => {
    // Un-muting a zero volume would be a button that does nothing.
    if (muted && volume === 0) changeVolume(0.5, false);
    else changeVolume(volume, !muted);
  }, [muted, volume, changeVolume]);

  const toggleFullscreen = useCallback(() => {
    const el = frameRef.current;
    const video = videoRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (el.requestFullscreen) {
      // Called synchronously from the gesture — an await first loses user activation.
      void el.requestFullscreen().catch(() => undefined);
    } else if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen(); // iPhone: only the <video> may go fullscreen
    }
  }, []);

  const togglePip = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void video.requestPictureInPicture?.().catch(() => undefined);
  }, []);

  const toggleSubtitles = useCallback(() => {
    if (!has.zh && !has.en) {
      setPanel((p) => (p === 'subtitles' ? null : 'subtitles'));
      return;
    }
    if (mode === 'off') {
      // Back to what they last had; first time, their own language.
      const wanted = prefs.mode === 'off' ? (locale.toLowerCase().startsWith('zh') ? 'zh' : 'en') : prefs.mode;
      prefs.setMode(resolveSubtitleMode(wanted, has));
    } else prefs.setMode('off');
  }, [has, mode, prefs, locale]);

  // ── fullscreen / PiP / iPhone native fullscreen: who draws the captions ────
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const on = () => setNativeCaptions(true);
    const off = () => setNativeCaptions(false);
    el.addEventListener('webkitbeginfullscreen', on);
    el.addEventListener('webkitendfullscreen', off);
    el.addEventListener('enterpictureinpicture', on);
    el.addEventListener('leavepictureinpicture', off);
    return () => {
      el.removeEventListener('webkitbeginfullscreen', on);
      el.removeEventListener('webkitendfullscreen', off);
      el.removeEventListener('enterpictureinpicture', on);
      el.removeEventListener('leavepictureinpicture', off);
    };
  }, [src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const want = mode === 'both' ? bilingualOrder(locale)[0] : mode;
    for (const track of Array.from(el.textTracks)) {
      track.mode = nativeCaptions && track.language === want ? 'showing' : 'disabled';
    }
  }, [nativeCaptions, mode, locale, subs.zhUrl, subs.enUrl]);

  // ── the watch bus ────────────────────────────────────────────────────────
  useEffect(
    () =>
      onSeekRequest((sec) => {
        const el = videoRef.current;
        if (!el) return;
        seekTo(sec);
        void el.play().catch(() => undefined);
        const rect = frameRef.current?.getBoundingClientRect();
        if (rect && (rect.bottom < 80 || rect.top > window.innerHeight - 80)) {
          frameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        wake();
      }),
    [seekTo, wake],
  );

  // ── resume position ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const el = videoRef.current;
      if (!el || !Number.isFinite(el.duration)) return;
      const worth = el.currentTime >= RESUME_MIN_SEC && el.currentTime < el.duration - RESUME_TAIL_SEC;
      writeStore(resumeKey(slug), worth ? String(Math.floor(el.currentTime)) : null);
    }, RESUME_SAVE_MS);
    return () => clearInterval(id);
  }, [playing, slug]);

  useEffect(() => {
    if (resumedFrom === null) return;
    const id = setTimeout(() => setResumedFrom(null), 8000);
    return () => clearTimeout(id);
  }, [resumedFrom]);

  // ── scrubber ─────────────────────────────────────────────────────────────
  const timeAt = useCallback(
    (clientX: number) => {
      const rect = scrubRef.current?.getBoundingClientRect();
      const el = videoRef.current;
      const total = el && Number.isFinite(el.duration) ? el.duration : duration;
      if (!rect || rect.width <= 0 || total <= 0) return null;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return { sec: ratio * total, x: ratio * rect.width };
    },
    [duration],
  );

  function onScrubDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const at = timeAt(e.clientX);
    if (!at) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setScrubbing(true);
    paint(at.sec);
    setHoverTime(at);
  }
  function onScrubMove(e: ReactPointerEvent<HTMLDivElement>) {
    const at = timeAt(e.clientX);
    if (!at) return;
    setHoverTime(at);
    if (scrubbing) {
      paint(at.sec);
      syncCue(at.sec);
    }
  }
  function onScrubUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbing) return;
    const at = timeAt(e.clientX);
    setScrubbing(false);
    if (e.pointerType !== 'mouse') setHoverTime(null);
    if (at) seekTo(at.sec);
  }
  function onScrubKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const el = videoRef.current;
    if (!el) return;
    const total = Number.isFinite(el.duration) ? el.duration : duration;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = el.currentTime - (e.shiftKey ? 30 : 5);
    else if (e.key === 'ArrowRight') next = el.currentTime + (e.shiftKey ? 30 : 5);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = total;
    else if (e.key === 'PageDown') next = el.currentTime - 60;
    else if (e.key === 'PageUp') next = el.currentTime + 60;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    seekTo(next);
    wake();
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape' && panel) {
      e.preventDefault();
      e.stopPropagation();
      setPanel(null);
      return;
    }
    if (isInteractive(e.target)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    if (key === ' ' || key === 'k') togglePlay();
    else if (key === 'ArrowLeft') seekBy(-5);
    else if (key === 'ArrowRight') seekBy(5);
    else if (key === 'j') seekBy(-10);
    else if (key === 'l') seekBy(10);
    else if (key === 'ArrowUp') changeVolume(volume + 0.1, false);
    else if (key === 'ArrowDown') changeVolume(volume - 0.1);
    else if (key === 'm') toggleMute();
    else if (key === 'f') toggleFullscreen();
    else if (key === 'c') toggleSubtitles();
    else if (key === '>' || key === '.') setRate((r) => RATES[Math.min(RATES.length - 1, RATES.indexOf(r as (typeof RATES)[number]) + 1)] ?? r);
    else if (key === '<' || key === ',') setRate((r) => RATES[Math.max(0, RATES.indexOf(r as (typeof RATES)[number]) - 1)] ?? r);
    else if (/^[0-9]$/.test(key)) {
      const el = videoRef.current;
      const total = el && Number.isFinite(el.duration) ? el.duration : duration;
      if (total > 0) seekTo((Number(key) / 10) * total);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      wake();
    }
  }

  // ── surface gestures: mouse click = play/pause, touch tap = show controls first ──
  const lastTap = useRef(0);
  // Safari still dispatches `click` as a MouseEvent (no pointerType), so the kind of
  // pointer is remembered from the pointerdown that preceded it.
  const lastPointerType = useRef<string>('mouse');
  function onSurfaceClick(e: React.MouseEvent<HTMLDivElement>) {
    if (isInteractive(e.target)) return;
    if (panel) {
      setPanel(null);
      return;
    }
    const touch = lastPointerType.current === 'touch';
    if (touch) {
      if (!controlsVisible) {
        wake();
        return;
      }
      const now = Date.now();
      if (now - lastTap.current < 320) {
        // double-tap: the side you tapped seeks that way
        const rect = frameRef.current?.getBoundingClientRect();
        if (rect) seekBy(e.clientX < rect.left + rect.width / 2 ? -10 : 10);
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
    }
    togglePlay();
    wake();
  }

  // ── labels for the settings panel ────────────────────────────────────────
  const settingsLabels: SubtitleSettingsLabels = useMemo(
    () => ({
      title: t('player.subtitle_settings'),
      close: t('player.close'),
      language: t('player.sub_language'),
      off: t('player.sub_off'),
      zh: t('player.sub_zh'),
      en: t('player.sub_en'),
      both: t('player.sub_both'),
      size: t('player.sub_size'),
      sizeSmaller: t('player.sub_size_smaller'),
      sizeLarger: t('player.sub_size_larger'),
      position: t('player.sub_position'),
      posBottom: t('player.sub_pos_bottom'),
      posMiddle: t('player.sub_pos_middle'),
      posTop: t('player.sub_pos_top'),
      dragHint: t('player.sub_drag_hint'),
      background: t('player.sub_background'),
      backgroundNone: t('player.sub_background_none'),
      color: t('player.sub_color'),
      colorNames: {
        white: t('player.sub_color_white'),
        yellow: t('player.sub_color_yellow'),
        cyan: t('player.sub_color_cyan'),
        green: t('player.sub_color_green'),
      },
      outline: t('player.sub_outline'),
      bold: t('player.sub_bold'),
      reset: t('player.sub_reset'),
      processing: t('player.sub_processing'),
      unavailable: t('player.sub_unavailable'),
    }),
    [t],
  );

  if (!src) {
    return (
      <div className="surface relative aspect-video w-full overflow-hidden rounded-2xl">
        {poster ? <CoverImage src={poster} aspect={posterAspect} pos={posterPos} imgClassName="opacity-60" loading="eager" /> : <div className="h-full w-full bg-zinc-900" />}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white">
          <Lock className="h-6 w-6" />
          <span className="text-sm font-medium">{t('login_required')}</span>
        </div>
      </div>
    );
  }

  // What the overlay shows: real cues, or a sample line while the viewer is styling with nothing on screen.
  const order = bilingualOrder(locale);
  const lines: SubtitleLine[] =
    mode === 'both'
      ? order.map((lang) => ({ lang, text: cue[lang] })).filter((l) => l.text)
      : mode === 'off'
        ? []
        : cue[mode]
          ? [{ lang: mode, text: cue[mode] }]
          : [];
  const editing = panel === 'subtitles';
  const sample: SubtitleLine[] =
    editing && lines.length === 0 && mode !== 'off'
      ? mode === 'both'
        ? order.map((lang) => ({ lang, text: lang === 'zh' ? t('player.sub_sample_zh') : t('player.sub_sample_en') }))
        : [{ lang: mode, text: mode === 'zh' ? t('player.sub_sample_zh') : t('player.sub_sample_en') }]
      : [];
  const shown = lines.length ? lines : sample;
  const fontPx = subtitleBaseFontPx(frame.w) * prefs.style.scale;
  const useSheet = !fullscreen && frame.h > 0 && frame.h < POPOVER_MIN_FRAME_HEIGHT;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const barShown = controlsVisible || !playing;
  const ccActive = mode !== 'off';

  const settings = (
    <SubtitleSettings
      labels={settingsLabels}
      mode={mode}
      has={has}
      processing={subs.status === 'processing'}
      style={prefs.style}
      onMode={prefs.setMode}
      onStyle={(patch) => prefs.patchStyle(patch)}
      onReset={prefs.resetStyle}
      onClose={() => setPanel(null)}
      variant={useSheet ? 'sheet' : 'popover'}
    />
  );

  const ctl =
    'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80';

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      role="region"
      aria-label={t('player.region', { title })}
      onKeyDown={onKeyDown}
      onPointerDownCapture={(e) => {
        lastPointerType.current = e.pointerType;
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'touch') wake();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && stateRef.current.playing && !stateRef.current.panel) setControlsVisible(false);
      }}
      onClick={onSurfaceClick}
      onDoubleClick={(e) => {
        if (!isInteractive(e.target)) toggleFullscreen();
      }}
      className={`group/player relative isolate overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950 ${
        // In fullscreen the fixed aspect class would beat the UA's :fullscreen sizing and leave the video small.
        fullscreen ? 'h-[100dvh] w-screen rounded-none' : 'aspect-video w-full rounded-2xl'
      } ${barShown ? '' : 'cursor-none'}`}
    >
      {/* Letterbox backdrop: the poster, blurred — a portrait video sits on its own colours, not on black bars. */}
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media url
        <img
          src={withBasePath(poster)}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-50 blur-2xl saturate-150"
        />
      )}

      <video
        ref={videoRef}
        src={withBasePath(src)}
        preload="metadata"
        playsInline
        className="h-full w-full object-contain"
        onLoadedMetadata={(e) => onMetadata(e.currentTarget)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          setFailed(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          writeStore(resumeKey(slug), null);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onProgress={paintBuffer}
        onTimeUpdate={(e) => {
          // Covers the paused case (a seek while paused); the rAF loop owns playback.
          if (!playing && !scrubbing) {
            paint(e.currentTarget.currentTime);
            syncCue(e.currentTarget.currentTime);
            publishTime(e.currentTarget.currentTime);
          }
          paintBuffer();
        }}
        onSeeked={(e) => {
          paint(e.currentTarget.currentTime);
          syncCue(e.currentTarget.currentTime);
        }}
        onError={() => {
          setFailed(true);
          setWaiting(false);
        }}
      >
        {subs.zhUrl && <track kind="subtitles" srcLang="zh" label="中文" src={withBasePath(subs.zhUrl)} />}
        {subs.enUrl && <track kind="subtitles" srcLang="en" label="English" src={withBasePath(subs.enUrl)} />}
      </video>

      {/* Poster until the first play — through the shared cover contract, so a portrait cover is not butchered here either. */}
      {!started && poster && <CoverImage src={poster} alt={title} aspect={posterAspect} pos={posterPos} loading="eager" className="z-[1]" />}

      {!nativeCaptions && (
        <SubtitleOverlay
          frameWidth={frame.w}
          frameHeight={frame.h}
          lines={shown}
          style={prefs.style}
          fontPx={fontPx}
          liftPx={barShown ? CONTROL_BAR_PX + 6 : 0}
          // The popover sits on the right of the frame; the lines being restyled step aside so they stay visible.
          rightInsetPx={editing && !useSheet ? SETTINGS_POPOVER_PX : 0}
          editing={editing}
          dragHint={t('player.sub_drag_title')}
          onMove={(x, y) => prefs.patchStyle({ x, y }, false)}
          onMoveEnd={prefs.commitStyle}
        />
      )}

      {/* Centre affordances: the big play button before/while paused, a spinner while buffering. */}
      {waiting && playing ? (
        <div className="pointer-events-none absolute inset-0 z-[4] grid place-items-center">
          <Loader2 className="h-10 w-10 animate-spin text-white/90 motion-reduce:animate-none" aria-hidden />
        </div>
      ) : (
        !playing &&
        !failed && (
          <div className="pointer-events-none absolute inset-0 z-[4] grid place-items-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform duration-200 group-hover/player:scale-105 sm:h-[4.5rem] sm:w-[4.5rem]">
              <Play className="ml-1 h-7 w-7 fill-current sm:h-8 sm:w-8" aria-hidden />
            </span>
          </div>
        )
      )}

      {failed && (
        <div className="absolute inset-0 z-[4] grid place-items-center bg-black/60 px-6 text-center text-sm text-white">
          <div>
            <p>{t('player.error')}</p>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                videoRef.current?.load();
              }}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('player.retry')}
            </button>
          </div>
        </div>
      )}

      {resumedFrom !== null && (
        <div className="absolute left-3 top-3 z-[8] flex items-center gap-2 rounded-full bg-black/70 py-1 pl-3 pr-1 text-xs text-white backdrop-blur-sm">
          <span>{t('player.resumed', { time: formatDuration(resumedFrom) })}</span>
          <button
            type="button"
            onClick={() => {
              seekTo(0);
              setResumedFrom(null);
            }}
            className="rounded-full bg-white/15 px-2.5 py-1 font-medium transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            {t('player.restart')}
          </button>
        </div>
      )}

      {/* ── control bar ── */}
      <div
        onPointerEnter={() => {
          overBar.current = true;
        }}
        onPointerLeave={() => {
          overBar.current = false;
          armHide();
        }}
        // The bar's own empty space is not the video surface: a click between two buttons must not pause.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className={`absolute inset-x-0 bottom-0 z-[7] bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-1.5 pt-10 transition-opacity duration-200 motion-reduce:transition-none sm:px-3 ${
          barShown ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* scrubber */}
        <div
          ref={scrubRef}
          role="slider"
          tabIndex={0}
          aria-label={t('player.seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(videoRef.current?.currentTime ?? 0)}
          aria-valuetext={formatDuration(videoRef.current?.currentTime ?? 0)}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onPointerLeave={() => {
            if (!scrubbing) setHoverTime(null);
          }}
          onKeyDown={onScrubKey}
          onClick={(e) => e.stopPropagation()}
          className="group/scrub relative flex h-5 cursor-pointer touch-none items-center outline-none"
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/scrub:h-1.5 group-focus-visible/scrub:h-1.5">
            <div ref={bufferRef} className="absolute inset-0 origin-left scale-x-0 bg-white/35" />
            <div ref={fillRef} className="absolute inset-0 origin-left scale-x-0 bg-white" />
          </div>
          <div
            ref={thumbRef}
            className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-opacity duration-150 group-hover/scrub:opacity-100 group-focus-visible/scrub:opacity-100 ${
              scrubbing ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ left: '0%' }}
          />
          {hoverTime && (
            <span
              className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white"
              style={{ left: hoverTime.x }}
            >
              {formatDuration(hoverTime.sec)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1">
          <button type="button" onClick={togglePlay} aria-label={playing ? t('player.pause') : t('player.play')} title={playing ? t('player.pause') : t('player.play')} className={ctl}>
            {playing ? <Pause className="h-5 w-5 fill-current" aria-hidden /> : <Play className="h-5 w-5 fill-current" aria-hidden />}
          </button>

          <div className="group/vol flex items-center">
            <button type="button" onClick={toggleMute} aria-label={muted ? t('player.unmute') : t('player.mute')} title={muted ? t('player.unmute') : t('player.mute')} className={ctl}>
              <VolumeIcon className="h-5 w-5" aria-hidden />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label={t('player.volume')}
              className="player-range hidden w-0 opacity-0 transition-all duration-200 focus-visible:w-20 focus-visible:opacity-100 group-hover/vol:w-20 group-hover/vol:opacity-100 sm:block"
              style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
          </div>

          <span className="ml-1 select-none font-mono text-[12px] tabular-nums text-white/90">
            <span ref={clockRef}>0:00</span>
            <span className="text-white/50"> / {formatDuration(duration)}</span>
          </span>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => setPanel((p) => (p === 'subtitles' ? null : 'subtitles'))}
            aria-label={t('player.subtitle_settings')}
            aria-expanded={panel === 'subtitles'}
            title={t('player.subtitle_settings')}
            className={`${ctl} relative`}
          >
            {ccActive ? <Captions className="h-5 w-5" aria-hidden /> : <CaptionsOff className="h-5 w-5" aria-hidden />}
            {ccActive && <span className="absolute inset-x-2.5 bottom-1 h-0.5 rounded-full bg-white" aria-hidden />}
            {subs.status === 'processing' && !has.zh && !has.en && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-white motion-reduce:animate-none" aria-hidden />
            )}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setPanel((p) => (p === 'speed' ? null : 'speed'))}
              aria-label={t('player.speed')}
              aria-expanded={panel === 'speed'}
              title={t('player.speed')}
              className={`${ctl} w-auto min-w-9 px-1.5`}
            >
              {rate === 1 ? <Gauge className="h-5 w-5" aria-hidden /> : <span className="font-mono text-[12px] font-semibold tabular-nums">{rate}×</span>}
            </button>
            {panel === 'speed' && (
              <div
                data-player-panel
                role="menu"
                aria-label={t('player.speed')}
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-full right-0 mb-2 w-24 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 py-1 text-white shadow-2xl"
              >
                {RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="menuitemradio"
                    aria-checked={rate === r}
                    onClick={() => {
                      setRate(r);
                      setPanel(null);
                    }}
                    className={`flex h-8 w-full items-center justify-between px-3 font-mono text-xs tabular-nums transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none ${
                      rate === r ? 'font-semibold text-white' : 'text-white/70'
                    }`}
                  >
                    {r === 1 ? t('player.speed_normal') : `${r}×`}
                    {rate === r && <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {pipSupported && (
            <button type="button" onClick={togglePip} aria-label={t('player.pip')} title={t('player.pip')} className={`${ctl} hidden sm:grid`}>
              <PictureInPicture2 className="h-5 w-5" aria-hidden />
            </button>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t('player.exit_fullscreen') : t('player.fullscreen')}
            title={fullscreen ? t('player.exit_fullscreen') : t('player.fullscreen')}
            className={ctl}
          >
            {fullscreen ? <Minimize className="h-5 w-5" aria-hidden /> : <Maximize className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>

      {/* Subtitle settings: a popover inside the frame, or — when the frame is too short to hold it — a bottom sheet. */}
      {panel === 'subtitles' &&
        (useSheet && portalHost ? (
          createPortal(
            <div className="fixed inset-x-0 bottom-0 z-[96] mx-auto w-full max-w-md" onKeyDown={(e) => e.key === 'Escape' && setPanel(null)}>
              {settings}
            </div>,
            portalHost,
          )
        ) : (
          <div className="absolute bottom-[4.25rem] right-2 top-2 z-[9] flex items-end sm:right-3">{settings}</div>
        ))}
    </div>
  );
}
