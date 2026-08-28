'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { copyText } from '@/lib/clipboard';
import { relativeTime } from '@/lib/i18n-date';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { PostMediaGallery } from './PostMediaGallery';
import { PostComments } from './PostComments';
import { ReactionsPanel } from './ReactionsPanel';
import { PinnedBadge } from './badges';
import {
  REACTION_META,
  REACTION_ORDER,
  isReactionType,
  type ReactionType,
} from './reactions';
import type { CurrentUser, PostView } from './types';

/**
 * One feed post — LinkedIn-style card: author row, clamped body with 展开,
 * media gallery, like/comment/share actions and an inline comment section.
 * In `detail` mode (the shareable /discussion/posts/<id> page) the body is
 * unclamped and comments are open by default.
 */
export function PostCard({
  post,
  currentUser,
  detail = false,
  focusId,
  onRemoved,
}: {
  post: PostView;
  currentUser: CurrentUser | null;
  detail?: boolean;
  focusId?: string;
  onRemoved?: (id: string) => void;
}) {
  const t = useTranslations('discussion');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [myReaction, setMyReaction] = useState<ReactionType | null>(
    isReactionType(post.myReaction) ? post.myReaction : null,
  );
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reactions, setReactions] = useState(post.reactions);
  const [reactBusy, setReactBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(detail);
  const [expanded, setExpanded] = useState(detail);
  const [overflowing, setOverflowing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinned, setPinned] = useState(post.pinned);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(post.bodyMd);
  const [bodyMd, setBodyMd] = useState(post.bodyMd);
  const [editedAt, setEditedAt] = useState(post.editedAt);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const paletteEnterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paletteLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAuthor = currentUser?.handle === post.author.handle;
  const canModerate = Boolean(currentUser?.canModerate);
  // LinkedIn's clamp split: fewer lines when the card also carries media.
  const clampMax = post.media.length > 0 ? '5.5rem' : '9rem';

  // Show 展开 only when the body actually overflows the clamp. Async-height
  // children (PollWidget fetch, late-loading images) grow AFTER mount, so the
  // one-shot measure is paired with a ResizeObserver on the inner content —
  // the clamped div itself stops changing height once it hits maxHeight.
  useEffect(() => {
    if (expanded || !bodyRef.current) return;
    const el = bodyRef.current;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 2);
    measure();
    const inner = el.firstElementChild;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [expanded, bodyMd]);

  useEffect(() => {
    if (!menuOpen) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  function bumpSummary(
    list: { reaction: string; count: number }[],
    type: string,
    delta: 1 | -1,
  ) {
    const next = list.map((r) => ({ ...r }));
    const hit = next.find((r) => r.reaction === type);
    if (hit) hit.count += delta;
    else if (delta > 0) next.push({ reaction: type, count: 1 });
    return next.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  }

  /** LinkedIn semantics: same type again removes; a different type switches. */
  async function react(type: ReactionType) {
    if (reactBusy) return;
    setPaletteOpen(false);
    setReactBusy(true);
    const prev = { myReaction, likeCount, reactions };
    // Optimistic flip, reconciled with the authoritative response below.
    if (myReaction === type) {
      setMyReaction(null);
      setLikeCount(likeCount - 1);
      setReactions(bumpSummary(reactions, type, -1));
    } else if (myReaction) {
      setMyReaction(type);
      setReactions(bumpSummary(bumpSummary(reactions, myReaction, -1), type, 1));
    } else {
      setMyReaction(type);
      setLikeCount(likeCount + 1);
      setReactions(bumpSummary(reactions, type, 1));
    }
    try {
      const res = await fetch(`/api/discussion/posts/${post.id}/like`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reaction: type }),
      });
      if (res.status === 401) {
        setMyReaction(prev.myReaction);
        setLikeCount(prev.likeCount);
        setReactions(prev.reactions);
        pushToast('error', t('login_to_react'));
        router.push(currentLoginHref());
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('failed');
      setMyReaction(isReactionType(data.myReaction) ? data.myReaction : null);
      setLikeCount(typeof data.likeCount === 'number' ? data.likeCount : prev.likeCount);
      if (Array.isArray(data.reactions)) setReactions(data.reactions);
    } catch {
      setMyReaction(prev.myReaction);
      setLikeCount(prev.likeCount);
      setReactions(prev.reactions);
      pushToast('error', t('op_failed_retry'));
    } finally {
      setReactBusy(false);
    }
  }

  function paletteEnter() {
    if (paletteLeaveTimer.current) clearTimeout(paletteLeaveTimer.current);
    paletteEnterTimer.current = setTimeout(() => setPaletteOpen(true), 350);
  }

  function paletteLeave() {
    if (paletteEnterTimer.current) clearTimeout(paletteEnterTimer.current);
    paletteLeaveTimer.current = setTimeout(() => setPaletteOpen(false), 250);
  }

  useEffect(
    () => () => {
      if (paletteEnterTimer.current) clearTimeout(paletteEnterTimer.current);
      if (paletteLeaveTimer.current) clearTimeout(paletteLeaveTimer.current);
    },
    [],
  );

  async function share() {
    const url = `${window.location.origin}${withBasePath(`/discussion/posts/${post.id}`)}`;
    const ok = await copyText(url);
    pushToast(ok ? 'success' : 'error', ok ? t('link_copied') : tc('copy_failed'));
  }

  async function togglePin() {
    setMenuOpen(false);
    const next = !pinned;
    const res = await fetch(`/api/discussion/posts/${post.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      pushToast('error', data.reason ?? t('op_failed'));
      return;
    }
    setPinned(next);
    pushToast('success', next ? t('pinned_toast') : t('unpinned_toast'));
    router.refresh();
  }

  async function saveEdit() {
    const trimmed = editDraft.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('save_failed'));
        return;
      }
      setBodyMd(trimmed);
      setEditedAt(data.post?.editedAt ?? new Date().toISOString());
      setEditing(false);
      pushToast('success', t('updated_toast'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setMenuOpen(false);
    if (!confirm(t('confirm_delete_post'))) return;
    const res = await fetch(`/api/discussion/posts/${post.id}`, { method: 'DELETE' });
    if (!res.ok) {
      pushToast('error', t('delete_failed'));
      return;
    }
    pushToast('success', t('deleted_toast'));
    if (detail) {
      router.push('/discussion');
      router.refresh();
    } else {
      onRemoved?.(post.id);
    }
  }

  const actionBtn =
    'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-800';

  return (
    <article className="surface rounded-2xl p-4">
      {/* Author row */}
      <div className="flex items-start gap-3">
        <Link href={`/users/${post.author.handle}`} className="shrink-0">
          <Avatar name={post.author.displayName} src={post.author.avatarUrl} size="md" handle={post.author.handle} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/users/${post.author.handle}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              {post.author.displayName}
            </Link>
            <DeptTag department={post.author.department} lab={post.author.lab} />
            {pinned && <PinnedBadge />}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            {!post.author.isPrivate && (
              <>
                <span>@{post.author.handle}</span>
                <span>·</span>
              </>
            )}
            <span>{relativeTime(post.createdAt, locale)}</span>
            {editedAt && <span>· {t('edited')}</span>}
          </div>
        </div>
        <div ref={menuRef} className="relative shrink-0">
          {/* Feed cards: the corner button OPENS the post directly (new tab) —
              no dropdown. Management actions live on the detail page. */}
          {!detail ? (
            <a
              href={withBasePath(`/discussion/posts/${post.id}`)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('open_post')}
              title={t('open_post')}
              className="block rounded-lg p-1.5 text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <MoreHorizontal className="h-4 w-4" />
            </a>
          ) : (
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t('more_actions')}
              className="rounded-lg p-1.5 text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}
          {detail && menuOpen && (
            <div className="surface absolute right-0 top-full z-30 mt-1 w-44 rounded-xl p-1 shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void share();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Link2 className="h-4 w-4" />
                {t('copy_link')}
              </button>
              {isAuthor && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setEditDraft(bodyMd);
                    setEditing(true);
                    setExpanded(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Pencil className="h-4 w-4" />
                  {tc('edit')}
                </button>
              )}
              {canModerate && (
                <button
                  onClick={togglePin}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  {pinned ? t('unpin') : t('pin')}
                </button>
              )}
              {(isAuthor || canModerate) && (
                <button
                  onClick={remove}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Trash2 className="h-4 w-4" />
                  {tc('delete')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      {editing ? (
        <div className="mt-3 space-y-2">
          <RichTextEditor
            value={editDraft}
            onChange={setEditDraft}
            variant="compact"
            maxLength={8000}
            ariaLabel={t('edit_post_aria')}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="h-8 rounded-lg px-3 text-xs font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {tc('cancel')}
            </button>
            <button
              onClick={saveEdit}
              disabled={busy || !editDraft.trim()}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-xs font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {tc('save')}
            </button>
          </div>
        </div>
      ) : (
        bodyMd && (
          <div className="mt-3">
            <div
              ref={bodyRef}
              className="overflow-hidden"
              style={expanded ? undefined : { maxHeight: clampMax }}
            >
              <MarkdownRenderer content={bodyMd} compact />
            </div>
            {!expanded && overflowing && (
              <button
                onClick={() => setExpanded(true)}
                className="mt-1 text-sm font-medium text-muted transition hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                {t('expand')}
              </button>
            )}
          </div>
        )
      )}

      {/* Media */}
      <PostMediaGallery media={post.media} />

      {/* Stats — reaction pills open the LinkedIn-style "who reacted" panel */}
      {(likeCount > 0 || commentCount > 0) && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          {likeCount > 0 ? (
            <button
              onClick={() => setReactorsOpen(true)}
              className="flex items-center gap-1.5 hover:underline"
              aria-label={t('see_reactors')}
            >
              <span className="flex items-center -space-x-1">
                {reactions.slice(0, 3).map(
                  (r) =>
                    isReactionType(r.reaction) && (
                      <span
                        key={r.reaction}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-sm leading-none"
                      >
                        {REACTION_META[r.reaction].emoji}
                      </span>
                    ),
                )}
              </span>
              {likeCount}
            </button>
          ) : (
            <span />
          )}
          {commentCount > 0 && (
            <button onClick={() => setCommentsOpen((v) => !v)} className="hover:underline">
              {t('comment_count', { count: commentCount })}
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 flex items-center gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800/60">
        <div
          className="relative flex-1"
          onMouseEnter={paletteEnter}
          onMouseLeave={paletteLeave}
        >
          {paletteOpen && (
            <div className="surface absolute bottom-full left-0 z-30 mb-2 flex items-center gap-0.5 rounded-full px-2 py-1.5 shadow-lg">
              {REACTION_ORDER.map((r) => (
                <button
                  key={r}
                  onClick={() => react(r)}
                  title={t(`reaction_${r}`)}
                  aria-label={t(`reaction_${r}`)}
                  className={`rounded-full p-1 text-2xl leading-none transition duration-150 hover:-translate-y-1 hover:scale-125 ${
                    myReaction === r ? 'bg-zinc-900/[0.06] dark:bg-white/10' : ''
                  }`}
                >
                  {REACTION_META[r].emoji}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => react(myReaction ?? 'like')}
            disabled={reactBusy}
            aria-pressed={myReaction !== null}
            className={`${actionBtn} w-full ${
              myReaction
                ? 'font-medium text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-600 dark:text-zinc-300'
            }`}
          >
            {myReaction ? (
              <span className="text-base leading-none">{REACTION_META[myReaction].emoji}</span>
            ) : (
              <ThumbsUp className="h-4 w-4" />
            )}
            {myReaction ? t(`reaction_${myReaction}`) : t('reaction_like')}
          </button>
        </div>
        <button
          onClick={() => setCommentsOpen((v) => !v)}
          className={`${actionBtn} text-zinc-600 dark:text-zinc-300`}
        >
          <MessageSquare className="h-4 w-4" />
          {t('comment_action')}
        </button>
        <button onClick={share} className={`${actionBtn} text-zinc-600 dark:text-zinc-300`}>
          <Link2 className="h-4 w-4" />
          {t('share_action')}
        </button>
      </div>

      {reactorsOpen && <ReactionsPanel postId={post.id} onClose={() => setReactorsOpen(false)} />}

      {/* Comments */}
      {commentsOpen && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
          <PostComments
            postId={post.id}
            currentUser={currentUser}
            focusId={focusId}
            onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))}
          />
        </div>
      )}
    </article>
  );
}
