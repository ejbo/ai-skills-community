'use client';

// 刷视频 — embedded vertical short-video player for the homepage (modeled on
// the news 项目 ai_hub TikTok widget, its strengths kept: fixed-height in-page
// card, translateY slide transitions, wheel/touch/chevron navigation with an
// animation lock, dots + counter, click-to-pause with a center glyph, drag-seek
// progress bar, expandable description, auto-advance on ended). Buttons stay
// light — small translucent circles / bare icons, no heavy chrome.
//
// Shares the feed's persisted sound preference (localStorage 'shorts:sound')
// and its view-counting contract (2s accumulated playback → deduped ping).

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Heart,
  Maximize2,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { formatCount } from '@/lib/video/types';

export interface ShowcaseShort {
  id: string;
  title: string;
  summary: string;
  videoUrl: string | null;
  posterUrl: string | null;
  durationSec: number;
  viewCount: number;
  likeCount: number;
}

const SLIDE_MS = 380;

export function ShortsShowcase({ items }: { items: ShowcaseShort[] }) {
  const t = useTranslations('shorts');

  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animatingRef = useRef(false);
  const inViewRef = useRef(false);
  const userPausedRef = useRef(false);
  const mutedRef = useRef(true);
  const draggingRef = useRef(false);
  const lastTimeRef = useRef(0);
  const playedAccumRef = useRef(0);
  const viewedRef = useRef<Set<string>>(new Set());
  const touchYRef = useRef(0);

  const item = items[idx] ?? null;

  useEffect(() => {
    try {
      if (localStorage.getItem('shorts:sound') === 'on') {
        setMuted(false);
        mutedRef.current = false;
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  const attemptPlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setNeedsTap(false);
    el.muted = mutedRef.current;
    const p = el.play();
    if (p) {
      p.catch((err: unknown) => {
        if ((err as Error | null)?.name === 'NotAllowedError') {
          setNeedsTap(true);
          setPaused(true);
        }
      });
    }
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (animatingRef.current || items.length <= 1) return;
      animatingRef.current = true;
      setTimeout(() => {
        animatingRef.current = false;
      }, SLIDE_MS + 80);
      videoRef.current?.pause();
      userPausedRef.current = false;
      setExpanded(false);
      setProgress(0);
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

  // Play only while the widget is actually on screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = entry.intersectionRatio >= 0.4;
        const el = videoRef.current;
        if (!el) return;
        if (!inViewRef.current) el.pause();
        else if (!userPausedRef.current && el.paused) attemptPlay();
      },
      { threshold: [0, 0.4, 0.8] },
    );
    obs.observe(root);
    return () => obs.disconnect();
  }, [attemptPlay]);

  // New active item: reset accumulation and start (muted-first) playback.
  useEffect(() => {
    lastTimeRef.current = 0;
    playedAccumRef.current = 0;
    if (!item) return;
    const timer = setTimeout(() => {
      if (inViewRef.current && !userPausedRef.current) attemptPlay();
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [idx, item, attemptPlay]);

  useEffect(() => {
    mutedRef.current = muted;
    const el = videoRef.current;
    if (el) el.muted = muted;
  }, [muted, idx]);

  function persistMuted(next: boolean) {
    setMuted(next);
    try {
      localStorage.setItem('shorts:sound', next ? 'off' : 'on');
    } catch {
      /* ignore */
    }
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      userPausedRef.current = false;
      attemptPlay();
    } else {
      userPausedRef.current = true;
      el.pause();
    }
  }

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el || !el.duration || Number.isNaN(el.duration) || !item) return;
    if (!draggingRef.current) setProgress(el.currentTime / el.duration);
    const dt = el.currentTime - lastTimeRef.current;
    lastTimeRef.current = el.currentTime;
    if (!el.paused && dt > 0 && dt < 1.5) {
      playedAccumRef.current += dt;
      if (playedAccumRef.current >= 2 && !viewedRef.current.has(item.id)) {
        viewedRef.current.add(item.id);
        fetch(`/api/shorts/${item.id}/view`, { method: 'POST' }).catch(() => undefined);
      }
    }
  }

  function seekTo(clientX: number, target: HTMLElement) {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    try {
      el.currentTime = ratio * el.duration;
      setProgress(ratio);
    } catch {
      /* not seekable */
    }
  }

  function fullscreen() {
    const el = videoRef.current ?? rootRef.current;
    if (!el) return;
    try {
      void el.requestFullscreen?.();
    } catch {
      /* unsupported */
    }
  }

  if (!item) return null;

  const caption = item.summary.trim() || item.title;
  const showExpand = caption.length > 56 || caption.includes('\n');

  const variants = {
    enter: (d: number) => ({ y: d > 0 ? '100%' : '-100%', opacity: 0.6 }),
    center: { y: 0, opacity: 1 },
    exit: (d: number) => ({ y: d > 0 ? '-100%' : '100%', opacity: 0.6 }),
  };

  return (
    <div
      ref={rootRef}
      className="relative h-[560px] overflow-hidden rounded-2xl bg-black xl:h-[600px]"
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
          <div className="relative h-full w-full cursor-pointer" onClick={togglePlay}>
            {item.videoUrl ? (
              <video
                ref={videoRef}
                src={withBasePath(item.videoUrl)}
                poster={withBasePath(item.posterUrl) || undefined}
                muted
                playsInline
                preload="auto"
                className="h-full w-full object-contain"
                onPlay={() => setPaused(false)}
                onPause={() => setPaused(true)}
                onTimeUpdate={onTimeUpdate}
                onEnded={() => {
                  if (items.length > 1) go(1);
                  else {
                    const el = videoRef.current;
                    if (el) {
                      el.currentTime = 0;
                      void el.play().catch(() => undefined);
                    }
                  }
                }}
              />
            ) : item.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- same-origin stored poster
              <img
                src={withBasePath(item.posterUrl)}
                alt={item.title}
                className="h-full w-full object-contain"
              />
            ) : null}

            {/* Center play glyph (paused / autoplay blocked) */}
            {(paused || needsTap) && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
                  <Play className="ml-1 h-6 w-6 text-white" fill="currentColor" />
                </span>
              </span>
            )}

            {/* Info overlay: title + expandable description + counts + link */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-4 pt-14 text-white">
              <div className="pointer-events-auto pr-10">
                <h4 className="line-clamp-1 text-sm font-bold">{item.title}</h4>
                {caption && (
                  <p
                    className={`mt-1 cursor-pointer whitespace-pre-wrap text-xs leading-relaxed text-white/70 transition-all ${
                      expanded ? 'max-h-64 overflow-y-auto' : 'line-clamp-2'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (showExpand) setExpanded((v) => !v);
                    }}
                  >
                    {caption}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-white/50">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {formatCount(item.viewCount)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    {formatCount(item.likeCount)}
                  </span>
                  <Link
                    href={`/videos/shorts?v=${item.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-accent-300 hover:text-accent-200 hover:underline"
                  >
                    {t('strip_view_all')} →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Counter (top-left) */}
      {items.length > 1 && (
        <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[11px] tabular-nums text-white/70">
          {idx + 1} / {items.length}
        </span>
      )}

      {/* Mute + fullscreen (top-right, light circles) */}
      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => persistMuted(!muted)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
          aria-label={muted ? t('unmute') : t('mute')}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={fullscreen}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
          aria-label={t('fullscreen')}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Prev/next + dots (right-middle) */}
      {items.length > 1 && (
        <div className="absolute right-2.5 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
            aria-label={t('prev')}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <div className="flex flex-col items-center gap-1 py-1">
            {items.slice(0, 12).map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 w-1.5 rounded-full transition ${
                  i === idx % Math.min(items.length, 12)
                    ? 'scale-125 bg-white'
                    : 'bg-white/35'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
            aria-label={t('next')}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Progress bar (drag to seek) */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 h-5 cursor-pointer touch-none"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekTo(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) seekTo(e.clientX, e.currentTarget);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
        }}
      >
        <div className="absolute bottom-[5px] left-3 right-3 h-[3px] overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white/90" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
