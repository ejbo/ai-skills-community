'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Loader2, ThumbsUp } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { RichTextEditor } from '@/components/RichTextEditor';
import { pushToast } from '@/components/Toaster';
import { relativeTime } from '@/lib/i18n-date';
import type { CurrentUser, PostCommentView, PostThreadView } from './types';

type Sort = 'relevant' | 'recent';

const FIRST_PAGE = 3;
const PAGE_SIZE = 10;

/**
 * LinkedIn-style comment section under a post: sorted by 最相关 (engagement)
 * or 最新, first 3 threads shown, then batches of 10; each thread previews a
 * couple of replies and expands on demand. Supports the notification
 * deep-link (?focus=<commentId>) with scroll + flash + auto-expand.
 */
export function PostComments({
  postId,
  currentUser,
  focusId,
  onCountChange,
}: {
  postId: string;
  currentUser: CurrentUser | null;
  focusId?: string;
  onCountChange: (delta: number) => void;
}) {
  const t = useTranslations('discussion_ui');
  const [threads, setThreads] = useState<PostThreadView[]>([]);
  const [totalRoots, setTotalRoots] = useState(0);
  // Server-order offset actually consumed. Kept SEPARATE from threads.length:
  // locally-prepended rows (own new comment, the ?focus= injected root) do not
  // occupy server offsets, so paging with threads.length would skip comments.
  const [fetched, setFetched] = useState(0);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [sort, setSort] = useState<Sort>('relevant');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focus, setFocus] = useState<{ focusId: string | null; openRootId: string | null }>({
    focusId: null,
    openRootId: null,
  });

  const load = useCallback(
    async (s: Sort) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/discussion/posts/${postId}/comments?sort=${s}&skip=0&take=${FIRST_PAGE}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setThreads(data.items ?? []);
        setTotalRoots(data.totalRoots ?? 0);
        setFetched((data.items ?? []).length);
        setServerHasMore(Boolean(data.hasMore));
      } catch {
        /* transient */
      } finally {
        setLoading(false);
      }
    },
    [postId],
  );

  // Initial load (+ deep-link resolution from a notification click).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load(sort);
      if (!focusId || cancelled) return;
      try {
        const res = await fetch(`/api/discussion/comments/${focusId}/context`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.exists || data.postId !== postId) return;
        if (data.root) {
          setThreads((prev) =>
            prev.some((t) => t.id === data.rootId) ? prev : [data.root as PostThreadView, ...prev],
          );
        }
        if (data.isReply) {
          // The target reply may be beyond the preview — load the full thread.
          const rr = await fetch(`/api/discussion/comments/${data.rootId}/replies`);
          if (rr.ok) {
            const full = await rr.json();
            if (!cancelled && Array.isArray(full.replies)) {
              setThreads((prev) =>
                prev.map((t) => (t.id === data.rootId ? { ...t, replies: full.replies } : t)),
              );
            }
          }
        }
        if (!cancelled) setFocus({ focusId, openRootId: data.isReply ? data.rootId : null });
      } catch {
        /* deep-link is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, focusId]);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/discussion/posts/${postId}/comments?sort=${sort}&skip=${fetched}&take=${PAGE_SIZE}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const raw = (data.items ?? []) as PostThreadView[];
      setThreads((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...raw.filter((t) => !seen.has(t.id))];
      });
      setFetched((f) => f + raw.length);
      setTotalRoots(data.totalRoots ?? totalRoots);
      setServerHasMore(Boolean(data.hasMore));
    } catch {
      /* transient */
    } finally {
      setLoadingMore(false);
    }
  }

  function switchSort(s: Sort) {
    if (s === sort) return;
    setSort(s);
    void load(s);
  }

  function addThread(c: PostCommentView) {
    setThreads((t) => [{ ...c, replies: [] }, ...t]);
    setTotalRoots((n) => n + 1);
    onCountChange(1);
  }

  function addReply(rootId: string, c: PostCommentView) {
    setThreads((t) =>
      t.map((th) =>
        th.id === rootId
          ? { ...th, replies: [...th.replies, c], replyCount: th.replyCount + 1 }
          : th,
      ),
    );
    onCountChange(1);
  }

  function removeComment(rootId: string, commentId: string, tombstoned: boolean, prunedParent: boolean) {
    // Decided from the arguments alone so the setThreads updater stays PURE
    // (StrictMode/concurrent rendering may invoke updaters more than once).
    const dropsRoot = (rootId === commentId && !tombstoned) || (rootId !== commentId && prunedParent);
    if (dropsRoot) {
      setTotalRoots((n) => Math.max(0, n - 1));
      // The dropped root no longer occupies a server offset.
      setFetched((f) => Math.max(0, f - 1));
    }
    setThreads((t) => {
      if (rootId === commentId) {
        if (tombstoned) {
          return t.map((th) =>
            th.id === commentId ? { ...th, status: 'deleted' as const, bodyMd: '' } : th,
          );
        }
        return t.filter((th) => th.id !== commentId);
      }
      if (prunedParent) return t.filter((th) => th.id !== rootId);
      return t.map((th) =>
        th.id === rootId
          ? {
              ...th,
              replies: th.replies.filter((r) => r.id !== commentId),
              replyCount: Math.max(0, th.replyCount - 1),
            }
          : th,
      );
    });
    onCountChange(-1);
  }

  const remaining = Math.max(0, totalRoots - fetched);

  return (
    <div className="space-y-4 pt-1">
      {currentUser ? (
        <CommentBox postId={postId} currentUser={currentUser} onPosted={addThread} />
      ) : (
        <p className="text-sm text-muted">
          {t.rich('login_to_comment', {
            link: (chunks) => (
              <Link
                href="/auth/login"
                className="text-accent-600 hover:underline dark:text-accent-300"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {totalRoots > 1 && (
        <div className="flex items-center gap-3 text-xs">
          {(
            [
              { key: 'relevant', label: t('sort_relevant') },
              { key: 'recent', label: t('sort_recent') },
            ] as const
          ).map((s) => (
            <button
              key={s.key}
              onClick={() => switchSort(s.key)}
              className={
                sort === s.key
                  ? 'font-medium text-zinc-900 dark:text-white'
                  : 'text-muted transition hover:text-zinc-700 dark:hover:text-zinc-200'
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('comments_loading')}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {threads.map((thread) => (
              <ThreadBlock
                key={thread.id}
                postId={postId}
                thread={thread}
                currentUser={currentUser}
                focus={focus}
                onReplyPosted={(c) => addReply(thread.id, c)}
                onReplies={(replies) =>
                  setThreads((t) =>
                    t.map((th) => (th.id === thread.id ? { ...th, replies } : th)),
                  )
                }
                onRemoved={(commentId, tombstoned, prunedParent) =>
                  removeComment(thread.id, commentId, tombstoned, prunedParent)
                }
              />
            ))}
          </div>
          {serverHasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:underline disabled:opacity-60 dark:text-accent-300"
            >
              {loadingMore ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {remaining > 0
                ? t('load_more_comments_remaining', { count: remaining })
                : t('load_more_comments')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ThreadBlock({
  postId,
  thread,
  currentUser,
  focus,
  onReplyPosted,
  onReplies,
  onRemoved,
}: {
  postId: string;
  thread: PostThreadView;
  currentUser: CurrentUser | null;
  focus: { focusId: string | null; openRootId: string | null };
  onReplyPosted: (c: PostCommentView) => void;
  onReplies: (replies: PostCommentView[]) => void;
  onRemoved: (commentId: string, tombstoned: boolean, prunedParent: boolean) => void;
}) {
  const t = useTranslations('discussion_ui');
  const [replyTo, setReplyTo] = useState<PostCommentView | null>(null);
  const [expanding, setExpanding] = useState(false);
  // After a full fetch the button must not reappear even if replyCount exceeds
  // the server's 200-reply render cap (clicking again could never load more).
  const [expandedFully, setExpandedFully] = useState(false);
  const hiddenReplies = expandedFully
    ? 0
    : Math.max(0, thread.replyCount - thread.replies.length);

  async function expandReplies() {
    if (expanding) return;
    setExpanding(true);
    try {
      const res = await fetch(`/api/discussion/comments/${thread.id}/replies`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.replies)) {
        onReplies(data.replies);
        setExpandedFully(true);
      }
    } catch {
      /* transient */
    } finally {
      setExpanding(false);
    }
  }

  return (
    <div>
      <CommentBlock
        postId={postId}
        comment={thread}
        isRoot
        currentUser={currentUser}
        focus={focus}
        onReply={() => setReplyTo(thread)}
        onRemoved={onRemoved}
      />
      {(thread.replies.length > 0 || replyTo) && (
        <div className="ml-10 mt-2 space-y-2 border-l border-zinc-100 pl-4 dark:border-zinc-800/60">
          {thread.replies.map((r) => (
            <CommentBlock
              key={r.id}
              postId={postId}
              comment={r}
              isRoot={false}
              currentUser={currentUser}
              focus={focus}
              onReply={() => setReplyTo(r)}
              onRemoved={onRemoved}
            />
          ))}
          {hiddenReplies > 0 && (
            <button
              onClick={expandReplies}
              disabled={expanding}
              className="flex items-center gap-1.5 text-xs font-medium text-accent-600 hover:underline disabled:opacity-60 dark:text-accent-300"
            >
              {expanding ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {t('expand_more_replies', { count: hiddenReplies })}
            </button>
          )}
          {replyTo && currentUser && (
            <CommentBox
              postId={postId}
              currentUser={currentUser}
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

function CommentBlock({
  postId,
  comment,
  isRoot,
  currentUser,
  focus,
  onReply,
  onRemoved,
}: {
  postId: string;
  comment: PostCommentView;
  isRoot: boolean;
  currentUser: CurrentUser | null;
  focus: { focusId: string | null; openRootId: string | null };
  onReply: () => void;
  onRemoved: (commentId: string, tombstoned: boolean, prunedParent: boolean) => void;
}) {
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [liked, setLiked] = useState(comment.likedByMe);
  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [likeBusy, setLikeBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isTombstone = comment.status === 'deleted';
  const isOwn = currentUser?.handle === comment.author.handle;
  const canDelete = !isTombstone && (isOwn || Boolean(currentUser?.canModerate));

  // Notification deep link: ?focus=<commentId> — scroll + flash.
  useEffect(() => {
    if (focus.focusId !== comment.id || !ref.current) return;
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(timer);
  }, [focus.focusId, comment.id]);

  async function toggleLike() {
    if (likeBusy || isTombstone) return;
    setLikeBusy(true);
    const prev = { liked, likeCount };
    setLiked(!liked);
    setLikeCount(likeCount + (liked ? -1 : 1));
    try {
      const res = await fetch(`/api/discussion/comments/${comment.id}/like`, { method: 'POST' });
      if (res.status === 401) {
        setLiked(prev.liked);
        setLikeCount(prev.likeCount);
        pushToast('error', t('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('failed');
      setLiked(Boolean(data.liked));
      setLikeCount(typeof data.likeCount === 'number' ? data.likeCount : prev.likeCount);
    } catch {
      setLiked(prev.liked);
      setLikeCount(prev.likeCount);
      pushToast('error', t('action_failed_retry'));
    } finally {
      setLikeBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('delete_comment_confirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/comments/${comment.id}`, { method: 'DELETE' });
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

  return (
    <div
      ref={ref}
      id={`pc-${comment.id}`}
      className={`rounded-xl transition-shadow ${flash ? 'ring-2 ring-accent-500/60' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <Link href={`/users/${comment.author.handle}`} className="mt-0.5 shrink-0">
          <Avatar
            name={comment.author.displayName}
            src={comment.author.avatarUrl}
            size="xs"
            tone="subtle"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={`/users/${comment.author.handle}`}
              className="font-medium text-zinc-900 hover:underline dark:text-white"
            >
              {comment.author.displayName}
            </Link>
            <DeptTag department={comment.author.department} lab={comment.author.lab} />
            <span className="text-muted">{relativeTime(comment.createdAt, locale)}</span>
          </div>
          {isTombstone ? (
            <p className="mt-1 text-sm italic text-muted">{t('comment_deleted')}</p>
          ) : (
            <div className="mt-1">
              <MarkdownRenderer content={comment.bodyMd} compact />
            </div>
          )}
          {!isTombstone && (
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
              <button
                onClick={toggleLike}
                disabled={likeBusy}
                aria-pressed={liked}
                className={`flex items-center gap-1 transition ${
                  liked
                    ? 'font-medium text-accent-600 dark:text-accent-300'
                    : 'hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                <ThumbsUp className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} />
                {likeCount > 0 ? likeCount : t('like')}
              </button>
              {currentUser && (
                <button onClick={onReply} className="transition hover:text-zinc-700 dark:hover:text-zinc-200">
                  {t('reply')}
                </button>
              )}
              {isRoot && comment.replyCount > 0 && (
                <span>{t('reply_count', { count: comment.replyCount })}</span>
              )}
              {canDelete && (
                <button
                  onClick={remove}
                  disabled={busy}
                  className="transition hover:text-danger"
                >
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

function CommentBox({
  postId,
  currentUser,
  parentId,
  replyToId,
  placeholder,
  autoFocus,
  onPosted,
  onCancel,
}: {
  postId: string;
  currentUser: CurrentUser;
  parentId?: string;
  replyToId?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted: (c: PostCommentView) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('discussion_ui');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [bodyMd, setBodyMd] = useState('');
  const [busy, setBusy] = useState(false);
  const tooLong = bodyMd.trim().length > 2000;

  async function submit() {
    const trimmed = bodyMd.trim();
    if (!trimmed || tooLong || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/discussion/posts/${postId}/comments`, {
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
      onPosted(data.comment as PostCommentView);
    } catch {
      pushToast('error', t('send_failed_retry'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-2.5">
      <Avatar
        name={currentUser.displayName}
        src={currentUser.avatarUrl}
        size="xs"
        tone="subtle"
        className="mt-1"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <RichTextEditor
          value={bodyMd}
          onChange={setBodyMd}
          variant="compact"
          maxLength={2000}
          placeholder={placeholder ?? t('comment_placeholder')}
          ariaLabel={t('comment_aria')}
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
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {t('send')}
          </button>
        </div>
      </div>
    </div>
  );
}
