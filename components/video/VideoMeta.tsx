import Link from 'next/link';
import { Calendar, Pencil, Tag as TagIcon } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { getTranslations } from 'next-intl/server';
import type { VideoDetail } from '@/lib/video/queries';
import { formatCount } from '@/lib/video/types';
import { VideoEngagementBar } from './VideoEngagementBar';

interface Props {
  video: VideoDetail;
  privileged: boolean;
  initialLiked: boolean;
  initialFavorited: boolean;
}

export async function VideoMeta({ video, privileged, initialLiked, initialFavorited }: Props) {
  const t = await getTranslations('video');
  const uploader = video.uploader;
  const publishedAt = video.publishedAt ?? video.createdAt;

  const hasInterviewee =
    video.intervieweeName || video.intervieweeTitle || video.intervieweeOrg || video.intervieweeBio;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{video.title}</h1>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span className="font-mono tabular-nums">
          {formatCount(video.viewCount)} {t('detail.views')}
        </span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {formatDistanceToNowStrict(publishedAt, { addSuffix: true })}
        </span>
        {video.category && (
          <>
            <span>·</span>
            <Link
              href={`/videos?category=${video.category.slug}`}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              {video.category.name}
            </Link>
          </>
        )}
      </div>

      {/* Uploader + engagement row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-zinc-100 py-3 dark:border-zinc-800/60">
        <div className="flex items-center gap-3">
          {uploader.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploader.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100">
              {uploader.displayName.charAt(0)}
            </div>
          )}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted">{t('detail.by')}</div>
            <Link href={`/users/${uploader.handle}`} className="text-sm font-medium hover:underline">
              {uploader.displayName}
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <VideoEngagementBar
            slug={video.slug}
            likeCount={video.likeCount}
            favoriteCount={video.favoriteCount}
            initialLiked={initialLiked}
            initialFavorited={initialFavorited}
          />
          {privileged && (
            <Link
              href={`/manage/videos/${video.id}/edit`}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium transition hover:border-zinc-400 dark:border-zinc-700"
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </Link>
          )}
        </div>
      </div>

      {/* Interviewee / guest block */}
      {hasInterviewee && (
        <div className="surface rounded-2xl p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {t('detail.guest')}
          </div>
          <div className="text-sm font-medium">{video.intervieweeName}</div>
          {(video.intervieweeTitle || video.intervieweeOrg) && (
            <div className="text-xs text-muted">
              {[video.intervieweeTitle, video.intervieweeOrg].filter(Boolean).join(' · ')}
            </div>
          )}
          {video.intervieweeBio && (
            <p className="mt-2 text-sm text-muted">{video.intervieweeBio}</p>
          )}
        </div>
      )}

      {/* Tags */}
      {video.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {video.tags.map(({ tag }) => (
            <Link
              key={tag.slug}
              href={`/videos?q=${encodeURIComponent(tag.name)}`}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <TagIcon className="h-2.5 w-2.5" />
              {tag.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
