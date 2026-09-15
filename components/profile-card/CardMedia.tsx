'use client';

// 名片媒体 — the member's photo or video on a card, shared by all three styles.
//
// Video contract (each rule is a bug seen elsewhere in this app):
//   - The <video> element exists ONLY while this card is the active player:
//     `playMedia`, motion allowed, on screen, and holding the page-wide slot
//     below. Server HTML never contains it (reduced motion is unknown there,
//     and an SSR'd autoplay element starts buffering before hydration).
//   - ONE card video plays at a time, page-wide. The newest claimant wins and
//     the previous one falls back to its poster; when the newest lets go (a
//     hover card closes) the one underneath resumes. A profile hero + a hover
//     card + two editor previews must never be four decoders.
//   - Hard unload in the CALLBACK ref: pause(), drop src, load(). A passive
//     effect cleanup runs after React has already nulled a ref object, so it
//     can never reach the element (same finding as the vote gallery).
//   - The poster stays underneath and the video fades in on `playing`, so
//     mounting never flashes black.
//   - A still that fails to load (a hover card still holding a view whose file
//     was replaced and unlinked, a pruned upload) falls back to the style's
//     no-media treatment instead of a broken-image glyph — including a failure
//     that fired before hydration attached onError (an SSR'd profile hero).
//
// Reframe (editor only): with `onMediaPosChange`, a pointer-capture drag on
// the media rewrites CSS object-position ('x% y%') — the value a card config
// stores. Mouse and pen drag straight away. A FINGER only reframes under
// `touchReframe` (the editor's explicit 调整取景 mode, the only time the area
// takes `touch-action: none`): in holo/reflective the media is the whole card,
// and on a phone the preview fills the screen, so otherwise a swipe meant to
// scroll the page to the form would move the photo instead — and with a
// landscape photo in a portrait card do nothing at all. A position is reported
// only after the pointer really moved: a tap on an unframed photo would
// otherwise store '50% 50%' over '' and mark the draft unsaved.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Move } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { parseMediaPos } from '@/lib/profile/shared';
import type { ProfileCardMedia } from '@/lib/profile/types';
import { posToXY, xyToPos } from '@/components/profile-card/card-shared';

// ─── page-wide "one playing card video" slot ─────────────────────────────

interface PlayerSlot {
  grant: (on: boolean) => void;
}

const slotStack: PlayerSlot[] = [];

function claimSlot(slot: PlayerSlot) {
  const i = slotStack.indexOf(slot);
  if (i !== -1) slotStack.splice(i, 1);
  for (const s of slotStack) s.grant(false);
  slotStack.push(slot);
  slot.grant(true);
}

function releaseSlot(slot: PlayerSlot) {
  const i = slotStack.indexOf(slot);
  if (i === -1) return;
  const wasTop = i === slotStack.length - 1;
  slotStack.splice(i, 1);
  slot.grant(false);
  if (wasTop && slotStack.length) slotStack[slotStack.length - 1].grant(true);
}

/** Movement (px) before a press on the media counts as a reframe drag. */
const DRAG_SLOP_PX = 3;

// ─── component ───────────────────────────────────────────────────────────

export interface CardMediaProps {
  media: ProfileCardMedia | null;
  /** Autoplay the video when this card may. */
  playMedia: boolean;
  /** CardConfig.mediaPos ('x% y%' or ''). */
  pos: string;
  alt: string;
  /** Class on the positioned container (inset 0). */
  className?: string;
  /** Class on each media element (<img>/<video>). */
  mediaClassName?: string;
  /** Extra style on each media element (filters). */
  mediaStyle?: CSSProperties;
  /** Rendered instead when there is no still to show (video with no poster, or the still failed to load). */
  fallback?: ReactNode;
  /** true while the still failed to load and `fallback` stands in for it (the holo card drops its blend tone). */
  onStillFailedChange?: (failed: boolean) => void;
  onMediaPosChange?: (pos: string) => void;
  /** Let touch pointers reframe too (see the header). */
  touchReframe?: boolean;
  onDragChange?: (dragging: boolean) => void;
}

export function CardMedia({
  media,
  playMedia,
  pos,
  alt,
  className = '',
  mediaClassName = '',
  mediaStyle,
  fallback,
  onMediaPosChange,
  touchReframe = false,
  onDragChange,
  onStillFailedChange,
}: CardMediaProps) {
  const t = useTranslations('profile');
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [inView, setInView] = useState(false);
  const [granted, setGranted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  /** The still URL that failed to load (keyed by URL, so a new media value gets its own attempt). */
  const [failedStill, setFailedStill] = useState<string | null>(null);
  const safePos = parseMediaPos(pos);
  const objectPosition = safePos || '50% 50%';
  const still = media ? (media.kind === 'image' ? media.url : media.posterUrl) : null;
  const stillFailed = !!still && failedStill === still;

  // An error that fired before hydration never reached onError: a complete image
  // with no pixels is a broken one.
  useEffect(() => {
    const img = imgRef.current;
    if (still && img && img.complete && img.naturalWidth === 0) setFailedStill(still);
  }, [still]);

  useEffect(() => {
    onStillFailedChange?.(stillFailed);
  }, [stillFailed, onStillFailedChange]);

  const playUrl = media?.kind === 'video' ? media.playUrl : null;
  const wantsPlay = !!playUrl && playMedia && reduce === false && inView;

  // Only a card near the viewport competes for the slot.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !playUrl) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [playUrl]);

  useEffect(() => {
    if (!wantsPlay) return;
    const slot: PlayerSlot = { grant: setGranted };
    claimSlot(slot);
    return () => releaseSlot(slot);
  }, [wantsPlay, playUrl]);

  const active = wantsPlay && granted;
  // A new element (or a new source) has not produced a frame yet: keep the
  // poster on top until it does.
  useEffect(() => {
    setPlaying(false);
  }, [active, playUrl]);

  const videoCallback = useCallback((el: HTMLVideoElement | null) => {
    const prev = videoRef.current;
    if (!el && prev) {
      prev.pause();
      prev.removeAttribute('src');
      prev.load();
    }
    videoRef.current = el;
    if (el) {
      el.muted = true;
      el.play().catch(() => {
        /* autoplay refused — the poster stays */
      });
    }
  }, []);

  // ─── drag to reframe ───────────────────────────────────────────────────
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    ovX: number;
    ovY: number;
    raf: number | null;
    next: string;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onMediaPosChange || e.button !== 0) return;
    // No preventDefault, no capture: the browser keeps the finger for scrolling.
    if (e.pointerType === 'touch' && !touchReframe) return;
    const root = rootRef.current;
    const el = root?.querySelector<HTMLImageElement | HTMLVideoElement>('[data-card-media]');
    if (!root || !el) return;
    const natW = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const natH = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    const cw = root.clientWidth;
    const ch = root.clientHeight;
    if (!natW || !natH || !cw || !ch) return;
    const scale = Math.max(cw / natW, ch / natH);
    const [sx, sy] = posToXY(safePos);
    e.preventDefault();
    e.stopPropagation();
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone — the drag still works while it stays over the media */
    }
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: sx,
      startY: sy,
      ovX: natW * scale - cw,
      ovY: natH * scale - ch,
      raf: null,
      next: xyToPos(sx, sy),
      moved: false,
    };
    onDragChange?.(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const root = rootRef.current;
    if (!d || d.id !== e.pointerId || !root) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) <= DRAG_SLOP_PX) return;
      d.moved = true;
    }
    // Dragging right shows more of the LEFT side: object-position x goes down.
    const nx = d.ovX > 1 ? d.startX - (dx / d.ovX) * 100 : d.startX;
    const ny = d.ovY > 1 ? d.startY - (dy / d.ovY) * 100 : d.startY;
    d.next = xyToPos(nx, ny);
    // Paint immediately; report at most once a frame.
    root.querySelectorAll<HTMLElement>('[data-card-media]').forEach((m) => {
      m.style.objectPosition = d.next;
    });
    if (d.raf === null) {
      d.raf = requestAnimationFrame(() => {
        if (drag.current) drag.current.raf = null;
        onMediaPosChange?.(d.next);
      });
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.raf !== null) cancelAnimationFrame(d.raf);
    drag.current = null;
    try {
      rootRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    // A press that never moved is a tap, not a reframe.
    if (d.moved) onMediaPosChange?.(d.next);
    onDragChange?.(false);
  };

  useEffect(
    () => () => {
      if (drag.current?.raf != null) cancelAnimationFrame(drag.current.raf);
    },
    [],
  );

  if (!media) return null;

  const editable = !!onMediaPosChange;
  const elStyle: CSSProperties = { objectPosition, ...mediaStyle };

  return (
    <div
      ref={rootRef}
      className={`pc-media ${editable ? 'pc-media--editable' : ''} ${
        editable && touchReframe ? 'pc-media--touch-reframe' : ''
      } ${className}`}
      onPointerDown={editable ? onPointerDown : undefined}
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? endDrag : undefined}
      onPointerCancel={editable ? endDrag : undefined}
    >
      {(!still || stillFailed) && fallback}
      {still && !stillFailed && (
        // eslint-disable-next-line @next/next/no-img-element -- stored member media served by our own route
        <img
          ref={imgRef}
          data-card-media
          src={withBasePath(still)}
          onError={() => setFailedStill(still)}
          alt={alt}
          draggable={false}
          decoding="async"
          className={`pc-media-el ${mediaClassName}`}
          style={elStyle}
        />
      )}
      {active && playUrl && (
        <video
          key={playUrl}
          ref={videoCallback}
          data-card-media
          src={withBasePath(playUrl)}
          poster={media.posterUrl ? withBasePath(media.posterUrl) : undefined}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden
          disablePictureInPicture
          onPlaying={() => setPlaying(true)}
          className={`pc-media-el pc-media-video ${playing ? 'is-playing' : ''} ${mediaClassName}`}
          style={elStyle}
        />
      )}
      {editable && (
        <span className="pc-media-hint" aria-hidden>
          <Move />
          {t('card_drag_hint')}
        </span>
      )}
    </div>
  );
}
