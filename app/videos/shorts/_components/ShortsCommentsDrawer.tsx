'use client';

// Comment drawer for the 随刷 feed: bottom sheet on mobile, right-side panel on
// desktop. Mounts the video board's existing CommentSection (same routes, same
// 2-level thread contract, same ?focus= deep-link resolution — the section
// reads `focus` from window.location.search itself, which the feed preserves).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CommentSection } from '@/components/video/CommentSection';
import type { VideoCommentView } from '@/lib/video/queries';
import type { ShortsCurrentUser, ShortView } from './types';

interface Props {
  short: ShortView;
  currentUser: ShortsCurrentUser | null;
  /** Deep-linked comment to scroll/highlight (notification ?focus=), else null. */
  focusCommentId: string | null;
  /**
   * 'absolute' = scoped to the fullscreen feed root (default);
   * 'fixed' = portaled to <body> — used by embedded players (homepage / tab)
   * so 点评论 opens the 抖音-style side sheet without leaving the page.
   */
  variant?: 'absolute' | 'fixed';
  onClose: () => void;
}

export function ShortsCommentsDrawer({
  short,
  currentUser,
  focusCommentId,
  variant = 'absolute',
  onClose,
}: Props) {
  const t = useTranslations('shorts');
  const [data, setData] = useState<{
    comments: VideoCommentView[];
    nextCursor: string | null;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(`/api/videos/${short.slug}/comments?sort=top`);
        if (!res.ok) throw new Error('failed');
        const d = await res.json();
        if (cancelled) return;
        setData({ comments: d.comments ?? [], nextCursor: d.nextCursor ?? null });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [short.slug]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const content = (
    <div
      className={`${variant === 'fixed' ? 'fixed z-[90]' : 'absolute z-[15]'} inset-0 bg-black/40`}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={t('comments')}
        className="absolute inset-x-0 bottom-0 flex h-[72dvh] flex-col rounded-t-2xl bg-white text-zinc-900 shadow-2xl dark:bg-zinc-950 dark:text-zinc-100 md:inset-x-auto md:right-0 md:top-0 md:h-full md:w-[420px] md:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p className="text-sm font-semibold">{t('comments')}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label={t('close')}
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {data ? (
            <CommentSection
              key={short.slug}
              slug={short.slug}
              initialComments={data.comments}
              initialCursor={data.nextCursor}
              focusCommentId={focusCommentId}
              currentUser={
                currentUser
                  ? {
                      id: currentUser.id,
                      isAdmin: currentUser.isAdmin,
                      handle: currentUser.handle,
                    }
                  : null
              }
            />
          ) : failed ? (
            <p className="py-10 text-center text-sm text-zinc-500">{t('load_failed')}</p>
          ) : (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return variant === 'fixed' ? createPortal(content, document.body) : content;
}
