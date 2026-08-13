'use client';

// 刷视频 — embedded shorts player used on the homepage and the GeekHub 短视频
// tab. Deliberately a THIN WRAPPER around the feed's ShortsCell (ONE player
// code path — likes/comments/favorites/share/subtitles/caption/date/progress
// all come from the cell); this component only adds the embedded-widget
// chrome the news ai_hub TikTok widget pioneered: translateY slide transitions
// with an animation lock, wheel/touch/chevron navigation, dots + counter,
// fullscreen, auto-advance on ended, and play-only-while-on-screen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ShortsCell } from '@/app/videos/shorts/_components/ShortsCell';
import { ShortsCommentsDrawer } from '@/app/videos/shorts/_components/ShortsCommentsDrawer';
import type { ShortsCurrentUser, ShortView } from '@/app/videos/shorts/_components/types';

const SLIDE_MS = 380;

export function ShortsShowcase({
  items,
  className = 'h-[560px] xl:h-[600px]',
  currentUser = null,
}: {
  items: ShortView[];
  className?: string;
  /** For the side comment sheet (点评论 opens it in place, 抖音-style). */
  currentUser?: ShortsCurrentUser | null;
}) {
  const t = useTranslations('shorts');

  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [muted, setMuted] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [inView, setInView] = useState(false);
  const [commentsFor, setCommentsFor] = useState<ShortView | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const animatingRef = useRef(false);
  const touchYRef = useRef(0);

  const item = items[idx] ?? null;

  useEffect(() => {
    try {
      if (localStorage.getItem('shorts:sound') === 'on') setMuted(false);
    } catch {
      /* storage unavailable */
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const persistMuted = useCallback((next: boolean) => {
    setMuted(next);
    try {
      localStorage.setItem('shorts:sound', next ? 'off' : 'on');
    } catch {
      /* ignore */
    }
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (animatingRef.current || items.length <= 1) return;
      animatingRef.current = true;
      setTimeout(() => {
        animatingRef.current = false;
      }, SLIDE_MS + 80);
      setDir(delta > 0 ? 1 : -1);
      setIdx((i) => (i + delta + items.length) % items.length);
    },
    [items.length],
  );

  // Wheel navigates the widget (non-passive so the page doesn't scroll under it).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.deltaY > 20) go(1);
      else if (e.deltaY < -20) go(-1);
    }
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [go]);

  // Play only while the widget is actually on screen (the cell pauses itself
  // when `active` flips false).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      ([entry]) => setInView(entry.intersectionRatio >= 0.4),
      { threshold: [0, 0.4, 0.8] },
    );
    obs.observe(root);
    return () => obs.disconnect();
  }, []);

  function fullscreen() {
    try {
      void rootRef.current?.requestFullscreen?.();
    } catch {
      /* unsupported */
    }
  }

  if (!item) return null;

  const variants = {
    enter: (d: number) => ({ y: d > 0 ? '100%' : '-100%', opacity: 0.6 }),
    center: { y: 0, opacity: 1 },
    exit: (d: number) => ({ y: d > 0 ? '-100%' : '100%', opacity: 0.6 }),
  };

  return (
    <div
      ref={rootRef}
      className={`relative overflow-hidden rounded-2xl bg-black ${className}`}
      onTouchStart={(e) => {
        touchYRef.current = e.touches[0].clientY;
      }}
      onTouchEnd={(e) => {
        const dy = touchYRef.current - e.changedTouches[0].clientY;
        if (Math.abs(dy) > 40) go(dy > 0 ? 1 : -1);
      }}
    >
      <AnimatePresence initial={false} custom={dir} mode="popLayout">
        <motion.div
          key={item.id}
          custom={dir}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: SLIDE_MS / 1000, ease: [0.25, 0.8, 0.25, 1] }}
          className="absolute inset-0"
        >
          <ShortsCell
            item={item}
            embed
            active={inView}
            nearActive
            muted={muted}
            reduceMotion={reduceMotion}
            onToggleMute={() => persistMuted(!muted)}
            onOpenComments={() => setCommentsFor(item)}
            onEnded={items.length > 1 ? () => go(1) : undefined}
          />
        </motion.div>
      </AnimatePresence>

      {/* Counter (top-left) */}
      {items.length > 1 && (
        <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[11px] tabular-nums text-white/70">
          {idx + 1} / {items.length}
        </span>
      )}

      {/* Fullscreen (top-right) */}
      <button
        type="button"
        onClick={fullscreen}
        className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
        aria-label={t('fullscreen')}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>

      {/* Position dots (right edge; wheel/swipe navigate) */}
      {items.length > 1 && (
        <div className="absolute right-2.5 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 py-1">
          {items.slice(0, 12).map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 w-1.5 rounded-full transition ${
                i === idx % Math.min(items.length, 12) ? 'scale-125 bg-white' : 'bg-white/35'
              }`}
            />
          ))}
        </div>
      )}

      {/* 抖音-style in-place comment sheet (portaled to <body>) */}
      {commentsFor && (
        <ShortsCommentsDrawer
          variant="fixed"
          short={commentsFor}
          currentUser={currentUser}
          focusCommentId={null}
          onClose={() => setCommentsFor(null)}
        />
      )}
    </div>
  );
}
