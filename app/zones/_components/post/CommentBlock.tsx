'use client';

// One comment row (root or reply): author + DeptTag + time, markdown body
// (tombstone when deleted), ♡ like toggle (authoritative reconcile), 回复,
// 编辑 (own comment within 15 min, or moderators), 删除 (own or moderators →
// tombstone contract). Implements the ?focus=<id> deep link: scroll + flash.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Heart } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';
import type { ZoneCommentView, ZoneCurrentUser } from '@/lib/zones/types';
import { CommentBox } from './CommentBox';

/** Own comments stay editable this long after posting (mirrors the API rule). */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

export interface CommentFocus {
  focusId: string | null;
  openRootId: string | null;
}

export function CommentBlock({
  zoneSlug,
  postId,
  comment,
  isRoot,
  currentUser,
  canModerate,
  canReply,
  focus,
  onReply,
  onRemoved,
  onEdited,
}: {
  zoneSlug: string;
  postId: string;
  comment: ZoneCommentView;
  isRoot: boolean;
  currentUser: ZoneCurrentUser | null;
  canModerate: boolean;
  canReply: boolean;
  focus: CommentFocus;
  onReply: () => void;
  onRemoved: (commentId: string, tombstoned: boolean, prunedParent: boolean) => void;
  onEdited: (c: ZoneCommentView) => void;
}) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [editing, setEditing] = useState(false);
  const [liked, setLiked] = useState(comment.likedByMe);
  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [likeBusy, setLikeBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  const isTombstone = comment.status === 'deleted';
  const isOwn = comment.isMine || (!!currentUser && currentUser.handle === comment.author.handle);
  const canDelete = !isTombstone && (isOwn || canModerate);
  const withinWindow = now - new Date(comment.createdAt).getTime() < COMMENT_EDIT_WINDOW_MS;
  const canEdit = !isTombstone && (canModerate || (isOwn && withinWindow));

  // Re-evaluate the edit window while the row is on screen.
  useEffect(() => {
    if (!isOwn || canModerate || !withinWindow) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [isOwn, canModerate, withinWindow]);

  useEffect(() => {
    if (focus.focusId !== comment.id || !ref.current) return;
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(timer);
  }, [focus.focusId, comment.id]);

  async function toggleLike() {
    if (likeBusy || isTombstone) return;
    if (!currentUser) {
      pushToast('error', t('post_login_required'));
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
      return;
    }
    setLikeBusy(true);
    const prev = { liked, likeCount };
    setLiked(!liked);
    setLikeCount(likeCount + (liked ? -1 : 1));
    try {
      const res = await fetch(`/api/zones/comments/${encodeURIComponent(comment.id)}/like`, { method: 'POST' });
      if (res.status === 401) {
        setLiked(prev.liked);
        setLikeCount(prev.likeCount);
        pushToast('error', t('post_login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { liked?: boolean; likeCount?: number };
      if (!res.ok) throw new Error('failed');
      setLiked(Boolean(data.liked));
      setLikeCount(typeof data.likeCount === 'number' ? data.likeCount : prev.likeCount);
    } catch {
      setLiked(prev.liked);
      setLikeCount(prev.likeCount);
      pushToast('error', t('post_action_failed'));
    } finally {
      setLikeBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('comment_delete_confirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zones/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { tombstoned?: boolean; prunedParent?: boolean; reason?: string };
      if (!res.ok) {
        pushToast('error', data.reason ?? t('comment_delete_failed'));
        return;
      }
      onRemoved(comment.id, Boolean(data.tombstoned), Boolean(data.prunedParent));
    } catch {
      pushToast('error', t('comment_delete_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} id={`zc-${comment.id}`} className={`rounded-xl transition-shadow ${flash ? 'ring-2 ring-zinc-900/40 dark:ring-zinc-100/40' : ''}`}>
      <div className="flex items-start gap-2.5">
        <Link href={`/users/${comment.author.handle}`} className="mt-0.5 shrink-0">
          <Avatar name={comment.author.displayName} src={comment.author.avatarUrl} size={isRoot ? 'sm' : 'xs'} handle={comment.author.handle} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href={`/users/${comment.author.handle}`} className="font-medium text-zinc-900 hover:underline dark:text-white">
              {comment.author.displayName}
            </Link>
            <DeptTag department={comment.author.department} lab={comment.author.lab} />
            <span className="text-muted">{relativeTime(comment.createdAt, locale)}</span>
            {comment.editedAt && !isTombstone && <span className="text-muted">{t('comment_edited')}</span>}
          </div>

          {isTombstone ? (
            <p className="mt-1 text-sm italic text-muted">{t('comment_deleted')}</p>
          ) : editing && currentUser ? (
            <div className="mt-2">
              <CommentBox
                zoneSlug={zoneSlug}
                postId={postId}
                currentUser={currentUser}
                editing={{ commentId: comment.id, initialBody: comment.bodyMd }}
                autoFocus
                onPosted={(c) => {
                  setEditing(false);
                  onEdited(c && c.id ? c : { ...comment, editedAt: new Date().toISOString() });
                }}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : (
            <div className="mt-1">
              <MarkdownRenderer content={comment.bodyMd} compact />
            </div>
          )}

          {!isTombstone && !editing && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted">
              <button
                type="button"
                onClick={toggleLike}
                disabled={likeBusy}
                aria-pressed={liked}
                className={`flex items-center gap-1 transition ${liked ? 'font-medium text-zinc-900 dark:text-zinc-50' : 'hover:text-zinc-700 dark:hover:text-zinc-200'}`}
              >
                <Heart className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} />
                <span className="font-mono tabular-nums">{likeCount > 0 ? likeCount : t('comment_like')}</span>
              </button>
              {canReply && (
                <button type="button" onClick={onReply} className="transition hover:text-zinc-700 dark:hover:text-zinc-200">
                  {t('comment_reply')}
                </button>
              )}
              {isRoot && comment.replyCount > 0 && <span className="font-mono tabular-nums">{t('comment_reply_count', { count: comment.replyCount })}</span>}
              {canEdit && (
                <button type="button" onClick={() => setEditing(true)} className="transition hover:text-zinc-700 dark:hover:text-zinc-200">
                  {tc('edit')}
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={remove} disabled={busy} className="transition hover:text-danger">
                  {tc('delete')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
