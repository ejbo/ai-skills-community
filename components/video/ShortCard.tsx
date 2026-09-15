// 随刷短视频 grid card — the vertical 9:16 poster tile that deep-links into the
// immersive feed at that item. Extracted from ShortsBrowse so the GeekHub wall
// and the 个人主页 视频 tab render the SAME card. Server-safe (no hooks).
//
// Posters are served by the login-walled videos file route, so this card is
// only ever rendered on surfaces a signed-in viewer reaches.

import Link from 'next/link';
import { Heart, Play } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { formatCount, formatDuration } from '@/lib/video/types';
import type { ShortView } from '@/app/videos/shorts/_components/types';

export type ShortCardData = Pick<
  ShortView,
  'id' | 'title' | 'summary' | 'posterUrl' | 'likeCount' | 'durationSec'
> & { uploader: Pick<ShortView['uploader'], 'displayName'> };

export function ShortCard({
  short,
  showUploader = true,
  className = '',
}: {
  short: ShortCardData;
  /** Off on a single member's own wall (every card would repeat the same name). */
  showUploader?: boolean;
  className?: string;
}) {
  const s = short;
  return (
    <Link href={`/videos/shorts?v=${s.id}`} className={`group block ${className}`}>
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-black/5 transition group-hover:ring-zinc-900/25 dark:group-hover:ring-white/25">
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
      <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{s.summary || s.title}</p>
      {showUploader && <p className="mt-0.5 truncate text-xs text-muted">{s.uploader.displayName}</p>}
    </Link>
  );
}
