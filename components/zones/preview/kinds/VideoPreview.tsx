'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { withBasePath } from '@/lib/base-path';
import type { EmbedVideoData } from '@/lib/zones/types';
import { fmtCount, fmtDuration } from '@/components/zones/embeds/EmbedCard';

export function VideoPreview({ data }: { data: EmbedVideoData }) {
  const t = useTranslations('zones');
  const poster = data.posterUrl ? withBasePath(data.posterUrl) : undefined;
  const src = data.videoUrl ? withBasePath(data.videoUrl) : null;

  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        {src ? (
          <video controls playsInline preload="metadata" poster={poster} src={src} className="h-full w-full" />
        ) : (
          <>
            {poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt={data.title} className="h-full w-full object-cover opacity-60" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white">
              <Lock className="h-5 w-5" />
              {t('preview_video_unavailable')}
            </div>
          </>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold tracking-tight">{data.title}</h2>
        {data.summary && <p className="mt-1 line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{data.summary}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <Link href={`/users/${data.uploader.handle}`} className="inline-flex items-center gap-1.5 hover:underline">
          <Avatar name={data.uploader.displayName} src={data.uploader.avatarUrl} size="xs" handle={data.uploader.handle} />
          <span className="text-zinc-800 dark:text-zinc-200">{data.uploader.displayName}</span>
        </Link>
        <span className="font-mono tabular-nums">{fmtDuration(data.durationSec)}</span>
        <span className="font-mono tabular-nums">{t('embed_meta_views', { count: fmtCount(data.viewCount) })}</span>
        <span className="font-mono tabular-nums">♡ {fmtCount(data.likeCount)}</span>
      </div>

      <Link
        href={data.href}
        className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {t('preview_open_video')}
      </Link>
    </div>
  );
}
