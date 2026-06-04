'use client';

import { useCallback, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import type { CommentSort } from '@/lib/video/types';
import type { VideoCommentView } from '@/lib/video/queries';
import { CommentComposer } from './CommentComposer';
import { CommentItem } from './CommentItem';

interface Props {
  slug: string;
  initialComments: VideoCommentView[];
  initialCursor: string | null;
  currentUser: { id: string; isAdmin: boolean; handle?: string } | null;
}

export function CommentSection({ slug, initialComments, initialCursor, currentUser }: Props) {
  const t = useTranslations('video');
  const [comments, setComments] = useState<VideoCommentView[]>(initialComments);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [sort, setSort] = useState<CommentSort>('top');
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);

  const reload = useCallback(
    async (nextSort: CommentSort) => {
      setReloading(true);
      try {
        const res = await fetch(`/api/videos/${slug}/comments?sort=${nextSort}`);
        if (!res.ok) throw res;
        const data = await res.json();
        setComments((data.comments ?? []) as VideoCommentView[]);
        setCursor(data.nextCursor ?? null);
      } catch {
        pushToast('error', '加载评论失败');
      } finally {
        setReloading(false);
      }
    },
    [slug],
  );

  function changeSort(next: CommentSort) {
    if (next === sort) return;
    setSort(next);
    reload(next);
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/videos/${slug}/comments?sort=${sort}&cursor=${cursor}`);
      if (!res.ok) throw res;
      const data = await res.json();
      setComments((prev) => [...prev, ...((data.comments ?? []) as VideoCommentView[])]);
      setCursor(data.nextCursor ?? null);
    } catch {
      pushToast('error', '加载评论失败');
    } finally {
      setLoading(false);
    }
  }

  function onPosted(c: VideoCommentView) {
    setComments((prev) => [c, ...prev]);
  }

  function removeComment(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MessageSquare className="h-4.5 w-4.5" />
          {t('comments.title')}
          <span className="font-mono text-sm tabular-nums text-muted">{comments.length}</span>
        </h2>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-0.5 text-xs dark:border-zinc-800">
          <button
            onClick={() => changeSort('top')}
            className={`rounded-md px-2.5 py-1 font-medium transition ${
              sort === 'top'
                ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {t('comments.sort_top')}
          </button>
          <button
            onClick={() => changeSort('newest')}
            className={`rounded-md px-2.5 py-1 font-medium transition ${
              sort === 'newest'
                ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {t('comments.sort_newest')}
          </button>
        </div>
      </div>

      <CommentComposer slug={slug} onPosted={onPosted} />

      {reloading ? (
        <div className="flex justify-center py-8 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{t('comments.empty')}</p>
      ) : (
        <div className="space-y-6">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              slug={slug}
              comment={comment}
              currentUser={currentUser}
              onChanged={() => removeComment(comment.id)}
            />
          ))}
        </div>
      )}

      {cursor && !reloading && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-700"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('comments.load_more')}
          </button>
        </div>
      )}
    </section>
  );
}
