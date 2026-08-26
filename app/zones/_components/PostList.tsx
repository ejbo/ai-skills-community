'use client';

// 技术专区 — post list with 加载更多 (cursor from GET /api/zones/[slug]/posts).
// The RSC keys this component per stream (`key={type|tag|q|sort}`) so a soft
// navigation never mixes cursors. Neutral empty block — no accent EmptyState.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { ZonePostCardView } from '@/lib/zones/types';
import { PostRow } from './PostRow';
import { BTN_SECONDARY, readError } from './ui';

export interface PostListQuery {
  type?: string | null;
  tag?: string | null;
  q?: string | null;
  sort?: string | null;
}

export function PostList({
  slug,
  initialItems,
  initialHasMore,
  initialCursor,
  query,
  compact = false,
  showZone = false,
  emptyTitle,
  emptyDescription,
}: {
  slug: string;
  initialItems: ZonePostCardView[];
  initialHasMore: boolean;
  initialCursor: string | null;
  query: PostListQuery;
  compact?: boolean;
  showZone?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const t = useTranslations('zones');
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (loading || !hasMore || !cursor) return;
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (query.type) sp.set('type', query.type);
      if (query.tag) sp.set('tag', query.tag);
      if (query.q) sp.set('q', query.q);
      if (query.sort) sp.set('sort', query.sort);
      sp.set('cursor', cursor);
      const res = await fetch(`/api/zones/${slug}/posts?${sp.toString()}`);
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        return;
      }
      const data = (await res.json()) as { items: ZonePostCardView[]; hasMore: boolean; nextCursor: string | null };
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...data.items.filter((p) => !seen.has(p.id))];
      });
      setHasMore(Boolean(data.hasMore));
      setCursor(data.nextCursor ?? null);
    } catch {
      pushToast('error', t('action_failed'));
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-8 py-14 text-center dark:border-zinc-800">
        <FileText className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
        <h3 className="mt-3 text-sm font-semibold">{emptyTitle ?? t('post_list_empty_title')}</h3>
        <p className="mt-1 max-w-xs text-xs text-muted">{emptyDescription ?? t('post_list_empty_desc')}</p>
      </div>
    );
  }

  return (
    <div>
      <div>
        {items.map((post) => (
          <PostRow key={post.id} post={post} compact={compact} showZone={showZone} />
        ))}
      </div>
      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loading} className={BTN_SECONDARY}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('post_list_load_more')}
          </button>
        </div>
      )}
    </div>
  );
}
