'use client';

// A 随刷 short in the drawer: a plain <video controls playsInline> in a 9:16
// box — deliberately NOT ShortsCell (its rail/view-ping/like wiring belongs to
// the feed; the drawer is a reading aid). 打开随刷 jumps to the real player.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { withBasePath } from '@/lib/base-path';
import type { EmbedShortData } from '@/lib/zones/types';
import { fmtCount, fmtDuration } from '@/components/zones/embeds/EmbedCard';

export function ShortPreview({ data }: { data: EmbedShortData }) {
  const t = useTranslations('zones');
  const poster = data.posterUrl ? withBasePath(data.posterUrl) : undefined;
  const src = data.videoUrl ? withBasePath(data.videoUrl) : undefined;

  return (
    <div className="space-y-4">
      <div
        className="mx-auto overflow-hidden rounded-2xl bg-black"
        style={{ height: 'min(70vh, 640px)', aspectRatio: '9 / 16', maxWidth: '100%' }}
      >
        {src ? (
          <video controls playsInline preload="metadata" poster={poster} src={src} className="h-full w-full object-contain" />
        ) : poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt={data.title} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">{t('preview_video_unavailable')}</div>
        )}
      </div>

      <div>
        {data.title && <h2 className="text-base font-semibold tracking-tight">{data.title}</h2>}
        {data.summary && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{data.summary}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <Link href={`/users/${data.uploader.handle}`} className="inline-flex items-center gap-1.5 hover:underline">
          <Avatar name={data.uploader.displayName} src={data.uploader.avatarUrl} size="xs" />
          <span className="text-zinc-800 dark:text-zinc-200">{data.uploader.displayName}</span>
        </Link>
        <DeptTag department={data.uploader.department} lab={data.uploader.lab} />
        <span className="font-mono tabular-nums">{fmtDuration(data.durationSec)}</span>
        <span className="font-mono tabular-nums">♡ {fmtCount(data.likeCount)}</span>
        <span className="font-mono tabular-nums">{t('embed_meta_views', { count: fmtCount(data.viewCount) })}</span>
      </div>

      <Link
        href={data.href}
        className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {t('preview_open_shorts')}
      </Link>
    </div>
  );
}
