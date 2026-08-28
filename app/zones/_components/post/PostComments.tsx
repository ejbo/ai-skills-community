'use client';

// Comment section under a zone post — the discussion board's contract with
// zone endpoints: 最相关 / 最新 sort, first 3 threads then batches of 10
// (`fetched` = server offset consumed, kept apart from threads.length because
// locally prepended rows occupy no server offset), per-thread reply preview +
// 展开, the ?focus=<commentId> deep link resolved through /context (+ full
// reply list when the target is a reply), LiveList insert/delete animation,
// tombstone-aware removal math.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown, Loader2, Lock } from 'lucide-react';
import { LiveList } from '@/components/motion';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCommentView, ZoneCurrentUser, ZoneThreadView } from '@/lib/zones/types';
import { CommentBlock, type CommentFocus } from './CommentBlock';
import { CommentBox } from './CommentBox';
import { LoginLink } from '@/components/LoginLink';

type Sort = 'relevant' | 'recent';

const FIRST_PAGE = 3;
const PAGE_SIZE = 10;

function repliesOf(json: unknown): ZoneCommentView[] | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { replies?: unknown; items?: unknown };
  if (Array.isArray(o.replies)) return o.replies as ZoneCommentView[];
  if (Array.isArray(o.items)) return o.items as ZoneCommentView[];
  return null;
}

export function PostComments({
  zoneSlug,
  postId,
  currentUser,
  canComment,
  canModerate,
  isMember,
  locked,
  focusId,
  onCountChange,
}: {
  zoneSlug: string;
  postId: string;
  currentUser: ZoneCurrentUser | null;
  /** access.canComment — the zone's own policy for this viewer. */
  canComment: boolean;
  canModerate: boolean;
  isMember: boolean;
  locked: boolean;
  focusId?: string;
  onCountChange: (delta: number) => void;
}) {
  const t = useTranslations('zones');
  const [threads, setThreads] = useState<ZoneThreadView[]>([]);
  const [totalRoots, setTotalRoots] = useState(0);
  const [fetched, setFetched] = useState(0);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [sort, setSort] = useState<Sort>('relevant');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focus, setFocus] = useState<CommentFocus>({ focusId: null, openRootId: null });

  const listUrl = `/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(postId)}/comments`;

  const load = useCallback(
    async (s: Sort) => {
      setLoading(true);
      try {
        const res = await fetch(`${listUrl}?sort=${s}&skip=0&take=${FIRST_PAGE}`);
        if (!res.ok) return;
        const data = (await res.json()) as { items?: ZoneThreadView[]; totalRoots?: number; hasMore?: boolean };
        const items = data.items ?? [];
        setThreads(items);
        setTotalRoots(data.totalRoots ?? 0);
        setFetched(items.length);
        setServerHasMore(Boolean(data.hasMore));
      } catch {
        /* transient */
      } finally {
        setLoading(false);
      }
    },
    [listUrl],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load(sort);
      if (!focusId || cancelled) return;
      try {
        const res = await fetch(`/api/zones/comments/${encodeURIComponent(focusId)}/context`);
        if (!res.ok) return;
        const data = (await res.json()) as { exists?: boolean; postId?: string; rootId?: string; isReply?: boolean; root?: ZoneThreadView };
        if (cancelled || !data.exists || data.postId !== postId || !data.rootId) return;
        const rootId = data.rootId;
        if (data.root) {
          const root = data.root;
          setThreads((prev) => (prev.some((th) => th.id === rootId) ? prev : [{ ...root, replies: root.replies ?? [] }, ...prev]));
        }
        if (data.isReply) {
          const rr = await fetch(`/api/zones/comments/${encodeURIComponent(rootId)}/replies`);
          if (rr.ok) {
            const full = repliesOf(await rr.json().catch(() => null));
            if (!cancelled && full) setThreads((prev) => prev.map((th) => (th.id === rootId ? { ...th, replies: full } : th)));
          }
        }
        if (!cancelled) setFocus({ focusId, openRootId: data.isReply ? rootId : null });
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
      const res = await fetch(`${listUrl}?sort=${sort}&skip=${fetched}&take=${PAGE_SIZE}`);
      if (!res.ok) return;
      const data = (await res.json()) as { items?: ZoneThreadView[]; totalRoots?: number; hasMore?: boolean };
      const raw = data.items ?? [];
      setThreads((prev) => {
        const seen = new Set(prev.map((th) => th.id));
        return [...prev, ...raw.filter((th) => !seen.has(th.id))];
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

  function addThread(c: ZoneCommentView) {
    if (!c || !c.id) return;
    setThreads((prev) => [{ ...c, replies: [] }, ...prev]);
    setTotalRoots((n) => n + 1);
    onCountChange(1);
  }

  function addReply(rootId: string, c: ZoneCommentView) {
    if (!c || !c.id) return;
    setThreads((prev) => prev.map((th) => (th.id === rootId ? { ...th, replies: [...th.replies, c], replyCount: th.replyCount + 1 } : th)));
    onCountChange(1);
  }

  function editComment(rootId: string, c: ZoneCommentView) {
    setThreads((prev) =>
      prev.map((th) => {
        if (th.id === c.id) return { ...th, ...c, replies: th.replies };
        if (th.id !== rootId) return th;
        return { ...th, replies: th.replies.map((r) => (r.id === c.id ? { ...r, ...c } : r)) };
      }),
    );
  }

  function removeComment(rootId: string, commentId: string, tombstoned: boolean, prunedParent: boolean) {
    // Decided from the arguments alone so the setThreads updater stays PURE.
    const dropsRoot = (rootId === commentId && !tombstoned) || (rootId !== commentId && prunedParent);
    if (dropsRoot) {
      setTotalRoots((n) => Math.max(0, n - 1));
      setFetched((f) => Math.max(0, f - 1));
    }
    setThreads((prev) => {
      if (rootId === commentId) {
        if (tombstoned) return prev.map((th) => (th.id === commentId ? { ...th, status: 'deleted' as const, bodyMd: '' } : th));
        return prev.filter((th) => th.id !== commentId);
      }
      if (prunedParent) return prev.filter((th) => th.id !== rootId);
      return prev.map((th) =>
        th.id === rootId ? { ...th, replies: th.replies.filter((r) => r.id !== commentId), replyCount: Math.max(0, th.replyCount - 1) } : th,
      );
    });
    onCountChange(-1);
  }

  const remaining = Math.max(0, totalRoots - fetched);
  const composerAllowed = !!currentUser && canComment && (!locked || canModerate);

  return (
    <div className="space-y-4 pt-1">
      {composerAllowed && currentUser ? (
        <CommentBox zoneSlug={zoneSlug} postId={postId} currentUser={currentUser} onPosted={addThread} />
      ) : locked && !canModerate ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <Lock className="h-4 w-4" />
          {t('comment_locked')}
        </p>
      ) : !currentUser ? (
        <p className="text-sm text-muted">
          {t.rich('comment_login_to_comment', {
            link: (chunks) => (
              <LoginLink className="font-medium text-zinc-900 underline dark:text-zinc-100">
                {chunks}
              </LoginLink>
            ),
          })}
        </p>
      ) : (
        <p className="text-sm text-muted">
          {isMember ? (
            t('comment_no_permission')
          ) : (
            <>
              {t('comment_join_to_comment')}{' '}
              <Link href={zoneHref(zoneSlug)} className="font-medium text-zinc-900 underline dark:text-zinc-100">
                {t('comment_go_to_zone')}
              </Link>
            </>
          )}
        </p>
      )}

      {totalRoots > 1 && (
        <div className="flex items-center gap-3 text-xs">
          {(
            [
              { key: 'relevant', label: t('comment_sort_relevant') },
              { key: 'recent', label: t('comment_sort_recent') },
            ] as const
          ).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => switchSort(s.key)}
              className={sort === s.key ? 'font-medium text-zinc-900 dark:text-white' : 'text-muted transition hover:text-zinc-700 dark:hover:text-zinc-200'}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted" aria-busy>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('comment_loading')}
        </div>
      ) : (
        <>
          {threads.length === 0 && <p className="py-2 text-sm text-muted">{t('comment_empty')}</p>}
          <LiveList
            items={threads}
            keyOf={(th) => th.id}
            className="space-y-4"
            render={(thread) => (
              <ThreadBlock
                zoneSlug={zoneSlug}
                postId={postId}
                thread={thread}
                currentUser={currentUser}
                canModerate={canModerate}
                canReply={composerAllowed}
                focus={focus}
                onReplyPosted={(c) => addReply(thread.id, c)}
                onReplies={(replies) => setThreads((prev) => prev.map((th) => (th.id === thread.id ? { ...th, replies } : th)))}
                onRemoved={(commentId, tombstoned, prunedParent) => removeComment(thread.id, commentId, tombstoned, prunedParent)}
                onEdited={(c) => editComment(thread.id, c)}
              />
            )}
          />
          {serverHasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 hover:underline disabled:opacity-60 dark:text-zinc-300"
            >
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {remaining > 0 ? t('comment_load_more_remaining', { count: remaining }) : t('comment_load_more')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ThreadBlock({
  zoneSlug,
  postId,
  thread,
  currentUser,
  canModerate,
  canReply,
  focus,
  onReplyPosted,
  onReplies,
  onRemoved,
  onEdited,
}: {
  zoneSlug: string;
  postId: string;
  thread: ZoneThreadView;
  currentUser: ZoneCurrentUser | null;
  canModerate: boolean;
  canReply: boolean;
  focus: CommentFocus;
  onReplyPosted: (c: ZoneCommentView) => void;
  onReplies: (replies: ZoneCommentView[]) => void;
  onRemoved: (commentId: string, tombstoned: boolean, prunedParent: boolean) => void;
  onEdited: (c: ZoneCommentView) => void;
}) {
  const t = useTranslations('zones');
  const [replyTo, setReplyTo] = useState<ZoneCommentView | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [expandedFully, setExpandedFully] = useState(false);
  const hiddenReplies = expandedFully ? 0 : Math.max(0, thread.replyCount - thread.replies.length);

  async function expandReplies() {
    if (expanding) return;
    setExpanding(true);
    try {
      const res = await fetch(`/api/zones/comments/${encodeURIComponent(thread.id)}/replies`);
      if (!res.ok) return;
      const replies = repliesOf(await res.json().catch(() => null));
      if (replies) {
        onReplies(replies);
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
        zoneSlug={zoneSlug}
        postId={postId}
        comment={thread}
        isRoot
        currentUser={currentUser}
        canModerate={canModerate}
        canReply={canReply}
        focus={focus}
        onReply={() => setReplyTo(thread)}
        onRemoved={onRemoved}
        onEdited={onEdited}
      />
      {(thread.replies.length > 0 || replyTo) && (
        <div className="ml-10 mt-2 space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          <LiveList
            items={thread.replies}
            keyOf={(r) => r.id}
            className="space-y-2"
            render={(r) => (
              <CommentBlock
                zoneSlug={zoneSlug}
                postId={postId}
                comment={r}
                isRoot={false}
                currentUser={currentUser}
                canModerate={canModerate}
                canReply={canReply}
                focus={focus}
                onReply={() => setReplyTo(r)}
                onRemoved={onRemoved}
                onEdited={onEdited}
              />
            )}
          />
          {hiddenReplies > 0 && (
            <button
              type="button"
              onClick={expandReplies}
              disabled={expanding}
              className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 hover:underline disabled:opacity-60 dark:text-zinc-300"
            >
              {expanding ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
              {t('comment_expand_replies', { count: hiddenReplies })}
            </button>
          )}
          {replyTo && currentUser && canReply && (
            <CommentBox
              zoneSlug={zoneSlug}
              postId={postId}
              currentUser={currentUser}
              parentId={thread.id}
              replyToId={replyTo.id}
              autoFocus
              placeholder={t('comment_reply_to_placeholder', { name: replyTo.author.displayName })}
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
