'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';

interface CommentAuthor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department?: string | null;
  lab?: string | null;
  isPrivate?: boolean;
}

interface CommentNode {
  id: string;
  bodyMd: string;
  status: string;
  replyCount: number;
  createdAt: string;
  author: CommentAuthor;
  replies?: CommentNode[];
}

/**
 * 详情页评论区 — the feedback board's 2-level flat thread contract
 * (parentId = thread root, transient replyToId for notification routing).
 */
export function DocComments({
  docId,
  commentCount,
  currentUser,
  focusId,
}: {
  docId: string;
  commentCount: number;
  currentUser: { id: string; handle: string; canModerate: boolean } | null;
  focusId: string | null;
}) {
  const t = useTranslations('library_ui');
  const tvc = useTranslations('video.comments');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [threads, setThreads] = useState<CommentNode[] | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ parentId: string; targetId: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/comments`);
        const data = await res.json().catch(() => null);
        if (!cancelled) setThreads(res.ok && Array.isArray(data?.comments) ? data.comments : []);
      } catch {
        if (!cancelled) setThreads([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // ?focus= deep link (notification click): scroll + highlight once loaded.
  useEffect(() => {
    if (!focusId || !threads) return;
    const timer = window.setTimeout(() => {
      const el = listRef.current?.querySelector(`[data-comment-id="${focusId.replace(/"/g, '')}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-zinc-900/25 dark:ring-zinc-100/25', 'rounded-xl');
        window.setTimeout(() => el.classList.remove('ring-2', 'ring-zinc-900/25 dark:ring-zinc-100/25', 'rounded-xl'), 2600);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [focusId, threads]);

  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    if (!currentUser) {
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/library/docs/${docId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bodyMd: body,
          ...(replyTo ? { parentId: replyTo.parentId, replyToId: replyTo.targetId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.comment) {
        pushToast('error', data?.reason ?? t('comment_failed'));
        return;
      }
      // Refetch to render server truth (author identity, ordering).
      const fresh = await fetch(`/api/library/docs/${docId}/comments`)
        .then((r) => r.json())
        .catch(() => null);
      if (Array.isArray(fresh?.comments)) setThreads(fresh.comments);
      setText('');
      setReplyTo(null);
      router.refresh();
    } catch {
      pushToast('error', t('network_error'));
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    if (deleting) return;
    if (!window.confirm(t('delete_comment_confirm'))) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/library/docs/${docId}/comments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      const fresh = await fetch(`/api/library/docs/${docId}/comments`)
        .then((r) => r.json())
        .catch(() => null);
      if (Array.isArray(fresh?.comments)) setThreads(fresh.comments);
      router.refresh();
    } catch {
      pushToast('error', t('delete_failed'));
    } finally {
      setDeleting(null);
    }
  }

  const canDelete = (c: CommentNode) =>
    !!currentUser && (currentUser.canModerate || currentUser.handle === c.author.handle);

  const renderComment = (c: CommentNode, parentId: string | null) => {
    const deleted = c.status === 'deleted';
    return (
      <div key={c.id} data-comment-id={c.id} className="py-3">
        <div className="flex items-center gap-2">
          <Avatar name={c.author.displayName} src={c.author.avatarUrl} size="xs" handle={c.author.handle} />
          <span className="text-xs font-medium">{c.author.displayName}</span>
          <DeptTag department={c.author.department} lab={c.author.lab} />
          <span className="text-[11px] text-muted">
            {relativeTime(c.createdAt, locale)}
          </span>
          {!deleted && (
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setReplyTo({
                    parentId: parentId ?? c.id,
                    targetId: c.id,
                    name: c.author.displayName,
                  })
                }
                className="text-[11px] text-muted transition hover:text-zinc-900"
              >
                {tvc('reply')}
              </button>
              {canDelete(c) && (
                <button
                  type="button"
                  aria-label={t('delete_comment_aria')}
                  disabled={deleting === c.id}
                  onClick={() => void remove(c.id)}
                  className="text-muted transition hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </span>
          )}
        </div>
        <div className="mt-1.5 pl-8">
          {deleted ? (
            <p className="text-xs italic text-muted">{t('comment_deleted')}</p>
          ) : (
            <MarkdownRenderer content={c.bodyMd} compact />
          )}
        </div>
        {c.replies && c.replies.length > 0 && (
          <div className="ml-8 mt-1 divide-y divide-zinc-100 border-l-2 border-zinc-100 pl-4 dark:divide-zinc-800/60 dark:border-zinc-800">
            {c.replies.map((r) => renderComment(r, c.id))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
        <MessageSquare className="h-4 w-4" />
        {tvc('title')} <span className="text-sm font-normal text-muted">{commentCount}</span>
      </h2>

      <div className="surface rounded-2xl p-4">
        {replyTo && (
          <p className="mb-2 flex items-center gap-2 text-xs text-muted">
            {t('replying_to', { name: replyTo.name })}
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="text-zinc-900 dark:text-zinc-50 hover:underline"
            >
              {tc('cancel')}
            </button>
          </p>
        )}
        <RichTextEditor
          value={text}
          onChange={setText}
          variant="compact"
          maxLength={10_000}
          maxHeight={320}
          placeholder={currentUser ? t('comment_placeholder') : t('login_to_comment')}
          disabled={!currentUser}
          ariaLabel={t('comment_body_aria')}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={sending || !text.trim()}
            onClick={() => void submit()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3.5 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50"
          >
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('post_comment')}
          </button>
        </div>
      </div>

      <div ref={listRef} className="surface rounded-2xl px-4">
        {threads === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-900 dark:text-zinc-50" />
          </div>
        ) : threads.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{t('comments_empty')}</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {threads.map((c) => renderComment(c, null))}
          </div>
        )}
      </div>
    </section>
  );
}
