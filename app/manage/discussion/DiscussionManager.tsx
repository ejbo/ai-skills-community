'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ExternalLink, Lock, LockOpen, Pin, PinOff, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { CATEGORY_META, categoryLabelKey } from '@/app/discussion/_components/badges';

interface PostRow {
  id: string;
  excerpt: string;
  pinned: boolean;
  likeCount: number;
  commentCount: number;
  mediaCount: number;
  createdAtText: string;
  author: { handle: string; displayName: string };
}

interface TopicRow {
  id: string;
  title: string;
  categories: (keyof typeof CATEGORY_META)[];
  pinned: boolean;
  locked: boolean;
  upvoteCount: number;
  replyCount: number;
  createdAtText: string;
  author: { handle: string; displayName: string };
}

export function DiscussionManager({ posts, topics }: { posts: PostRow[]; topics: TopicRow[] }) {
  const t = useTranslations('discussion');
  const tc = useTranslations('common');
  const tl = useTranslations('labels');
  const router = useRouter();
  const [tab, setTab] = useState<'posts' | 'topics'>('posts');
  const [pending, startTransition] = useTransition();

  function mutate(url: string, init: RequestInit, okMsg: string) {
    startTransition(async () => {
      const res = await fetch(url, init);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        pushToast('error', data.reason ?? t('op_failed'));
        return;
      }
      pushToast('success', okMsg);
      router.refresh();
    });
  }

  function patch(url: string, data: object, okMsg: string) {
    mutate(
      url,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) },
      okMsg,
    );
  }

  const iconBtn =
    'rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            { key: 'posts', label: t('mng_tab_posts', { count: posts.length }) },
            { key: 'topics', label: t('mng_tab_topics', { count: topics.length }) },
          ] as const
        ).map((tabDef) => (
          <button
            key={tabDef.key}
            onClick={() => setTab(tabDef.key)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              tab === tabDef.key
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {tabDef.label}
          </button>
        ))}
      </div>

      {tab === 'posts' ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('mng_col_content')}</th>
                <th className="px-3 py-2.5 font-medium">{t('mng_col_author')}</th>
                <th className="px-3 py-2.5 font-medium">{t('mng_col_stats')}</th>
                <th className="px-3 py-2.5 font-medium">{t('mng_col_created')}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t('mng_col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {posts.map((p) => (
                <tr key={p.id}>
                  <td className="max-w-[360px] px-4 py-2.5">
                    <span className="line-clamp-2">
                      {p.pinned && <Pin className="mr-1 inline h-3 w-3 text-zinc-900 dark:text-zinc-50" />}
                      {p.excerpt}
                    </span>
                    {p.mediaCount > 0 && (
                      <span className="text-xs text-muted">
                        {t('mng_attachment_count', { count: p.mediaCount })}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{p.author.displayName}</td>
                  <td className="px-3 py-2.5 text-muted">
                    {t('mng_post_stats', { likes: p.likeCount, comments: p.commentCount })}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {p.createdAtText}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={withBasePath(`/discussion/posts/${p.id}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('mng_view')}
                        className={iconBtn}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() =>
                          patch(
                            `/api/discussion/posts/${p.id}`,
                            { pinned: !p.pinned },
                            p.pinned ? t('unpinned_toast') : t('pinned_toast'),
                          )
                        }
                        disabled={pending}
                        title={p.pinned ? t('unpin') : t('pin')}
                        className={iconBtn}
                      >
                        {p.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(t('mng_confirm_delete_post'))) return;
                          mutate(
                            `/api/discussion/posts/${p.id}`,
                            { method: 'DELETE' },
                            t('deleted_toast'),
                          );
                        }}
                        disabled={pending}
                        title={tc('delete')}
                        className={`${iconBtn} hover:!text-danger`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {posts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    {t('mng_empty_posts')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('mng_col_title')}</th>
                <th className="px-3 py-2.5 font-medium">{t('mng_col_category')}</th>
                <th className="px-3 py-2.5 font-medium">{t('mng_col_author')}</th>
                <th className="px-3 py-2.5 font-medium">{t('mng_col_stats')}</th>
                <th className="px-3 py-2.5 font-medium">{t('mng_col_created')}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t('mng_col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {topics.map((row) => (
                <tr key={row.id}>
                  <td className="max-w-[300px] px-4 py-2.5">
                    <span className="line-clamp-1">
                      {row.pinned && <Pin className="mr-1 inline h-3 w-3 text-zinc-900 dark:text-zinc-50" />}
                      {row.locked && <Lock className="mr-1 inline h-3 w-3 text-zinc-400" />}
                      {row.title}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {row.categories.map((c) => tl(categoryLabelKey(c))).join(' / ')}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{row.author.displayName}</td>
                  <td className="px-3 py-2.5 text-muted">
                    {t('mng_topic_stats', { upvotes: row.upvoteCount, replies: row.replyCount })}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {row.createdAtText}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={withBasePath(`/discussion/topics/${row.id}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('mng_view')}
                        className={iconBtn}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() =>
                          patch(
                            `/api/discussion/topics/${row.id}`,
                            { pinned: !row.pinned },
                            row.pinned ? t('unpinned_toast') : t('pinned_toast'),
                          )
                        }
                        disabled={pending}
                        title={row.pinned ? t('unpin') : t('pin')}
                        className={iconBtn}
                      >
                        {row.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() =>
                          patch(
                            `/api/discussion/topics/${row.id}`,
                            { locked: !row.locked },
                            row.locked ? t('unlocked_toast') : t('locked_toast'),
                          )
                        }
                        disabled={pending}
                        title={row.locked ? t('unlock') : t('lock')}
                        className={iconBtn}
                      >
                        {row.locked ? (
                          <LockOpen className="h-4 w-4" />
                        ) : (
                          <Lock className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(t('mng_confirm_delete_topic', { title: row.title }))) return;
                          mutate(
                            `/api/discussion/topics/${row.id}`,
                            { method: 'DELETE' },
                            t('deleted_toast'),
                          );
                        }}
                        disabled={pending}
                        title={tc('delete')}
                        className={`${iconBtn} hover:!text-danger`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {topics.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    {t('mng_empty_topics')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
