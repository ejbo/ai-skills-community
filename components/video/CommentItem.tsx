'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Heart, Loader2, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { withBasePath } from '@/lib/base-path';
import { RichTextEditor } from '@/components/RichTextEditor';
import { formatCount } from '@/lib/video/types';
import type { VideoCommentView } from '@/lib/video/queries';
import { CommentComposer } from './CommentComposer';
import { useCommentFocus } from './CommentFocusContext';

interface Props {
  slug: string;
  comment: VideoCommentView;
  currentUser: { id: string; isAdmin: boolean; handle?: string } | null;
  onChanged: () => void;
  // For a reply, lets the composed reply-to-reply be appended to the TOP-level
  // thread's flat reply list (DB threading is 2 levels deep).
  onAddSibling?: (c: VideoCommentView) => void;
}

export function CommentItem({ slug, comment, currentUser, onChanged, onAddSibling }: Props) {
  const t = useTranslations('video');
  const router = useRouter();

  const [liked, setLiked] = useState(comment.likedByMe);
  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [bodyMd, setBodyMd] = useState(comment.bodyMd);
  const [editedAt, setEditedAt] = useState<Date | null>(comment.editedAt);

  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(comment.bodyMd);
  const [savingEdit, setSavingEdit] = useState(false);

  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<VideoCommentView[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyCount, setReplyCount] = useState(comment.replyCount);

  const [removed, setRemoved] = useState(false);

  const isTombstone = comment.status === 'deleted' || removed;

  // The comment view carries the author's handle (not id). We surface the
  // author-only "edit" affordance when the viewer's handle matches; the server
  // re-authorizes every mutation by id regardless, so this is purely a UI hint.
  const isOwn = Boolean(currentUser?.handle && currentUser.handle === comment.author.handle);
  const canDelete = isOwn || Boolean(currentUser?.isAdmin);

  // Deep-link focus (from a notification): scroll to + highlight this comment, or
  // — if this is the thread root of a nested target — open replies so it mounts.
  const rootRef = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(false);
  const { focusId, openRootId } = useCommentFocus();
  useEffect(() => {
    if (!focusId) return;
    if (focusId === comment.id) {
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlighted(true);
      const tm = setTimeout(() => setHighlighted(false), 2500);
      return () => clearTimeout(tm);
    }
    if (!comment.parentId && openRootId === comment.id && !showReplies && !loadingReplies) {
      void toggleReplies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, openRootId]);

  function pushReply(c: VideoCommentView) {
    setReplies((prev) => (prev ? [...prev, c] : [c]));
    setReplyCount((n) => n + 1);
    setShowReplies(true);
    setReplying(false);
  }

  async function toggleLike() {
    if (isTombstone) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((n) => (next ? n + 1 : Math.max(0, n - 1)));
    try {
      const res = await fetch(`/api/videos/${slug}/comments/${comment.id}/like`, { method: 'POST' });
      if (!res.ok) throw res;
      const data = await res.json();
      setLiked(Boolean(data.liked));
      if (typeof data.likeCount === 'number') setLikeCount(data.likeCount);
    } catch (err) {
      setLiked(!next);
      setLikeCount((n) => (next ? Math.max(0, n - 1) : n + 1));
      if (err instanceof Response && err.status === 401) {
        pushToast('info', t('login_required'));
        router.push('/auth/login');
      } else {
        pushToast('error', '操作失败，请稍后再试');
      }
    }
  }

  async function toggleReplies() {
    if (showReplies) {
      setShowReplies(false);
      return;
    }
    if (replies) {
      setShowReplies(true);
      return;
    }
    setLoadingReplies(true);
    try {
      const res = await fetch(`/api/videos/${slug}/comments?parentId=${comment.id}`);
      if (!res.ok) throw res;
      const data = await res.json();
      setReplies((data.comments ?? []) as VideoCommentView[]);
      setShowReplies(true);
    } catch {
      pushToast('error', '加载回复失败');
    } finally {
      setLoadingReplies(false);
    }
  }

  async function saveEdit() {
    const trimmed = editDraft.trim();
    if (!trimmed || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/videos/${slug}/comments/${comment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMd: trimmed }),
      });
      if (!res.ok) throw res;
      setBodyMd(trimmed);
      setEditedAt(new Date());
      setEditing(false);
    } catch {
      pushToast('error', '保存失败，请稍后再试');
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('comments.delete') + '?')) return;
    try {
      const res = await fetch(`/api/videos/${slug}/comments/${comment.id}`, { method: 'DELETE' });
      if (!res.ok) throw res;
      // If it had replies the server soft-deletes (tombstone); otherwise it's
      // hard-deleted and should leave the list.
      if (replyCount > 0) {
        setRemoved(true);
        setBodyMd('');
      } else {
        onChanged();
      }
    } catch {
      pushToast('error', '删除失败，请稍后再试');
    }
  }

  const author = comment.author;

  return (
    <div
      ref={rootRef}
      id={`comment-${comment.id}`}
      className={`flex scroll-mt-24 gap-3 rounded-xl transition-colors ${
        highlighted ? 'bg-accent-500/10 ring-2 ring-accent-500/40' : ''
      }`}
    >
      {author.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={withBasePath(author.avatarUrl)} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100">
          {author.displayName.charAt(0)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">{author.displayName}</span>
          <span className="text-xs text-muted">@{author.handle}</span>
          <span className="text-xs text-muted">·</span>
          <span className="text-xs text-muted">
            {formatDistanceToNowStrict(comment.createdAt, { addSuffix: true })}
          </span>
          {editedAt && !isTombstone && (
            <span className="text-xs text-muted">· {t('comments.edited')}</span>
          )}
        </div>

        {isTombstone ? (
          <p className="mt-1 text-sm italic text-muted">{t('comments.deleted')}</p>
        ) : editing ? (
          <div className="mt-2 space-y-2">
            <RichTextEditor
              value={editDraft}
              onChange={setEditDraft}
              variant="compact"
              maxLength={2000}
              autoFocus
              ariaLabel={t('comments.edit')}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={saveEdit}
                disabled={savingEdit || !editDraft.trim() || editDraft.length > 2000}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {savingEdit && <Loader2 className="h-3 w-3 animate-spin" />}
                {t('comments.save')}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditDraft(bodyMd);
                }}
                className="h-8 rounded-lg border border-zinc-300 px-3 text-xs font-medium transition hover:border-zinc-400 dark:border-zinc-700"
              >
                {t('comments.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1 break-words text-zinc-800 dark:text-zinc-100">
            <MarkdownRenderer content={bodyMd} compact />
          </div>
        )}

        {!isTombstone && !editing && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleLike}
              className={`flex items-center gap-1 transition hover:text-zinc-700 dark:hover:text-zinc-200 ${
                liked ? 'text-danger' : ''
              }`}
            >
              <Heart className="h-3.5 w-3.5" fill={liked ? 'currentColor' : 'none'} />
              {likeCount > 0 && <span className="font-mono tabular-nums">{formatCount(likeCount)}</span>}
            </motion.button>

            <button
              onClick={() => setReplying((v) => !v)}
              className="flex items-center gap-1 transition hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {t('comments.reply')}
            </button>

            {isOwn && (
              <button
                onClick={() => {
                  setEditDraft(bodyMd);
                  setEditing(true);
                }}
                className="flex items-center gap-1 transition hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('comments.edit')}
              </button>
            )}

            {canDelete && (
              <button onClick={remove} className="flex items-center gap-1 transition hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
                {t('comments.delete')}
              </button>
            )}
          </div>
        )}

        {replying && (
          <div className="mt-3">
            <CommentComposer
              slug={slug}
              parentId={comment.parentId ?? comment.id}
              replyToId={comment.id}
              onPosted={(c) => {
                // A reply to a reply belongs to the top-level thread's flat list,
                // so bubble it up; a reply to the top comment stays here.
                if (comment.parentId) {
                  onAddSibling?.(c);
                  setReplying(false);
                } else {
                  pushReply(c);
                }
              }}
              autoFocus
            />
          </div>
        )}

        {!comment.parentId && replyCount > 0 && (
          <button
            onClick={toggleReplies}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-zinc-700 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            {loadingReplies ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : showReplies ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showReplies ? t('comments.hide_replies') : t('comments.view_replies', { count: replyCount })}
          </button>
        )}

        {showReplies && replies && replies.length > 0 && (
          <div className="mt-3 space-y-4 border-l border-zinc-100 pl-4 dark:border-zinc-800">
            {replies.map((reply) => (
              <CommentItem
                key={reply.id}
                slug={slug}
                comment={reply}
                currentUser={currentUser}
                onChanged={() => {
                  setReplies((prev) => (prev ? prev.filter((r) => r.id !== reply.id) : prev));
                  setReplyCount((n) => Math.max(0, n - 1));
                }}
                onAddSibling={(c) => {
                  setReplies((prev) => (prev ? [...prev, c] : [c]));
                  setReplyCount((n) => n + 1);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
