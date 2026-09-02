'use client';

// ONE optimistic like / bookmark state per post page, shared by every surface
// that can toggle it (the end-of-article PostActionBar and the sticky
// the action bar). Lifted verbatim from it: optimistic paint →
// authoritative reconcile from the route's re-read → rollback on failure;
// 401 rolls back and sends the viewer to login; bookmarking toasts. Created
// once in PostDetail and handed DOWN — a second instance would let the two
// bars drift apart after a click.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';
import type { ZoneCurrentUser, ZonePostDetailView } from '@/lib/zones/types';

export type LikeBookmarkKind = 'like' | 'bookmark';

export interface LikeBookmarkState {
  liked: boolean;
  likeCount: number;
  bookmarked: boolean;
  bookmarkCount: number;
  busy: LikeBookmarkKind | null;
  toggle: (kind: LikeBookmarkKind) => void;
}

interface Snapshot {
  liked: boolean;
  likeCount: number;
  bookmarked: boolean;
  bookmarkCount: number;
}

export function useLikeBookmark(post: ZonePostDetailView, zoneSlug: string, currentUser: ZoneCurrentUser | null): LikeBookmarkState {
  const t = useTranslations('zones');
  const router = useRouter();
  const [state, setState] = useState<Snapshot>({
    liked: post.likedByMe,
    likeCount: post.likeCount,
    bookmarked: post.bookmarkedByMe,
    bookmarkCount: post.bookmarkCount,
  });
  const [busy, setBusy] = useState<LikeBookmarkKind | null>(null);

  const base = `/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(post.id)}`;

  const toggle = useCallback(
    (kind: LikeBookmarkKind) => {
      if (busy) return;
      if (!currentUser) {
        pushToast('error', t('post_login_required'));
        router.push(currentLoginHref());
        return;
      }
      const prev = state;
      setBusy(kind);
      setState(
        kind === 'like'
          ? { ...prev, liked: !prev.liked, likeCount: prev.likeCount + (prev.liked ? -1 : 1) }
          : { ...prev, bookmarked: !prev.bookmarked, bookmarkCount: prev.bookmarkCount + (prev.bookmarked ? -1 : 1) },
      );
      void (async () => {
        try {
          const res = await fetch(`${base}/${kind}`, { method: 'POST' });
          if (res.status === 401) {
            setState(prev);
            pushToast('error', t('post_login_required'));
            router.push(currentLoginHref());
            return;
          }
          const data = (await res.json().catch(() => ({}))) as {
            liked?: boolean;
            likeCount?: number;
            bookmarked?: boolean;
            bookmarkCount?: number;
            reason?: string;
          };
          if (!res.ok) throw new Error(data.reason ?? 'failed');
          if (kind === 'like') {
            setState((s) => ({ ...s, liked: Boolean(data.liked), likeCount: typeof data.likeCount === 'number' ? data.likeCount : prev.likeCount }));
          } else {
            setState((s) => ({
              ...s,
              bookmarked: Boolean(data.bookmarked),
              bookmarkCount: typeof data.bookmarkCount === 'number' ? data.bookmarkCount : prev.bookmarkCount,
            }));
            pushToast('success', data.bookmarked ? t('post_bookmarked') : t('post_unbookmarked'));
          }
        } catch {
          setState(prev);
          pushToast('error', t('post_action_failed'));
        } finally {
          setBusy(null);
        }
      })();
    },
    [base, busy, currentUser, router, state, t],
  );

  return { ...state, busy, toggle };
}
