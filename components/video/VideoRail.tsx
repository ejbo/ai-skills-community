'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { VideoCard as VideoCardType } from '@/lib/video/queries';
import { VideoCard } from './VideoCard';

interface VideoRailProps {
  title: string;
  href?: string;
  videos: VideoCardType[];
}

export function VideoRail({ title, href, videos }: VideoRailProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [hasPointer, setHasPointer] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < max - 4);
  }, []);

  useEffect(() => {
    setHasPointer(window.matchMedia('(hover: hover) and (pointer: fine)').matches);
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const onResize = () => updateArrows();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateArrows]);

  function scrollByDir(dir: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: 'smooth' });
  }

  if (videos.length === 0) return null;

  return (
    <section className="group/rail relative">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {href && (
          <Link
            href={href}
            className="text-sm font-medium text-muted transition-colors hover:text-accent-600"
          >
            查看全部 →
          </Link>
        )}
      </div>

      <div className="relative">
        {hasPointer && (
          <button
            type="button"
            onClick={() => scrollByDir(-1)}
            aria-label="Scroll left"
            className={`absolute left-0 top-0 z-10 hidden h-[calc(100%-3.5rem)] w-12 items-center justify-start bg-gradient-to-r from-[rgb(var(--bg))] to-transparent pl-1 transition-opacity duration-200 md:flex ${
              canLeft ? 'opacity-0 group-hover/rail:opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-zinc-800 shadow-md ring-1 ring-black/5 transition hover:scale-105 dark:bg-zinc-800/90 dark:text-zinc-100 dark:ring-white/10">
              <ChevronLeft className="h-5 w-5" />
            </span>
          </button>
        )}

        <div
          ref={scrollerRef}
          onScroll={updateArrows}
          className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {videos.map((video) => (
            <div
              key={video.id}
              className="w-[78%] shrink-0 snap-start sm:w-[44%] md:w-[31%] lg:w-[23.5%] xl:w-[19%]"
            >
              <VideoCard video={video} />
            </div>
          ))}
        </div>

        {hasPointer && (
          <button
            type="button"
            onClick={() => scrollByDir(1)}
            aria-label="Scroll right"
            className={`absolute right-0 top-0 z-10 hidden h-[calc(100%-3.5rem)] w-12 items-center justify-end bg-gradient-to-l from-[rgb(var(--bg))] to-transparent pr-1 transition-opacity duration-200 md:flex ${
              canRight ? 'opacity-0 group-hover/rail:opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-zinc-800 shadow-md ring-1 ring-black/5 transition hover:scale-105 dark:bg-zinc-800/90 dark:text-zinc-100 dark:ring-white/10">
              <ChevronRight className="h-5 w-5" />
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
