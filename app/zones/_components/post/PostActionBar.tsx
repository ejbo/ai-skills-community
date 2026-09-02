'use client';

// Like (whileTap + rolling count) · bookmark · share (copy link) · comments
// jump, plus the per-access 更多 menu (编辑 / 置顶 / 锁定 / 设为公告 / 删除).
// Sticky at the viewport bottom on small screens — where it hides on
// scroll-down and returns on scroll-up (M14) — inline on desktop.
//
// Like / bookmark state is NOT owned here: `lb` is the page's single
// optimistic useLikeBookmark state, shared with the sticky PostContextStrip,
// so a tap on either surface paints both.
//
// 设为公告 / 取消公告 is the ONE place the UI still writes `type`: `announcement`
// is the moderator's notice on the zone home (the band), not a content
// format, so it lives behind ⋯ for `moderate` holders and PATCHes
// `{ type: 'announcement' | 'article' }`.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion';
import {
  Bookmark,
  Heart,
  Lock,
  Megaphone,
  MegaphoneOff,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Trash2,
  Unlock,
} from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { RollingNumber } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { copyText } from '@/lib/clipboard';
import { TWEEN } from '@/lib/motion';
import { zoneHref, zonePostHref } from '@/lib/zones/shared';
import type { ZoneAccess, ZoneCurrentUser, ZonePostDetailView } from '@/lib/zones/types';
import type { LikeBookmarkState } from './useLikeBookmark';

/** Below this scroll depth the bar never hides (mirrors NavBarShell). */
const HIDE_MIN_Y = 80;
/** Sub-pixel jitter guard (mirrors NavBarShell). */
const HIDE_DELTA = 6;

/**
 * Next hidden state of the bottom pill for one scroll event: reveal near the
 * top or on any upward scroll, hide on a downward scroll past the guard, keep
 * otherwise. Pure — pinned by tests/zones-toc-offset.test.ts.
 */
export function nextActionBarHidden(prev: boolean, y: number, delta: number): boolean {
  if (y < HIDE_MIN_Y || delta < -HIDE_DELTA) return false;
  if (delta > HIDE_DELTA) return true;
  return prev;
}

/** Off-screen offset — the bar is `sticky bottom-3`, so 100 % + the 12 px gap. Percent so Motion can interpolate it. */
const HIDDEN_Y = '125%';

export function PostActionBar({
  post,
  zoneSlug,
  access,
  currentUser,
  lb,
  commentCount,
  onCommentJump,
  className = '',
}: {
  post: ZonePostDetailView;
  zoneSlug: string;
  access: ZoneAccess;
  currentUser: ZoneCurrentUser | null;
  /** The page's shared optimistic like/bookmark state (useLikeBookmark). */
  lb: LikeBookmarkState;
  commentCount: number;
  onCommentJump: () => void;
  className?: string;
}) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const router = useRouter();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState<'flag' | 'delete' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // M14 — hide on scroll-down below `lg`. `lgRef` gates the scroll handler
  // (the bar is static on lg+); reduced motion never hides.
  const [hidden, setHidden] = useState(false);
  const lgRef = useRef(true);
  const lastY = useRef(0);
  const { scrollY } = useScroll();
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      lgRef.current = mq.matches;
      if (mq.matches) setHidden(false);
    };
    sync();
    lastY.current = window.scrollY;
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  useMotionValueEvent(scrollY, 'change', (y) => {
    if (lgRef.current || reduce) return;
    const delta = y - lastY.current;
    lastY.current = y;
    setHidden((prev) => nextActionBarHidden(prev, y, delta));
  });
  const barHidden = hidden && !menuOpen && !reduce;

  const canEdit = post.isAuthor || access.canModerate;
  // DELETE /posts/[postId] accepts the PRIMARY author or a `moderate` holder —
  // `post.isAuthor` also covers co-authors, who may edit but never delete.
  // PublicAuthor keeps the handle exactly for this ownership check.
  const isPrimaryAuthor = !!currentUser && post.author.handle === currentUser.handle;
  const canDelete = isPrimaryAuthor || access.canModerate;
  const canFlag = access.canModerate;
  const hasMenu = canEdit || canDelete || canFlag;
  const isAnnouncement = post.type === 'announcement';
  const base = `/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(post.id)}`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  async function share() {
    const url = `${window.location.origin}${withBasePath(zonePostHref(zoneSlug, post.id))}`;
    const ok = await copyText(url);
    pushToast(ok ? 'success' : 'error', ok ? t('post_link_copied') : tc('copy_failed'));
  }

  /** Moderator PATCH of one flag-like field; the page refreshes on success so every surface re-reads. */
  async function patchPost(body: Record<string, unknown>, successMessage: string) {
    if (busy) return;
    setBusy('flag');
    setMenuOpen(false);
    try {
      const res = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { reason?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('post_action_failed'));
        return;
      }
      pushToast('success', successMessage);
      router.refresh();
    } catch {
      pushToast('error', t('post_action_failed'));
    } finally {
      setBusy(null);
    }
  }

  function setFlag(flag: 'pinned' | 'locked', value: boolean) {
    const message =
      flag === 'pinned' ? (value ? t('post_pinned_toast') : t('post_unpinned_toast')) : value ? t('post_locked_toast') : t('post_unlocked_toast');
    void patchPost({ [flag]: value }, message);
  }

  function setAnnouncement(value: boolean) {
    void patchPost({ type: value ? 'announcement' : 'article' }, value ? t('post_announced_toast') : t('post_unannounced_toast'));
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
    <motion.div
      initial={false}
      animate={{ y: barHidden ? HIDDEN_Y : '0%' }}
      transition={reduce ? { duration: 0 } : TWEEN}
      onFocus={() => setHidden(false)}
      className={`sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-lg shadow-black/5 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/95 dark:shadow-black/30 dark:supports-[backdrop-filter]:bg-zinc-950/80 lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:shadow-none lg:backdrop-blur-0 lg:supports-[backdrop-filter]:bg-transparent dark:lg:bg-transparent dark:lg:supports-[backdrop-filter]:bg-transparent ${className}`}
    >
      <motion.button
        type="button"
        whileTap={reduce ? undefined : { scale: 0.92 }}
        onClick={() => lb.toggle('like')}
        disabled={lb.busy === 'like'}
        aria-pressed={lb.liked}
        aria-label={t('post_like')}
        className={`${pill} ${lb.liked ? on : idle}`}
      >
        <Heart className={`h-4 w-4 ${lb.liked ? 'fill-current' : ''}`} />
        <span className="font-mono tabular-nums">
          <RollingNumber value={lb.likeCount} />
        </span>
      </motion.button>

      <motion.button
        type="button"
        whileTap={reduce ? undefined : { scale: 0.92 }}
        onClick={() => lb.toggle('bookmark')}
        disabled={lb.busy === 'bookmark'}
        aria-pressed={lb.bookmarked}
        aria-label={t('post_bookmark')}
        className={`${pill} ${lb.bookmarked ? on : idle}`}
      >
        <Bookmark className={`h-4 w-4 ${lb.bookmarked ? 'fill-current' : ''}`} />
        <span className="font-mono tabular-nums">
          <RollingNumber value={lb.bookmarkCount} />
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
            <div className="surface absolute bottom-full right-0 z-30 mb-2 w-52 rounded-xl p-1 shadow-lg lg:bottom-auto lg:top-full lg:mb-0 lg:mt-2">
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
                  <button type="button" onClick={() => setAnnouncement(!isAnnouncement)} disabled={busy !== null} className={menuItem}>
                    {isAnnouncement ? <MegaphoneOff className="h-4 w-4 text-muted" /> : <Megaphone className="h-4 w-4 text-muted" />}
                    {isAnnouncement ? t('post_unannounce') : t('post_announce')}
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
    </motion.div>
  );
}
