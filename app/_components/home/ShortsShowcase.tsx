'use client';

// 刷视频 — embedded shorts player used on the homepage and the GeekHub 短视频
// tab. Deliberately a THIN WRAPPER around the feed's ShortsCell (ONE player
// code path — likes/comments/favorites/share/subtitles/caption/date/progress
// all come from the cell); this component only adds the embedded-widget
// chrome the news ai_hub TikTok widget pioneered: translateY slide transitions
// with an animation lock, wheel/touch/chevron navigation, dots + counter,
// fullscreen, auto-advance on ended, and play-only-while-on-screen.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ShortsCell } from '@/app/videos/shorts/_components/ShortsCell';
import { ShortsCommentsBody } from '@/app/videos/shorts/_components/ShortsCommentsDrawer';
import { ShortsAuthorWorks } from '@/app/videos/shorts/_components/ShortsAuthorWorks';
import { PANEL_SCROLL_CLS } from '@/app/videos/shorts/_components/HostPanel';
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
  const router = useRouter();

  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [muted, setMuted] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [inView, setInView] = useState(false);
  // Inline side panel: the video region RESIZES to make room (never covered).
  const [panel, setPanel] = useState<{ kind: 'comments' | 'works'; item: ShortView } | null>(null);
  const [isFs, setIsFs] = useState(false);

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
      // Let the inline side panel (comments/works) scroll its own content.
      if ((e.target as HTMLElement | null)?.closest?.('[data-shorts-panel]')) return;
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

  // Fullscreen is a TOGGLE (the button must exit too), tracked via the real
  // fullscreenchange event so Esc keeps the icon honest.
  useEffect(() => {
    const onChange = () => setIsFs(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement === rootRef.current) void document.exitFullscreen();
      else void rootRef.current?.requestFullscreen?.();
    } catch {
      /* unsupported */
    }
  }

  // 放大后可以上下刷: in fullscreen, arrow keys page through (wheel/touch
  // already work — their listeners live on the fullscreened element).
  useEffect(() => {
    if (!isFs) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'm' || e.key === 'M') {
        persistMuted(!muted);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFs, go, muted, persistMuted]);

  if (!item) return null;

  const variants = {
    enter: (d: number) => ({ y: d > 0 ? '100%' : '-100%', opacity: 0.6 }),
    center: { y: 0, opacity: 1 },
    exit: (d: number) => ({ y: d > 0 ? '-100%' : '100%', opacity: 0.6 }),
  };

  const jumpToWork = (s: ShortView) => {
    const i = items.findIndex((x) => x.id === s.id);
    if (i >= 0) {
      setDir(i > idx ? 1 : -1);
      setIdx(i);
      setPanel(null);
    } else {
      router.push(`/videos/shorts?v=${s.id}`);
    }
  };

  return (
    <div
      ref={rootRef}
      // In fullscreen the widget must FILL the screen — Tailwind's fixed height
      // classes would otherwise beat the UA's :fullscreen sizing rules.
      className={`flex overflow-hidden bg-black ${
        isFs ? 'h-[100dvh] w-screen rounded-none' : `rounded-2xl ${className}`
      }`}
      onTouchStart={(e) => {
        touchYRef.current = e.touches[0].clientY;
      }}
      onTouchEnd={(e) => {
        const dy = touchYRef.current - e.changedTouches[0].clientY;
        if (Math.abs(dy) > 40) go(dy > 0 ? 1 : -1);
      }}
    >
      {/* VIDEO REGION — shrinks when the side panel opens (never covered) */}
      <div className="relative min-w-0 flex-1">
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
              onOpenComments={() => setPanel({ kind: 'comments', item })}
              onOpenAuthor={() => setPanel({ kind: 'works', item })}
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

        {/* Fullscreen toggle (top-right) */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
          aria-label={isFs ? t('exit_fullscreen') : t('fullscreen')}
        >
          {isFs ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
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
      </div>

      {/* INLINE SIDE PANEL (评论 / TA 的作品) — the video resizes to make room
          instead of being covered; no scrim, playback continues. */}
      <AnimatePresence initial={false}>
        {panel && (
          <motion.div
            key={panel.kind}
            initial={{ width: '0%' }}
            animate={{ width: '62%' }}
            exit={{ width: '0%' }}
            transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            data-shorts-panel
            className="relative shrink-0 overflow-hidden border-l border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
            style={{ maxWidth: 400 }}
          >
            <div className="flex h-full min-w-[240px] flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <p className="min-w-0 truncate text-sm font-semibold">
                  {panel.kind === 'comments' ? t('comments') : panel.item.uploader.displayName}
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  {panel.kind === 'works' && (
                    <Link
                      href={`/users/${panel.item.uploader.handle}`}
                      className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      {t('author_profile')}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => setPanel(null)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label={t('close')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className={`${PANEL_SCROLL_CLS} px-4 py-4`}>
                {panel.kind === 'comments' ? (
                  <ShortsCommentsBody short={panel.item} currentUser={currentUser} focusCommentId={null} />
                ) : (
                  <ShortsAuthorWorks
                    handle={panel.item.uploader.handle}
                    currentId={item.id}
                    onSelect={jumpToWork}
                  />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
