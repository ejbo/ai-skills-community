'use client';

// Desktop side panel of the fullscreen 随刷 feed (抖音-style right column):
// tabs 详情 | 评论, content follows the active video. Mobile keeps the bottom
// sheet drawer instead.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bookmark, Eye, Heart, Link2, Loader2, MessageCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { CommentSection } from '@/components/video/CommentSection';
import { relativeTime } from '@/lib/i18n-date';
import { formatCount, formatDuration } from '@/lib/video/types';
import type { VideoCommentView } from '@/lib/video/queries';
import { ShortsAuthorWorks } from './ShortsAuthorWorks';
import type { ShortsCurrentUser, ShortView } from './types';

const SCROLL_CLS =
  'min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.5)_transparent] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400/50 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5';

export type PanelTab = 'info' | 'comments' | 'works';

interface Props {
  item: ShortView;
  currentUser: ShortsCurrentUser;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** Deep-linked comment (notification ?focus=) for THIS item, else null. */
  focusCommentId: string | null;
  /** TA 的作品 card click → jump the feed to that short. */
  onJumpTo: (item: ShortView) => void;
}

export function ShortsSidePanel({
  item,
  currentUser,
  tab,
  onTabChange,
  focusCommentId,
  onJumpTo,
}: Props) {
  const t = useTranslations('shorts');
  const locale = useLocale();

  const [comments, setComments] = useState<{
    items: VideoCommentView[];
    nextCursor: string | null;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setComments(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(`/api/videos/${item.slug}/comments?sort=top`);
        if (!res.ok) throw new Error('failed');
        const d = await res.json();
        if (cancelled) return;
        setComments({ items: d.comments ?? [], nextCursor: d.nextCursor ?? null });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.slug]);

  const tabCls = (active: boolean) =>
    `relative pb-2.5 text-sm font-medium transition ${
      active
        ? 'text-zinc-900 dark:text-white'
        : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-zinc-200 px-5 pt-4 dark:border-zinc-800">
        <button type="button" onClick={() => onTabChange('info')} className={tabCls(tab === 'info')}>
          {t('panel_info')}
          {tab === 'info' && (
            <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-zinc-900 dark:bg-white" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onTabChange('comments')}
          className={tabCls(tab === 'comments')}
        >
          {t('comments')}
          <span className="ml-1 tabular-nums text-xs text-zinc-400">
            {formatCount(item.commentCount)}
          </span>
          {tab === 'comments' && (
            <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-zinc-900 dark:bg-white" />
          )}
        </button>
        <button type="button" onClick={() => onTabChange('works')} className={tabCls(tab === 'works')}>
          {t('panel_works')}
          {tab === 'works' && (
            <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-zinc-900 dark:bg-white" />
          )}
        </button>
      </div>

      {tab === 'works' ? (
        <div className={`${SCROLL_CLS} px-5 py-4`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium">{item.uploader.displayName}</p>
            <Link
              href={`/users/${item.uploader.handle}`}
              className="shrink-0 text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {t('author_profile')}
            </Link>
          </div>
          <ShortsAuthorWorks handle={item.uploader.handle} currentId={item.id} onSelect={onJumpTo} />
        </div>
      ) : tab === 'info' ? (
        <div className={`${SCROLL_CLS} px-5 py-5`}>
          {/* Uploader */}
          <div className="flex items-center gap-3">
            <Link href={`/users/${item.uploader.handle}`} className="shrink-0">
              <Avatar name={item.uploader.displayName} src={item.uploader.avatarUrl} size="lg" handle={item.uploader.handle} />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/users/${item.uploader.handle}`}
                  className="font-semibold hover:underline"
                >
                  {item.uploader.displayName}
                </Link>
                {!item.uploader.isPrivate && (
                  <span className="text-xs text-zinc-400">@{item.uploader.handle}</span>
                )}
                <DeptTag department={item.uploader.department} lab={item.uploader.lab} />
              </div>
              {item.publishedAt && (
                <p className="mt-0.5 text-xs text-zinc-400">
                  {relativeTime(item.publishedAt, locale)}
                </p>
              )}
            </div>
          </div>

          {/* 内容来源 */}
          <div className="mt-4 text-xs">
            {item.originType === 'repost' ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-zinc-100 px-3 py-2 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                <span className="font-medium">{t('origin_repost')}</span>
                {item.sourceAuthor && <span>{item.sourceAuthor}</span>}
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  >
                    <Link2 className="h-3 w-3" />
                    {t('source_url_label')}
                  </a>
                )}
              </div>
            ) : (
              <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                {t('origin_original')}
              </span>
            )}
          </div>

          {/* Full caption */}
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{item.summary || item.title}</p>

          {/* Stats */}
          <div className="mt-5 flex flex-wrap items-center gap-4 text-xs tabular-nums text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {formatCount(item.viewCount)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" />
              {formatCount(item.likeCount)}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" />
              {formatCount(item.commentCount)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Bookmark className="h-3.5 w-3.5" />
              {formatCount(item.favoriteCount)}
            </span>
            {item.durationSec > 0 && <span>{formatDuration(item.durationSec)}</span>}
          </div>
        </div>
      ) : (
        <div className={`${SCROLL_CLS} px-5 py-4`}>
          {comments ? (
            <CommentSection
              key={item.slug}
              slug={item.slug}
              initialComments={comments.items}
              initialCursor={comments.nextCursor}
              focusCommentId={focusCommentId}
              currentUser={{
                id: currentUser.id,
                canModerate: currentUser.canModerate,
                handle: currentUser.handle,
              }}
            />
          ) : failed ? (
            <p className="py-10 text-center text-sm text-zinc-400">{t('load_failed')}</p>
          ) : (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
