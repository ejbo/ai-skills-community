'use client';

// TA 的作品 — vertical-card grid of one uploader's shorts, shown in a side
// panel (desktop feed tab / in-player panel / mobile sheet). Selecting a card
// is delegated to the host: the feed jumps in place, embeds deep-link.

import { useEffect, useState } from 'react';
import { Heart, Loader2, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { formatCount, formatDuration } from '@/lib/video/types';
import type { ShortView } from './types';

interface Props {
  handle: string;
  /** The short currently playing (ring highlight). */
  currentId: string | null;
  onSelect: (item: ShortView) => void;
}

export function ShortsAuthorWorks({ handle, currentId, onSelect }: Props) {
  const t = useTranslations('shorts');
  const [items, setItems] = useState<ShortView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(`/api/shorts?uploader=${encodeURIComponent(handle)}&sort=new&limit=20`);
        if (!res.ok) throw new Error('failed');
        const d = await res.json();
        if (!cancelled) setItems((d.items ?? []) as ShortView[]);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (failed) {
    return <p className="py-10 text-center text-sm text-zinc-400">{t('load_failed')}</p>;
  }
  if (!items) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-zinc-400">{t('works_empty')}</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s)}
          className={`group relative aspect-[9/16] overflow-hidden rounded-lg bg-zinc-900 text-left transition ${
            s.id === currentId
              ? 'ring-2 ring-zinc-900 dark:ring-white'
              : 'ring-1 ring-black/5 hover:ring-zinc-400 dark:ring-white/10'
          }`}
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
            <span className="absolute inset-0 flex items-center justify-center text-zinc-600">
              <Play className="h-6 w-6" />
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/70 to-transparent" />
          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-white drop-shadow">
            <Heart className="h-3 w-3" />
            {formatCount(s.likeCount)}
          </span>
          {s.durationSec > 0 && (
            <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium tabular-nums text-white/90 drop-shadow">
              {formatDuration(s.durationSec)}
            </span>
          )}
          {s.id === currentId && (
            <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
              {t('works_playing')}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
