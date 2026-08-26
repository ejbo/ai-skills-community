'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { pushToast } from '@/components/Toaster';
import { PostComposer } from './PostComposer';
import { PostCard } from './PostCard';
import type { CurrentUser, PostView } from './types';

/** The 动态 tab: composer + post stream with cursor-based "load more". */
export function PostFeed({
  initialPosts,
  initialHasMore,
  initialCursor,
  currentUser,
  sort = 'new',
  showComposer = true,
  emptyTitle,
  emptyDescription,
}: {
  initialPosts: PostView[];
  initialHasMore: boolean;
  initialCursor: string | null;
  currentUser: CurrentUser | null;
  /** Feed ordering — load-more pages must stay on the same stream. */
  sort?: 'new' | 'hot';
  /** 搜索模式下隐藏发布框（新帖不属于当前筛选结果）。 */
  showComposer?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const t = useTranslations('discussion_ui');
  const [posts, setPosts] = useState<PostView[]>(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (loading || !cursor) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/discussion/posts?cursor=${encodeURIComponent(cursor)}&limit=10&sort=${sort}`,
      );
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(data.items as PostView[]).filter((p) => !seen.has(p.id))];
      });
      setHasMore(Boolean(data.hasMore));
      setCursor(data.nextCursor ?? null);
    } catch {
      pushToast('error', t('load_failed_retry'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {showComposer && (
        <PostComposer
          currentUser={currentUser}
          onPosted={(post) => setPosts((prev) => [post, ...prev])}
        />
      )}

      {posts.length === 0 ? (
        <EmptyState
          title={emptyTitle ?? t('feed_empty_title')}
          description={emptyDescription ?? t('feed_empty_desc')}
        />
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUser={currentUser}
            onRemoved={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
          />
        ))
      )}

      {hasMore && (
        <div className="flex justify-center pt-1">
          <button
            onClick={loadMore}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {t('load_more')}
          </button>
        </div>
      )}
    </div>
  );
}
