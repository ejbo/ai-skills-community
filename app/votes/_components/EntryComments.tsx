'use client';

// 作品评论 — the lightbox side panel's flat comment list (deliberately no
// threading: this is an in-activity mini feed, not a forum). Plain text only;
// the creator can turn the whole thing off via allowComments.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';
import { CommentLikeButton } from '@/components/CommentLikeButton';
import { VOTE_COMMENT_MAX } from '@/lib/votes/shared';
import type { PublicAuthor } from '@/lib/user-identity';

interface EntryComment {
  id: string;
  body: string;
  createdAt: string;
  author: PublicAuthor;
  isMine: boolean;
  canDelete: boolean;
  likeCount: number;
  likedByMe: boolean;
}

export function EntryComments({
  activityId,
  entryId,
  allowComments,
  onCountChange,
}: {
  activityId: string;
  entryId: string;
  allowComments: boolean;
  /** Keeps the gallery's denormalized commentCount in sync (+1 / -1). */
  onCountChange: (entryId: string, delta: number) => void;
}) {
  const t = useTranslations('votes');
  const locale = useLocale();
  const [comments, setComments] = useState<EntryComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/votes/${activityId}/entries/${entryId}/comments`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.comments) setComments(data.comments as EntryComment[]);
      else setComments([]);
    } catch {
      setComments([]);
    }
  }, [activityId, entryId]);

  useEffect(() => {
    setComments(null);
    void load();
  }, [load]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/votes/${activityId}/entries/${entryId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast(
          'error',
          data?.error === 'comments_disabled' ? t('comments_disabled') : t('comment_failed'),
        );
        return;
      }
      setComments((prev) => [...(prev ?? []), data.comment as EntryComment]);
      setDraft('');
      onCountChange(entryId, 1);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    } catch {
      pushToast('error', t('comment_failed'));
    } finally {
      setSending(false);
    }
  }

  async function remove(comment: EntryComment) {
    if (!window.confirm(t('comment_delete_confirm'))) return;
    try {
      const res = await fetch(`/api/votes/${activityId}/comments/${comment.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        pushToast('error', t('comment_failed'));
        return;
      }
      setComments((prev) => (prev ?? []).filter((c) => c.id !== comment.id));
      onCountChange(entryId, -1);
    } catch {
      pushToast('error', t('comment_failed'));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {comments === null ? (
          <div className="flex justify-center py-6 text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/50">
            {allowComments ? t('comments_empty') : t('comments_disabled')}
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="group flex items-start gap-2.5">
              <Avatar name={c.author.displayName} src={c.author.avatarUrl} size="xs" handle={c.author.handle} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] text-white/60">
                  <span className="truncate font-medium text-white/85">{c.author.displayName}</span>
                  <DeptTag department={c.author.department} lab={c.author.lab} />
                  <span className="shrink-0">{relativeTime(new Date(c.createdAt), locale)}</span>
                  {c.canDelete && (
                    <button
                      type="button"
                      title={t('comment_delete')}
                      onClick={() => void remove(c)}
                      className="ml-auto hidden shrink-0 text-white/40 transition hover:text-red-400 group-hover:block"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-white/90">{c.body}</p>
                <div className="mt-1 text-[11px]">
                  <CommentLikeButton
                    endpoint={`/api/votes/${encodeURIComponent(activityId)}/comments/${encodeURIComponent(c.id)}/like`}
                    initialLiked={c.likedByMe}
                    initialCount={c.likeCount}
                    signedIn
                    size="xs"
                    tone="onDark"
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {allowComments && (
        <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5">
          <input
            value={draft}
            maxLength={VOTE_COMMENT_MAX}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t('comment_placeholder')}
            className="h-9 min-w-0 flex-1 rounded-full border border-white/15 bg-white/10 px-3.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/40"
          />
          <button
            type="button"
            aria-label={t('comment_send')}
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900 transition hover:bg-white/85 disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
