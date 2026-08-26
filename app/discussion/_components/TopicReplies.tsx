'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';

// 2-level flat threads — same contract and UI structure as the feedback
// board's FeedbackComments (parentId = thread root, transient replyToId).

export interface ReplyView {
  id: string;
  bodyMd: string;
  status: 'visible' | 'deleted';
  replyCount: number;
  createdAt: string | Date;
  author: {
    handle: string;
    displayName: string;
    avatarUrl?: string | null;
    department?: string | null;
    lab?: string | null;
    isPrivate?: boolean;
  };
}

export interface ReplyThreadView extends ReplyView {
  replies: ReplyView[];
}

interface CurrentUser {
  handle: string;
  canModerate: boolean;
}

export function TopicReplies({
  topicId,
  initialThreads,
  currentUser,
  locked,
  focusId,
}: {
  topicId: string;
  initialThreads: ReplyThreadView[];
  currentUser: CurrentUser | null;
  locked: boolean;
  focusId?: string;
}) {
  const t = useTranslations('discussion_ui');
  const [threads, setThreads] = useState<ReplyThreadView[]>(initialThreads);

  function addThread(c: ReplyView) {
    setThreads((t) => [...t, { ...c, replies: [] }]);
  }

  function addReply(rootId: string, c: ReplyView) {
    setThreads((t) =>
      t.map((th) => (th.id === rootId ? { ...th, replies: [...th.replies, c] } : th)),
    );
  }

  function removeReply(rootId: string, replyId: string, tombstoned: boolean, prunedParent: boolean) {
    setThreads((t) => {
      if (rootId === replyId) {
        // Top-level: tombstone keeps the thread, hard delete drops it.
        if (tombstoned) {
          return t.map((th) =>
            th.id === replyId ? { ...th, status: 'deleted' as const, bodyMd: '' } : th,
          );
        }
        return t.filter((th) => th.id !== replyId);
      }
      // The server prunes a tombstoned root that just lost its last reply.
      if (prunedParent) return t.filter((th) => th.id !== rootId);
      return t.map((th) =>
        th.id === rootId ? { ...th, replies: th.replies.filter((r) => r.id !== replyId) } : th,
      );
    });
  }

  const count = threads.reduce(
    (n, th) => n + (th.status === 'deleted' ? 0 : 1) + th.replies.length,
    0,
  );

  return (
    <div className="space-y-5">
      <h2 className="text-sm font-semibold">{t('reply_count', { count })}</h2>

      <div className="space-y-5">
        {threads.map((thread) => (
          <ThreadBlock
            key={thread.id}
            topicId={topicId}
            thread={thread}
            currentUser={currentUser}
            locked={locked}
            focusId={focusId}
            onReplyPosted={(c) => addReply(thread.id, c)}
            onRemoved={(replyId, tombstoned, prunedParent) =>
              removeReply(thread.id, replyId, tombstoned, prunedParent)
            }
          />
        ))}
      </div>

      {locked ? (
        <p className="flex items-center gap-2 rounded-xl bg-zinc-50 px-4 py-3 text-sm text-muted dark:bg-zinc-900">
          <Lock className="h-4 w-4" />
          {t('locked_notice')}
        </p>
      ) : currentUser ? (
        <ReplyBox topicId={topicId} onPosted={addThread} placeholder={t('reply_placeholder')} />
      ) : (
        <p className="text-sm text-muted">
          {t.rich('login_to_join_discussion', {
            link: (chunks) => (
              <Link
                href="/auth/login"
                className="text-zinc-900 dark:text-zinc-50 hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
    </div>
  );
}

function ThreadBlock({
  topicId,
  thread,
  currentUser,
  locked,
  focusId,
  onReplyPosted,
  onRemoved,
}: {
  topicId: string;
  thread: ReplyThreadView;
  currentUser: CurrentUser | null;
  locked: boolean;
  focusId?: string;
  onReplyPosted: (c: ReplyView) => void;
  onRemoved: (replyId: string, tombstoned: boolean, prunedParent: boolean) => void;
}) {
  const t = useTranslations('discussion_ui');
  const [replyTo, setReplyTo] = useState<ReplyView | null>(null);
  const canReply = Boolean(currentUser) && !locked;

  return (
    <div>
      <ReplyBlock
        topicId={topicId}
        reply={thread}
        isRoot
        currentUser={currentUser}
        focusId={focusId}
        canReply={canReply}
        onReply={() => setReplyTo(thread)}
        onRemoved={onRemoved}
      />
      {(thread.replies.length > 0 || replyTo) && (
        <div className="ml-10 mt-3 space-y-3 border-l border-zinc-100 pl-4 dark:border-zinc-800/60">
          {thread.replies.map((r) => (
            <ReplyBlock
              key={r.id}
              topicId={topicId}
              reply={r}
              isRoot={false}
              currentUser={currentUser}
              focusId={focusId}
              canReply={canReply}
              onReply={() => setReplyTo(r)}
              onRemoved={onRemoved}
            />
          ))}
          {replyTo && canReply && (
            <ReplyBox
              topicId={topicId}
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
    </div>
  );
}

function ReplyBlock({
  topicId,
  reply,
  isRoot,
  currentUser,
  focusId,
  canReply,
  onReply,
  onRemoved,
}: {
  topicId: string;
  reply: ReplyView;
  isRoot: boolean;
  currentUser: CurrentUser | null;
  focusId?: string;
  canReply: boolean;
  onReply: () => void;
  onRemoved: (replyId: string, tombstoned: boolean, prunedParent: boolean) => void;
}) {
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isTombstone = reply.status === 'deleted';
  const isOwn = currentUser?.handle === reply.author.handle;
  const canDelete = !isTombstone && (isOwn || Boolean(currentUser?.canModerate));

  // Notification deep link: /discussion/topics/<id>?focus=<replyId> — scroll + flash.
  useEffect(() => {
    if (focusId !== reply.id || !ref.current) return;
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(timer);
  }, [focusId, reply.id]);

  async function remove() {
    if (!confirm(t('delete_reply_confirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/topics/${topicId}/replies/${reply.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', t('delete_failed'));
        return;
      }
      onRemoved(reply.id, Boolean(data.tombstoned), Boolean(data.prunedParent));
    } catch {
      pushToast('error', t('delete_failed_retry'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={ref}
      id={`tr-${reply.id}`}
      className={`rounded-xl transition-shadow ${flash ? 'ring-2 ring-zinc-900/25 dark:ring-zinc-100/25' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <Link href={`/users/${reply.author.handle}`} className="mt-0.5 shrink-0">
          <Avatar
            name={reply.author.displayName}
            src={reply.author.avatarUrl}
            size={isRoot ? 'sm' : 'xs'}
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={`/users/${reply.author.handle}`}
              className="font-medium text-zinc-900 hover:underline dark:text-white"
            >
              {reply.author.displayName}
            </Link>
            <DeptTag department={reply.author.department} lab={reply.author.lab} />
            <span className="text-muted">{relativeTime(reply.createdAt, locale)}</span>
          </div>
          {isTombstone ? (
            <p className="mt-1 text-sm italic text-muted">{t('reply_deleted')}</p>
          ) : (
            <div className="mt-1">
              <MarkdownRenderer content={reply.bodyMd} compact />
            </div>
          )}
          {!isTombstone && (
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
              {canReply && (
                <button onClick={onReply} className="transition hover:text-zinc-700 dark:hover:text-zinc-200">
                  {t('reply')}
                </button>
              )}
              {canDelete && (
                <button onClick={remove} disabled={busy} className="transition hover:text-danger">
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

function ReplyBox({
  topicId,
  parentId,
  replyToId,
  placeholder,
  autoFocus,
  onPosted,
  onCancel,
}: {
  topicId: string;
  parentId?: string;
  replyToId?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted: (c: ReplyView) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [bodyMd, setBodyMd] = useState('');
  const [busy, setBusy] = useState(false);
  const tooLong = bodyMd.trim().length > 5000;

  async function submit() {
    const trimmed = bodyMd.trim();
    if (!trimmed || tooLong || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/topics/${topicId}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bodyMd: trimmed,
          ...(parentId ? { parentId } : {}),
          ...(replyToId ? { replyToId } : {}),
        }),
      });
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('send_failed_retry'));
        return;
      }
      setBodyMd('');
      onPosted(data.reply as ReplyView);
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
        maxLength={5000}
        placeholder={placeholder}
        ariaLabel={t('reply')}
        autoFocus={autoFocus}
      />
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="h-8 rounded-lg px-3 text-xs font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {tc('cancel')}
          </button>
        )}
        <button
          onClick={submit}
          disabled={busy || !bodyMd.trim() || tooLong}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-xs font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {t('send')}
        </button>
      </div>
    </div>
  );
}
