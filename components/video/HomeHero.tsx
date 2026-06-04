'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Info, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { VideoCard as VideoCardType } from '@/lib/video/queries';

const ROTATE_MS = 8000;

export function HomeHero({ videos }: { videos: VideoCardType[] }) {
  const t = useTranslations('video');
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const items = videos.slice(0, 6);
  const active = items[index];

  // Auto-rotate billboard.
  useEffect(() => {
    if (items.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [items.length]);

  // Restart the background preview whenever the active item changes.
  useEffect(() => {
    if (reduceMotion) return;
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {
      /* autoplay may be blocked */
    });
  }, [index, reduceMotion, active?.videoUrl]);

  if (!active) return null;

  const subtitle = [active.intervieweeName, active.intervieweeTitle].filter(Boolean).join(' · ');

  return (
    <section className="relative -mx-4 overflow-hidden rounded-none sm:mx-0 sm:rounded-2xl">
      <div className="relative aspect-[16/10] w-full sm:aspect-[21/8] lg:aspect-[21/7]">
        {/* Background: poster + muted preview */}
        <AnimatePresence mode="popLayout">
          <motion.div
            key={active.id}
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.8, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            {active.posterUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.posterUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {!reduceMotion && active.videoUrl && (
              <video
                ref={videoRef}
                src={active.videoUrl}
                poster={active.posterUrl ?? undefined}
                muted
                loop
                playsInline
                preload="none"
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Gradient overlays for legibility */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/70 via-black/20 to-transparent" />

        {/* Foreground content */}
        <div className="absolute inset-0 flex items-end">
          <div className="w-full px-5 pb-6 sm:px-8 sm:pb-8 lg:px-12 lg:pb-12">
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
                transition={{ duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' }}
                className="max-w-2xl"
              >
                {active.category?.name && (
                  <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                    {t('home.featured')} · {active.category.name}
                  </span>
                )}
                <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-md sm:text-4xl lg:text-5xl">
                  {active.title}
                </h1>
                {subtitle && (
                  <p className="mt-2 text-sm font-medium text-white/80 sm:text-base">{subtitle}</p>
                )}
                {active.summary && (
                  <p className="mt-3 line-clamp-2 max-w-xl text-sm text-white/75 sm:line-clamp-3 sm:text-base">
                    {active.summary}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/videos/${active.slug}`}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Play className="h-5 w-5 fill-current" />
                    {t('home.watch')}
                  </Link>
                  <Link
                    href={`/videos/${active.slug}`}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/20 px-6 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <Info className="h-5 w-5" />
                    {t('home.more')}
                  </Link>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Manual dots */}
        {items.length > 1 && (
          <div className="absolute bottom-4 right-5 flex items-center gap-2 sm:right-8 lg:right-12">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show ${item.title}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
