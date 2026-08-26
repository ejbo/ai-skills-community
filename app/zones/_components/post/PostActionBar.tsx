'use client';

// Like (whileTap + rolling count) · bookmark · share (copy link) · comments
// jump, plus the per-access 更多 menu (编辑 / 置顶 / 锁定 / 删除). Sticky at the
// viewport bottom on small screens, inline on desktop. Toggles are optimistic
// and reconcile with the authoritative re-read the like/bookmark routes return.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { Bookmark, Heart, Lock, MessageCircle, MoreHorizontal, Pencil, Pin, PinOff, Share2, Trash2, Unlock } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { RollingNumber } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { copyText } from '@/lib/clipboard';
import { zoneHref, zonePostHref } from '@/lib/zones/shared';
import type { ZoneAccess, ZoneCurrentUser, ZonePostDetailView } from '@/lib/zones/types';

export function PostActionBar({
  post,
  zoneSlug,
  access,
  currentUser,
  commentCount,
  onCommentJump,
  className = '',
}: {
  post: ZonePostDetailView;
  zoneSlug: string;
  access: ZoneAccess;
  currentUser: ZoneCurrentUser | null;
  commentCount: number;
  onCommentJump: () => void;
  className?: string;
}) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [bookmarked, setBookmarked] = useState(post.bookmarkedByMe);
  const [bookmarkCount, setBookmarkCount] = useState(post.bookmarkCount);
  const [busy, setBusy] = useState<'like' | 'bookmark' | 'flag' | 'delete' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const canEdit = post.isAuthor || access.canModerate;
  // DELETE /posts/[postId] accepts the PRIMARY author or a `moderate` holder —
  // `post.isAuthor` also covers co-authors, who may edit but never delete.
  // PublicAuthor keeps the handle exactly for this ownership check.
  const isPrimaryAuthor = !!currentUser && post.author.handle === currentUser.handle;
  const canDelete = isPrimaryAuthor || access.canModerate;
  const canFlag = access.canModerate;
  const hasMenu = canEdit || canDelete || canFlag;
  const base = `/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(post.id)}`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  function requireLogin(): boolean {
    if (currentUser) return true;
    pushToast('error', t('post_login_required'));
    router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
    return false;
  }

  async function toggle(kind: 'like' | 'bookmark') {
    if (busy || !requireLogin()) return;
    setBusy(kind);
    const prev = { liked, likeCount, bookmarked, bookmarkCount };
    if (kind === 'like') {
      setLiked(!liked);
      setLikeCount(likeCount + (liked ? -1 : 1));
    } else {
      setBookmarked(!bookmarked);
      setBookmarkCount(bookmarkCount + (bookmarked ? -1 : 1));
    }
    try {
      const res = await fetch(`${base}/${kind}`, { method: 'POST' });
      if (res.status === 401) {
        setLiked(prev.liked);
        setLikeCount(prev.likeCount);
        setBookmarked(prev.bookmarked);
        setBookmarkCount(prev.bookmarkCount);
        pushToast('error', t('post_login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { liked?: boolean; likeCount?: number; bookmarked?: boolean; bookmarkCount?: number; reason?: string };
      if (!res.ok) throw new Error(data.reason ?? 'failed');
      if (kind === 'like') {
        setLiked(Boolean(data.liked));
        setLikeCount(typeof data.likeCount === 'number' ? data.likeCount : prev.likeCount);
      } else {
        setBookmarked(Boolean(data.bookmarked));
        setBookmarkCount(typeof data.bookmarkCount === 'number' ? data.bookmarkCount : prev.bookmarkCount);
        pushToast('success', data.bookmarked ? t('post_bookmarked') : t('post_unbookmarked'));
      }
    } catch {
      setLiked(prev.liked);
      setLikeCount(prev.likeCount);
      setBookmarked(prev.bookmarked);
      setBookmarkCount(prev.bookmarkCount);
      pushToast('error', t('post_action_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    const url = `${window.location.origin}${withBasePath(zonePostHref(zoneSlug, post.id))}`;
    const ok = await copyText(url);
    pushToast(ok ? 'success' : 'error', ok ? t('post_link_copied') : tc('copy_failed'));
  }

  async function setFlag(flag: 'pinned' | 'locked', value: boolean) {
    if (busy) return;
    setBusy('flag');
    setMenuOpen(false);
    try {
      const res = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [flag]: value }) });
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('post_action_failed'));
        return;
      }
      pushToast('success', flag === 'pinned' ? (value ? t('post_pinned_toast') : t('post_unpinned_toast')) : value ? t('post_locked_toast') : t('post_unlocked_toast'));
      router.refresh();
    } catch {
      pushToast('error', t('post_action_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setMenuOpen(false);
    if (!confirm(t('post_delete_confirm'))) return;
    setBusy('delete');
    try {
      const res = await fetch(base, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('post_delete_failed'));
        return;
      }
      pushToast('success', t('post_deleted_toast'));
      router.push(zoneHref(zoneSlug));
      router.refresh();
    } catch {
      pushToast('error', t('post_delete_failed'));
    } finally {
      setBusy(null);
    }
  }

  const pill =
    'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition disabled:opacity-60';
  const idle = 'border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50';
  const on = 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900';
  const menuItem =
    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800';

  return (
    <div
      className={`sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-lg shadow-black/5 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/95 dark:shadow-black/30 dark:supports-[backdrop-filter]:bg-zinc-950/80 lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:shadow-none lg:backdrop-blur-0 lg:supports-[backdrop-filter]:bg-transparent dark:lg:bg-transparent dark:lg:supports-[backdrop-filter]:bg-transparent ${className}`}
    >
      <motion.button
        type="button"
        whileTap={reduce ? undefined : { scale: 0.92 }}
        onClick={() => toggle('like')}
        disabled={busy === 'like'}
        aria-pressed={liked}
        aria-label={t('post_like')}
        className={`${pill} ${liked ? on : idle}`}
      >
        <Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
        <span className="font-mono tabular-nums">
          <RollingNumber value={likeCount} />
        </span>
      </motion.button>

      <motion.button
        type="button"
        whileTap={reduce ? undefined : { scale: 0.92 }}
        onClick={() => toggle('bookmark')}
        disabled={busy === 'bookmark'}
        aria-pressed={bookmarked}
        aria-label={t('post_bookmark')}
        className={`${pill} ${bookmarked ? on : idle}`}
      >
        <Bookmark className={`h-4 w-4 ${bookmarked ? 'fill-current' : ''}`} />
        <span className="font-mono tabular-nums">
          <RollingNumber value={bookmarkCount} />
        </span>
      </motion.button>

      <button type="button" onClick={onCommentJump} aria-label={t('post_comments')} className={`${pill} ${idle}`}>
        <MessageCircle className="h-4 w-4" />
        <span className="font-mono tabular-nums">{commentCount}</span>
      </button>

      <button type="button" onClick={share} aria-label={t('post_share')} className={`${pill} ${idle}`}>
        <Share2 className="h-4 w-4" />
        <span className="hidden sm:inline">{t('post_share')}</span>
      </button>

      {hasMenu && (
        <div ref={menuRef} className="relative ml-auto">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={t('post_more_actions')}
            className={`${pill} ${idle} w-9 justify-center px-0`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="surface absolute bottom-full right-0 z-30 mb-2 w-48 rounded-xl p-1 shadow-lg lg:bottom-auto lg:top-full lg:mb-0 lg:mt-2">
              {canEdit && (
                <Link href={`/zones/${zoneSlug}/posts/${post.id}/edit`} className={menuItem} onClick={() => setMenuOpen(false)}>
                  <Pencil className="h-4 w-4 text-muted" />
                  {tc('edit')}
                </Link>
              )}
              {canFlag && (
                <>
                  <button type="button" onClick={() => setFlag('pinned', !post.pinned)} disabled={busy !== null} className={menuItem}>
                    {post.pinned ? <PinOff className="h-4 w-4 text-muted" /> : <Pin className="h-4 w-4 text-muted" />}
                    {post.pinned ? t('post_unpin') : t('post_pin')}
                  </button>
                  <button type="button" onClick={() => setFlag('locked', !post.locked)} disabled={busy !== null} className={menuItem}>
                    {post.locked ? <Unlock className="h-4 w-4 text-muted" /> : <Lock className="h-4 w-4 text-muted" />}
                    {post.locked ? t('post_unlock') : t('post_lock')}
                  </button>
                </>
              )}
              {canDelete && (
                <button type="button" onClick={remove} disabled={busy !== null} className={`${menuItem} text-danger`}>
                  <Trash2 className="h-4 w-4" />
                  {tc('delete')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
