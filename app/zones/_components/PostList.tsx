'use client';

// 技术专区 — post list with auto-load (IntersectionObserver sentinel, the
// HubFeed pattern: a failed page pauses the observer and the button retries)
// over `GET /api/zones/[slug]/posts` cursors. The RSC keys this component per
// stream (`key={tag|q|column|sort}`) so a soft navigation never mixes cursors.
// Empty state: a REAL 发布 button when the viewer may post, 清除筛选 when the
// list is filtered — never a description that only names formats. It is shown
// only when the STREAM is empty: page-1 rows the RSC moved into the notice /
// pinned bands (`bandedCount`) leave the list blank but not empty, and a blank
// page 1 with a cursor still gets its sentinel so the next page can arrive.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileText, Loader2, PenLine } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { LeadRoles } from '@/lib/zones/lead-roles';
import { zoneHref } from '@/lib/zones/shared';
import type { ZonePostCardView } from '@/lib/zones/types';
import { PostRow } from './PostRow';
import { BTN_PRIMARY, BTN_SECONDARY, readError } from './ui';

export interface PostListQuery {
  tag?: string | null;
  /** 栏目 slug, id or `_none` — page 1 is filtered server-side, so 加载更多 must carry it too. */
  column?: string | null;
  q?: string | null;
  sort?: string | null;
}

interface PostsPayload {
  items?: ZonePostCardView[];
  hasMore?: boolean;
  nextCursor?: string | null;
}

export function PostList({
  slug,
  initialItems,
  initialHasMore,
  initialCursor,
  query,
  compact = false,
  showZone = false,
  leadRoles,
  canPost = false,
  filtered = false,
  clearHref,
  bandedCount = 0,
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
  /** handle → 主版主/版主 for the role pills on author names. */
  leadRoles?: LeadRoles;
  /** Renders the 发布 CTA in the empty state. */
  canPost?: boolean;
  /** The stream is narrowed by column / tag / q — the empty state offers 清除筛选. */
  filtered?: boolean;
  /** Where 清除筛选 goes (defaults to the zone home). */
  clearHref?: string;
  /** Page-1 rows rendered by the notice / pinned bands instead of this list — when they were the whole page, render nothing rather than 「还没有帖子」 under cards that show the zone's posts. */
  bandedCount?: number;
  emptyTitle?: string;
  emptyDescription?: string;
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
      if (query.tag) sp.set('tag', query.tag);
      if (query.column) sp.set('column', query.column);
      if (query.q) sp.set('q', query.q);
      if (query.sort) sp.set('sort', query.sort);
      sp.set('cursor', cursor);
      const res = await fetch(`/api/zones/${encodeURIComponent(slug)}/posts?${sp.toString()}`);
      if (!res.ok) {
        const err = await readError(res);
        pushToast('error', err.reason ?? t('action_failed'));
        setAutoPaused(true);
        return;
      }
      const data = (await res.json()) as PostsPayload;
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
  }, [cursor, hasMore, query, slug, t]);

  // Observer through a ref so the effect depends only on primitives; rebuilt on
  // every cursor change on purpose (a sentinel that never left the viewport does
  // not fire again by itself after a short page).
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

  const loadMoreUi = hasMore ? (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <div className="mt-6 flex justify-center">
        <button type="button" onClick={() => void loadMore()} disabled={loading} className={BTN_SECONDARY}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('post_list_load_more')}
        </button>
      </div>
    </>
  ) : null;

  if (items.length === 0) {
    // The bands took every page-1 row but the stream goes on: keep paging alive.
    if (hasMore && cursor) return <div>{loadMoreUi}</div>;
    if (bandedCount > 0) return null;
    const title = emptyTitle ?? (filtered ? t('post_list_empty_filtered_title') : t('post_list_empty_title'));
    const desc =
      emptyDescription ??
      (filtered ? t('post_list_empty_filtered_v2') : canPost ? t('post_list_empty_can_post_v2') : t('post_list_empty_desc'));
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-8 py-14 text-center dark:border-zinc-800">
        <FileText className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
        <h3 className="mt-3 text-sm font-semibold">{title}</h3>
        <p className="mt-1 max-w-xs text-xs text-muted">{desc}</p>
        {(canPost || filtered) && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {canPost && (
              <Link href={`${zoneHref(slug)}/posts/new`} className={BTN_PRIMARY}>
                <PenLine className="h-4 w-4" />
                {t('zone_publish')}
              </Link>
            )}
            {filtered && (
              <Link href={clearHref ?? zoneHref(slug)} className={BTN_SECONDARY}>
                {t('post_list_clear_filters')}
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div>
        {items.map((post) => (
          <PostRow key={post.id} post={post} compact={compact} showZone={showZone} leadRoles={leadRoles} />
        ))}
      </div>
      {loadMoreUi}
    </div>
  );
}
