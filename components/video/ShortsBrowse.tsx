// GeekHub → 短视频 tab: Douyin-desktop-style browse surface. Hero = the SAME
// unified player as the feed/homepage (ShortsShowcase → ShortsCell), flanked by
// two side cards, with a vertical card grid below. Cards deep-link into the
// immersive 随刷 feed at that item.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Heart, Play } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { formatCount, formatDuration } from '@/lib/video/types';
import { ShortsShowcase } from '@/app/_components/home/ShortsShowcase';
import type { ShortView } from '@/app/videos/shorts/_components/types';

export async function ShortsBrowse({
  heroItems,
  latest,
}: {
  heroItems: ShortView[];
  latest: ShortView[];
}) {
  const ts = await getTranslations('shorts');
  const sideCards = latest.filter((s) => !heroItems.slice(0, 1).some((h) => h.id === s.id)).slice(0, 2);
  const gridItems = latest;

  return (
    <div className="space-y-8">
      {/* Hero player + side cards (Douyin 精选 layout) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),300px] xl:grid-cols-[minmax(0,1fr),340px]">
        {heroItems.length > 0 ? (
          <ShortsShowcase items={heroItems} className="h-[500px] xl:h-[560px]" />
        ) : (
          <div className="surface flex h-[500px] flex-col items-center justify-center gap-3 rounded-2xl px-6 text-center xl:h-[560px]">
            <p className="text-sm font-medium">{ts('empty_title')}</p>
            <p className="max-w-xs text-xs text-muted">{ts('empty_hint')}</p>
          </div>
        )}
        <div className="hidden gap-4 lg:grid lg:grid-rows-2">
          {sideCards.map((s) => (
            <Link
              key={s.id}
              href={`/videos/shorts?v=${s.id}`}
              className="group relative overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-black/5 transition hover:ring-accent-500/50"
            >
              {s.posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- same-origin stored poster
                <img
                  src={withBasePath(s.posterUrl)}
                  alt={s.title}
                  className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 ring-1 ring-white/40">
                  <Play className="ml-0.5 h-5 w-5 text-white" fill="currentColor" />
                </span>
              </span>
              {s.durationSec > 0 && (
                <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                  {formatDuration(s.durationSec)}
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 p-3 text-white">
                <p className="line-clamp-2 text-sm font-medium leading-snug">{s.summary || s.title}</p>
                <p className="mt-1 flex items-center gap-2 text-[11px] text-white/70">
                  <span>{s.uploader.displayName}</span>
                  <span className="inline-flex items-center gap-0.5">
                    <Heart className="h-3 w-3" />
                    {formatCount(s.likeCount)}
                  </span>
                </p>
              </div>
            </Link>
          ))}
          {sideCards.length === 0 && <div className="surface rounded-2xl" />}
        </div>
      </div>

      {/* Latest grid (Douyin card wall, vertical 9:16 cards) */}
      {gridItems.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">{ts('browse_latest')}</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {gridItems.map((s) => (
              <Link key={s.id} href={`/videos/shorts?v=${s.id}`} className="group block">
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-black/5 transition group-hover:ring-accent-500/50">
                  {s.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- same-origin stored poster
                    <img
                      src={withBasePath(s.posterUrl)}
                      alt={s.title}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
                      <Play className="h-8 w-8" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/70 to-transparent" />
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 text-xs font-medium text-white drop-shadow">
                    <Heart className="h-3.5 w-3.5" />
                    {formatCount(s.likeCount)}
                  </span>
                  {s.durationSec > 0 && (
                    <span className="absolute bottom-2 right-2 text-[11px] font-medium tabular-nums text-white/90 drop-shadow">
                      {formatDuration(s.durationSec)}
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">
                  {s.summary || s.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">{s.uploader.displayName}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
