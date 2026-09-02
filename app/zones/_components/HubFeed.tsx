'use client';

// 技术专区 hub — the cross-zone 动态 feed (ask #6).
//
// Page 1 is server-rendered by app/zones/page.tsx (`listZoneFeed`) so the
// landing is fast and crawlable; this leaf only APPENDS. It pages through
// `GET /api/zones/feed` with the cursor the payload returns (keyset for 最新,
// `o:<n>` offset for 最热 — the route decides, we just echo it back).
//
// The RSC keys this component per stream (sort + every filter) so a soft
// navigation never mixes cursors from two different queries. Rows render with
// `showZone` (zone icon + name) and WITHOUT lead roles — a 版主 of one zone is
// nobody in another, so the cross-zone feed carries no pills.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Inbox, Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { ZonePostCardView } from '@/lib/zones/types';
import { PostRow } from './PostRow';
import { BTN_SECONDARY, readError } from './ui';

export interface HubFeedQuery {
  sort: string;
  q: string;
  labs: string[];
  departments: string[];
  columns: string[];
}

interface FeedPayload {
  items?: ZonePostCardView[];
  hasMore?: boolean;
  nextCursor?: string | null;
}

export function HubFeed({
  initialItems,
  initialHasMore,
  initialCursor,
  query,
  filtered,
}: {
  initialItems: ZonePostCardView[];
  initialHasMore: boolean;
  initialCursor: string | null;
  query: HubFeedQuery;
  filtered: boolean;
}) {
  const t = useTranslations('zones');
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  // A failed page stops the observer from hammering the route; the button retries.
  const [autoPaused, setAutoPaused] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (busy.current || !hasMore || !cursor) return;
    busy.current = true;
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (query.sort) sp.set('sort', query.sort);
      if (query.q) sp.set('q', query.q);
      if (query.labs.length) sp.set('lab', query.labs.join(','));
      if (query.departments.length) sp.set('department', query.departments.join(','));
      if (query.columns.length) sp.set('column', query.columns.join(','));
      sp.set('cursor', cursor);
      const res = await fetch(`/api/zones/feed?${sp.toString()}`);
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        setAutoPaused(true);
        return;
      }
      const data = (await res.json()) as FeedPayload;
      const page = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.filter((p) => !seen.has(p.id))];
      });
      setHasMore(Boolean(data.hasMore) && page.length > 0);
      setCursor(data.nextCursor ?? null);
      setAutoPaused(false);
    } catch {
      pushToast('error', t('action_failed'));
      setAutoPaused(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, hasMore, query, t]);

  // The observer calls through a ref so the effect depends only on primitives —
  // `query` is a fresh object every render and would otherwise rebuild it each
  // time. It IS rebuilt on every `cursor` change on purpose: an observer whose
  // target never left the viewport does not fire again by itself, so appending a
  // short page would stall the auto-load until the next scroll.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    if (!hasMore || autoPaused || !cursor) return;
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMoreRef.current();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, autoPaused, cursor]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-8 py-16 text-center dark:border-zinc-800">
        <Inbox className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
        <h3 className="mt-3 text-sm font-semibold">
          {filtered ? t('hub_feed_empty_filtered_title') : t('hub_feed_empty_title')}
        </h3>
        <p className="mt-1 max-w-sm text-xs text-muted">
          {filtered ? t('hub_feed_empty_filtered_v2') : t('hub_feed_empty_desc')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="border-t border-zinc-200 dark:border-zinc-800">
        {items.map((post) => (
          <PostRow key={post.id} post={post} showZone />
        ))}
      </div>
      <div ref={sentinel} aria-hidden className="h-px" />
      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loading} className={BTN_SECONDARY}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('post_list_load_more')}
          </button>
        </div>
      ) : (
        // Only worth saying on a list long enough to have felt like scrolling.
        items.length >= 8 && (
          <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
            {t('hub_feed_end')}
          </p>
        )
      )}
    </div>
  );
}
