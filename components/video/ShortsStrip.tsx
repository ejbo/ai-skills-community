// 精选短视频 horizontal strip — vertical 9:16 poster cards linking into the
// 随刷 feed (/videos/shorts?v=<id>). Server-safe presentational component:
// parents (RSC) pass translated labels in; no client JS beyond CSS hover.

import Link from 'next/link';
import { ArrowRight, Eye, Heart, Play, Plus } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { formatCount, formatDuration } from '@/lib/video/types';

export interface ShortsStripItem {
  id: string;
  title: string;
  summary: string;
  posterUrl: string | null;
  durationSec: number;
  viewCount: number;
  likeCount: number;
}

export function ShortsStrip({
  title,
  viewAllLabel,
  uploadLabel,
  items,
  icon,
}: {
  title: string;
  viewAllLabel: string;
  /** When set, renders an 上传 CTA linking into the feed's upload dialog. */
  uploadLabel?: string;
  items: ShortsStripItem[];
  icon?: React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
          {icon && (
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-500/15 text-accent-600 dark:text-accent-400">
              {icon}
            </span>
          )}
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          {uploadLabel && (
            <Link
              href="/videos/shorts?upload=1"
              className="inline-flex items-center gap-1 rounded-full bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-600"
            >
              <Plus className="h-3.5 w-3.5" />
              {uploadLabel}
            </Link>
          )}
          <Link
            href="/videos/shorts"
            className="group flex items-center gap-1 text-sm font-medium text-accent-600 transition hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300"
          >
            {viewAllLabel}
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {items.map((s) => (
          <Link
            key={s.id}
            href={`/videos/shorts?v=${s.id}`}
            className="group relative aspect-[9/16] w-[150px] shrink-0 snap-start overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-black/5 transition hover:ring-accent-500/50 md:w-[168px]"
          >
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
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 ring-1 ring-white/40">
                <Play className="ml-0.5 h-5 w-5 text-white" fill="currentColor" />
              </span>
            </span>
            {s.durationSec > 0 && (
              <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                {formatDuration(s.durationSec)}
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
              <p className="line-clamp-2 text-xs font-medium leading-snug">{s.summary || s.title}</p>
              <p className="mt-1 flex items-center gap-2.5 text-[10px] text-white/70">
                <span className="inline-flex items-center gap-0.5">
                  <Eye className="h-3 w-3" />
                  {formatCount(s.viewCount)}
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <Heart className="h-3 w-3" />
                  {formatCount(s.likeCount)}
                </span>
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
