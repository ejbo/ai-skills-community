'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { formatDistanceToNowStrict } from 'date-fns';
import { useTranslations } from 'next-intl';
import type { VideoCard as VideoCardType } from '@/lib/video/queries';
import { formatCount, formatDuration } from '@/lib/video/types';

const PREVIEW_DELAY_MS = 400;

export function VideoCard({ video }: { video: VideoCardType }) {
  const t = useTranslations('video');
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const published = video.publishedAt ?? video.createdAt;
  const uploaderName = video.uploader?.displayName ?? video.intervieweeName ?? '';
  const avatarUrl = video.uploader?.avatarUrl ?? null;

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function startHover() {
    setHovered(true);
    if (reduceMotion || !video.videoUrl) return;
    clearTimer();
    timerRef.current = setTimeout(() => setPreviewing(true), PREVIEW_DELAY_MS);
  }

  function endHover() {
    setHovered(false);
    setPreviewing(false);
    clearTimer();
    const el = videoRef.current;
    if (el) {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {
        /* noop */
      }
    }
  }

  useEffect(() => {
    if (!previewing) return;
    const el = videoRef.current;
    if (!el) return;
    el.play().catch(() => {
      /* autoplay can be blocked; ignore */
    });
  }, [previewing]);

  useEffect(() => () => clearTimer(), []);

  return (
    <motion.div
      onHoverStart={startHover}
      onHoverEnd={endHover}
      onFocus={startHover}
      onBlur={endHover}
      animate={reduceMotion ? undefined : { scale: hovered ? 1.05 : 1, y: hovered ? -6 : 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="group relative"
      style={{ transformOrigin: 'center', zIndex: hovered ? 30 : 0 }}
    >
      <Link
        href={`/videos/${video.slug}`}
        className="flex flex-col gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <div
          className={`relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-100 transition-shadow duration-200 dark:bg-zinc-900 ${
            hovered ? 'shadow-lg shadow-black/20 ring-1 ring-black/5 dark:ring-white/10' : ''
          }`}
        >
          {video.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.posterUrl}
              alt={video.title}
              loading="lazy"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                previewing ? 'opacity-0' : 'opacity-100'
              }`}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-zinc-200 to-zinc-300 text-2xl font-semibold text-zinc-500 dark:from-zinc-800 dark:to-zinc-700 dark:text-zinc-400">
              {video.title.charAt(0)}
            </div>
          )}

          {!reduceMotion && video.videoUrl && (
            <video
              ref={videoRef}
              src={previewing ? video.videoUrl : undefined}
              poster={video.posterUrl ?? undefined}
              muted
              loop
              playsInline
              preload="none"
              tabIndex={-1}
              aria-hidden
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                previewing ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

          {video.durationSec != null && video.durationSec > 0 && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {formatDuration(video.durationSec)}
            </span>
          )}
        </div>

        <div className="flex gap-2.5">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover"
            />
          ) : uploaderName ? (
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-xs font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
              {uploaderName.charAt(0)}
            </span>
          ) : null}

          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight transition-colors group-hover:text-zinc-900 dark:group-hover:text-white">
              {video.title}
            </h3>
            {uploaderName && <p className="mt-1 truncate text-xs text-muted">{uploaderName}</p>}
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <span>{`${formatCount(video.viewCount)} ${t('detail.views')}`}</span>
              <span aria-hidden>·</span>
              <span>{formatDistanceToNowStrict(new Date(published), { addSuffix: true })}</span>
            </p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
