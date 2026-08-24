'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { relativeTime } from '@/lib/i18n-date';
import { CornerDownRight, Loader2, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';

export interface CommentView {
  id: string;
  bodyMd: string;
  status: 'visible' | 'deleted';
  replyCount: number;
  createdAt: string | Date;
  author: {
    handle: string;
    displayName: string;
    avatarUrl?: string | null;
    // Already trimmed server-side via toPublicAuthor() — null for private accounts.
    department?: string | null;
    lab?: string | null;
    isPrivate?: boolean;
  };
}

export interface ThreadView extends CommentView {
  replies: CommentView[];
}

interface CurrentUser {
  handle: string;
  canModerate: boolean;
}

/**
 * The whole comment area: composer + 2-level threads. All comments arrive from
 * the server page in one go (feedback volume is low — no pagination), so state
 * here is just the local mutations on top.
 */
export function FeedbackComments({
  feedbackId,
  initialThreads,
  currentUser,
  focusId,
}: {
  feedbackId: string;
  initialThreads: ThreadView[];
  currentUser: CurrentUser | null;
  focusId?: string;
}) {
  const t = useTranslations('feedback');
  const [threads, setThreads] = useState<ThreadView[]>(initialThreads);

  function addThread(c: CommentView) {
    setThreads((t) => [...t, { ...c, replies: [] }]);
  }

  function addReply(rootId: string, c: CommentView) {
    setThreads((t) =>
      t.map((th) => (th.id === rootId ? { ...th, replies: [...th.replies, c] } : th)),
    );
  }

  function removeComment(
    rootId: string,
    commentId: string,
    tombstoned: boolean,
    prunedParent: boolean,
  ) {
    setThreads((t) => {
      if (rootId === commentId) {
        // Top-level: tombstone keeps the thread, hard delete drops it.
        if (tombstoned) {
          return t.map((th) =>
            th.id === commentId ? { ...th, status: 'deleted' as const, bodyMd: '' } : th,
          );
        }
        return t.filter((th) => th.id !== commentId);
      }
      // The server prunes a tombstoned root that just lost its last reply.
      if (prunedParent) return t.filter((th) => th.id !== rootId);
      return t.map((th) =>
        th.id === rootId
          ? { ...th, replies: th.replies.filter((r) => r.id !== commentId) }
          : th,
      );
    });
  }

  const count = threads.reduce(
    (n, th) => n + (th.status === 'deleted' ? 0 : 1) + th.replies.length,
    0,
  );

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">{t('comments_title', { count })}</h2>

      {currentUser ? (
        <CommentBox
          feedbackId={feedbackId}
          onPosted={addThread}
          placeholder={t('comment_placeholder')}
        />
      ) : (
        <p className="text-sm text-muted">
          {t.rich('login_to_discuss', {
            link: (chunks) => (
              <Link
                href={`/auth/login?callbackUrl=${encodeURIComponent(`/feedback/${feedbackId}`)}`}
                className="text-accent-600 underline dark:text-accent-300"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {threads.length === 0 && <p className="text-sm text-muted">{t('comments_empty')}</p>}

      <ul className="space-y-4">
        {threads.map((thread) => (
          <ThreadBlock
            key={thread.id}
            feedbackId={feedbackId}
            thread={thread}
            currentUser={currentUser}
            focusId={focusId}
            onReplyPosted={(c) => addReply(thread.id, c)}
            onRemoved={(commentId, tombstoned, prunedParent) =>
              removeComment(thread.id, commentId, tombstoned, prunedParent)
            }
          />
        ))}
      </ul>
    </div>
  );
}

function ThreadBlock({
  feedbackId,
  thread,
  currentUser,
  focusId,
  onReplyPosted,
  onRemoved,
}: {
  feedbackId: string;
  thread: ThreadView;
  currentUser: CurrentUser | null;
  focusId?: string;
  onReplyPosted: (c: CommentView) => void;
  onRemoved: (commentId: string, tombstoned: boolean, prunedParent: boolean) => void;
}) {
  const t = useTranslations('feedback');
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);

  return (
    <li className="space-y-3">
      <CommentBlock
        feedbackId={feedbackId}
        comment={thread}
        isRoot
        currentUser={currentUser}
        focusId={focusId}
        onReply={() => setReplyTo(thread)}
        onRemoved={onRemoved}
      />
      {(thread.replies.length > 0 || replyTo) && (
        <div className="ml-10 space-y-3 border-l border-zinc-100 pl-4 dark:border-zinc-800/60">
          {thread.replies.map((r) => (
            <CommentBlock
              key={r.id}
              feedbackId={feedbackId}
              comment={r}
              isRoot={false}
              currentUser={currentUser}
              focusId={focusId}
              onReply={() => setReplyTo(r)}
              onRemoved={onRemoved}
            />
          ))}
          {replyTo && currentUser && (
            <CommentBox
              feedbackId={feedbackId}
              parentId={thread.id}
              replyToId={replyTo.id}
              autoFocus
              placeholder={t('reply_to_placeholder', { name: replyTo.author.displayName })}
              onPosted={(c) => {
                onReplyPosted(c);
                setReplyTo(null);
              }}
              onCancel={() => setReplyTo(null)}
            />
          )}
        </div>
      )}
    </li>
  );
}

function CommentBlock({
  feedbackId,
  comment,
  isRoot,
  currentUser,
  focusId,
  onReply,
  onRemoved,
}: {
  feedbackId: string;
  comment: CommentView;
  isRoot: boolean;
  currentUser: CurrentUser | null;
  focusId?: string;
  onReply: () => void;
  onRemoved: (commentId: string, tombstoned: boolean, prunedParent: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('feedback');
  const g = useTranslations();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isTombstone = comment.status === 'deleted';
  const isOwn = currentUser?.handle === comment.author.handle;
  const canDelete = !isTombstone && (isOwn || Boolean(currentUser?.canModerate));

  // Notification deep link: /feedback/<id>?focus=<commentId> — scroll + flash.
  useEffect(() => {
    if (focusId !== comment.id || !ref.current) return;
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(timer);
  }, [focusId, comment.id]);

  async function remove() {
    if (!confirm(t('delete_comment_confirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/feedback/${feedbackId}/comments/${comment.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', t('delete_failed'));
        return;
      }
      onRemoved(comment.id, Boolean(data.tombstoned), Boolean(data.prunedParent));
    } catch {
      pushToast('error', t('delete_failed_retry'));
    } finally {
      setBusy(false);
    }
  }

  const created =
    typeof comment.createdAt === 'string' ? new Date(comment.createdAt) : comment.createdAt;

  return (
    <div
      ref={ref}
      id={`fc-${comment.id}`}
      className={`rounded-xl transition-shadow ${flash ? 'ring-2 ring-accent-500/60' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <Avatar
          name={comment.author.displayName}
          src={comment.author.avatarUrl}
          size={isRoot ? 'sm' : 'xs'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {comment.author.displayName}
            </span>
            <DeptTag department={comment.author.department} lab={comment.author.lab} />
            <span>{relativeTime(created, locale)}</span>
          </div>
          {isTombstone ? (
            <p className="mt-1 text-sm italic text-muted">{t('comment_deleted')}</p>
          ) : (
            <div className="mt-1 text-sm">
              <MarkdownRenderer content={comment.bodyMd} compact />
            </div>
          )}
          {!isTombstone && (
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
              {currentUser ? (
                <button
                  onClick={onReply}
                  className="flex items-center gap-1 transition hover:text-accent-600"
                >
                  <CornerDownRight className="h-3 w-3" />
                  {g('video.comments.reply')}
                </button>
              ) : (
                <button
                  onClick={() =>
                    router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`)
                  }
                  className="flex items-center gap-1 transition hover:text-accent-600"
                >
                  <CornerDownRight className="h-3 w-3" />
                  {g('video.comments.reply')}
                </button>
              )}
              {canDelete && (
                <button
                  onClick={remove}
                  disabled={busy}
                  className="flex items-center gap-1 transition hover:text-danger disabled:opacity-60"
                >
                  <Trash2 className="h-3 w-3" />
                  {g('common.delete')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentBox({
  feedbackId,
  parentId,
  replyToId,
  placeholder,
  autoFocus,
  onPosted,
  onCancel,
}: {
  feedbackId: string;
  parentId?: string;
  replyToId?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted: (c: CommentView) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('feedback');
  const g = useTranslations();
  const [bodyMd, setBodyMd] = useState('');
  const [busy, setBusy] = useState(false);
  const tooLong = bodyMd.trim().length > 2000;

  async function submit() {
    const trimmed = bodyMd.trim();
    if (!trimmed || tooLong) return;
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/feedback/${feedbackId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bodyMd: trimmed,
          ...(parentId ? { parentId } : {}),
          ...(replyToId ? { replyToId } : {}),
        }),
      });
      if (res.status === 401) {
        pushToast('error', g('video.login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('send_failed_retry'));
        return;
      }
      setBodyMd('');
      onPosted(data.comment as CommentView);
    } catch {
      pushToast('error', t('send_failed_retry'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <RichTextEditor
        value={bodyMd}
        onChange={setBodyMd}
        variant="compact"
        maxLength={2000}
        placeholder={placeholder ?? t('comment_placeholder')}
        ariaLabel={g('video.comments.title')}
        autoFocus={autoFocus}
      />
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="h-8 rounded-lg border border-zinc-200 px-3 text-xs dark:border-zinc-700"
          >
            {g('common.cancel')}
          </button>
        )}
        <button
          onClick={submit}
          disabled={busy || !bodyMd.trim() || tooLong}
          title={tooLong ? t('comment_too_long') : undefined}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {g('video.ai.send')}
        </button>
      </div>
    </div>
  );
}
