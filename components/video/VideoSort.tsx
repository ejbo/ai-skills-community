'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { VIDEO_SORTS, type VideoSort as VideoSortValue } from '@/lib/video/types';

const LABEL_KEY: Record<VideoSortValue, 'feed.sort_latest' | 'feed.sort_trending' | 'feed.sort_popular'> = {
  latest: 'feed.sort_latest',
  trending: 'feed.sort_trending',
  popular: 'feed.sort_popular',
};

export function VideoSort() {
  const t = useTranslations('video');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const raw = params.get('sort');
  const current: VideoSortValue =
    raw === 'trending' || raw === 'popular' ? raw : 'latest';

  function select(sort: VideoSortValue) {
    const sp = new URLSearchParams(params.toString());
    sp.set('sort', sort);
    sp.delete('page');
    startTransition(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  return (
    <div
      role="tablist"
      aria-label="Sort"
      className={`surface inline-flex items-center gap-0.5 rounded-xl p-1 ${
        isPending ? 'opacity-70' : ''
      }`}
    >
      {VIDEO_SORTS.map((sort) => {
        const selected = current === sort;
        return (
          <button
            key={sort}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => select(sort)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
              selected
                ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-muted hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {t(LABEL_KEY[sort])}
          </button>
        );
      })}
    </div>
  );
}
