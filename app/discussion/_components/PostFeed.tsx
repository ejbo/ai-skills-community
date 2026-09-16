'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { pushToast } from '@/components/Toaster';
import { PostComposer } from './PostComposer';
import { PostCard } from './PostCard';
import { TopicCard } from './TopicCard';
import type { CurrentUser, PostView, StreamItemView } from './types';

const itemKey = (item: StreamItemView) =>
  item.kind === 'post' ? `post:${item.post.id}` : `topic:${item.topic.id}`;

/**
 * The 讨论区 stream: composer + cards with cursor-based "load more".
 *
 * `mode="all"` is the 全部 tab — feed posts AND forum topics merged by time
 * (`/api/discussion/stream`), so nobody has to switch tabs to see both.
 * `mode="posts"` is the 动态 tab — posts only, 最新 or 热门 (`/api/discussion/posts`).
 * Both keep the same item shape, so one list, one dedupe and one card switch.
 */
export function PostFeed({
  mode = 'posts',
  initialItems,
  initialHasMore,
  initialCursor,
  currentUser,
  sort = 'new',
  q = '',
  showComposer = true,
  emptyTitle,
  emptyDescription,
}: {
  mode?: 'all' | 'posts';
  initialItems: StreamItemView[];
  initialHasMore: boolean;
  initialCursor: string | null;
  currentUser: CurrentUser | null;
  /** 动态 ordering — load-more pages must stay on the same stream. */
  sort?: 'new' | 'hot';
  /** 全部 search term; its load-more pages carry it (the stream pages by keyset). */
  q?: string;
  /** 搜索模式下隐藏发布框（新帖不属于当前筛选结果）。 */
  showComposer?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const t = useTranslations('discussion_ui');
  const [items, setItems] = useState<StreamItemView[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (loading || !cursor) return;
    setLoading(true);
    try {
      const url =
        mode === 'all'
          ? `/api/discussion/stream?cursor=${encodeURIComponent(cursor)}&limit=10${q ? `&q=${encodeURIComponent(q)}` : ''}`
          : `/api/discussion/posts?cursor=${encodeURIComponent(cursor)}&limit=10&sort=${sort}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      const next: StreamItemView[] =
        mode === 'all'
          ? (data.items as StreamItemView[])
          : (data.items as PostView[]).map((post) => ({ kind: 'post' as const, post }));
      setItems((prev) => {
        const seen = new Set(prev.map(itemKey));
        return [...prev, ...next.filter((item) => !seen.has(itemKey(item)))];
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
    <div className="w-full space-y-4">
      {showComposer && (
        <PostComposer
          currentUser={currentUser}
          onPosted={(post) => setItems((prev) => [{ kind: 'post', post }, ...prev])}
        />
      )}

      {items.length === 0 ? (
        <EmptyState
          title={emptyTitle ?? t('feed_empty_title')}
          description={emptyDescription ?? t('feed_empty_desc')}
        />
      ) : (
        items.map((item) =>
          item.kind === 'post' ? (
            <PostCard
              key={itemKey(item)}
              post={item.post}
              currentUser={currentUser}
              onRemoved={(id) =>
                setItems((prev) => prev.filter((p) => !(p.kind === 'post' && p.post.id === id)))
              }
            />
          ) : (
            <TopicCard key={itemKey(item)} topic={item.topic} />
          ),
        )
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
