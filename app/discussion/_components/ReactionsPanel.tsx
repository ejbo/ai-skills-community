'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import type { AuthorView } from './types';
import { REACTION_META, type ReactionCountView, type ReactionType, isReactionType } from './reactions';

interface ReactorRow {
  reaction: string;
  createdAt: string;
  author: AuthorView;
}

const PAGE = 30;

/**
 * LinkedIn-style "Reactions" dialog: tab bar with per-type counts, then the
 * list of people (avatar badged with their reaction, name, 部门), paginated.
 */
export function ReactionsPanel({ postId, onClose }: { postId: string; onClose: () => void }) {
  const t = useTranslations('discussion');
  const tc = useTranslations('common');
  const [tab, setTab] = useState<'all' | ReactionType>('all');
  const [counts, setCounts] = useState<ReactionCountView[]>([]);
  const [users, setUsers] = useState<ReactorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Returns an error CODE (not copy) so the memo stays independent of the
  // translator's identity — the render maps the code to a message key.
  const load = useCallback(
    async (which: 'all' | ReactionType, skip: number) => {
      try {
        const qs = new URLSearchParams();
        if (which !== 'all') qs.set('reaction', which);
        if (skip > 0) qs.set('skip', String(skip));
        qs.set('take', String(PAGE));
        const res = await fetch(`/api/discussion/posts/${postId}/reactions?${qs.toString()}`);
        if (!res.ok) {
          return { error: res.status === 401 ? 'login_to_view' : 'load_failed_retry' };
        }
        const data = (await res.json()) as {
          total: number;
          counts: ReactionCountView[];
          users: ReactorRow[];
          hasMore: boolean;
        };
        return { data };
      } catch {
        return { error: 'load_failed_retry' };
      }
    },
    [postId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const r = await load(tab, 0);
      if (cancelled) return;
      if (!r.data) {
        setError(r.error ?? 'load_failed_retry');
        setLoading(false);
        return;
      }
      setCounts(r.data.counts);
      setUsers(r.data.users);
      setTotal(r.data.total);
      setHasMore(r.data.hasMore);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const r = await load(tab, users.length);
    if (r.data) {
      const { data } = r;
      // One reaction per user per post ⇒ handle is a stable identity to dedupe
      // on when reactions shifted the offsets between pages.
      setUsers((prev) => {
        const seen = new Set(prev.map((u) => u.author.handle));
        return [...prev, ...data.users.filter((u) => !seen.has(u.author.handle))];
      });
      setCounts(data.counts);
      setTotal(data.total);
      setHasMore(data.hasMore);
    }
    setLoadingMore(false);
  }

  const grandTotal = counts.reduce((n, c) => n + c.count, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('reactions_dialog_aria')}
    >
      <div
        className="surface flex max-h-[70vh] w-full max-w-md flex-col rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800/60">
          <h3 className="text-sm font-semibold">{t('reactions_title')}</h3>
          <button
            onClick={onClose}
            aria-label={tc('dismiss')}
            className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-100 px-3 dark:border-zinc-800/60">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            {t('tab_all_count', { count: grandTotal })}
          </TabButton>
          {counts.map((c) =>
            isReactionType(c.reaction) ? (
              <TabButton
                key={c.reaction}
                active={tab === c.reaction}
                onClick={() => setTab(c.reaction as ReactionType)}
              >
                {REACTION_META[c.reaction].emoji} {c.count}
              </TabButton>
            ) : null,
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tc('loading')}
            </div>
          ) : error ? (
            <p className="px-2 py-6 text-center text-sm text-muted">{t(error)}</p>
          ) : users.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">{t('no_reactions_yet')}</p>
          ) : (
            <ul>
              {users.map((u) => (
                <li key={u.author.handle}>
                  <Link
                    href={`/users/${u.author.handle}`}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  >
                    <span className="relative shrink-0">
                      <Avatar
                        name={u.author.displayName}
                        src={u.author.avatarUrl}
                        size="sm"
                      />
                      {isReactionType(u.reaction) && (
                        <span className="absolute -bottom-1 -right-1 text-sm leading-none">
                          {REACTION_META[u.reaction].emoji}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {u.author.displayName}
                        </span>
                        <DeptTag department={u.author.department} lab={u.author.lab} />
                      </span>
                      {!u.author.isPrivate && (
                        <span className="block truncate text-xs text-muted">@{u.author.handle}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hasMore && !loading && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-2 my-1 flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-50 hover:underline disabled:opacity-60"
            >
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('load_more_reactors', { count: total })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition ${
        active ? 'text-zinc-900 dark:text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
      }`}
    >
      {children}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-zinc-900 dark:bg-zinc-100" />
      )}
    </button>
  );
}
