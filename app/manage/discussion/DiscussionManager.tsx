'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Lock, LockOpen, Pin, PinOff, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { CATEGORY_META } from '@/app/discussion/_components/badges';

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
  category: keyof typeof CATEGORY_META;
  pinned: boolean;
  locked: boolean;
  upvoteCount: number;
  replyCount: number;
  createdAtText: string;
  author: { handle: string; displayName: string };
}

export function DiscussionManager({ posts, topics }: { posts: PostRow[]; topics: TopicRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<'posts' | 'topics'>('posts');
  const [pending, startTransition] = useTransition();

  function mutate(url: string, init: RequestInit, okMsg: string) {
    startTransition(async () => {
      const res = await fetch(url, init);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        pushToast('error', data.reason ?? '操作失败');
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
            { key: 'posts', label: `动态（${posts.length}）` },
            { key: 'topics', label: `讨论帖（${topics.length}）` },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              tab === t.key
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'posts' ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">内容</th>
                <th className="px-3 py-2.5 font-medium">作者</th>
                <th className="px-3 py-2.5 font-medium">数据</th>
                <th className="px-3 py-2.5 font-medium">发布时间</th>
                <th className="px-3 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {posts.map((p) => (
                <tr key={p.id}>
                  <td className="max-w-[360px] px-4 py-2.5">
                    <span className="line-clamp-2">
                      {p.pinned && <Pin className="mr-1 inline h-3 w-3 text-accent-500" />}
                      {p.excerpt}
                    </span>
                    {p.mediaCount > 0 && (
                      <span className="text-xs text-muted">{p.mediaCount} 个附件</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{p.author.displayName}</td>
                  <td className="px-3 py-2.5 text-muted">
                    赞 {p.likeCount} · 评 {p.commentCount}
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
                        title="查看"
                        className={iconBtn}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() =>
                          patch(
                            `/api/discussion/posts/${p.id}`,
                            { pinned: !p.pinned },
                            p.pinned ? '已取消置顶' : '已置顶',
                          )
                        }
                        disabled={pending}
                        title={p.pinned ? '取消置顶' : '置顶'}
                        className={iconBtn}
                      >
                        {p.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm('确定删除这条动态？')) return;
                          mutate(`/api/discussion/posts/${p.id}`, { method: 'DELETE' }, '已删除');
                        }}
                        disabled={pending}
                        title="删除"
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
                    暂无动态
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
                <th className="px-4 py-2.5 font-medium">标题</th>
                <th className="px-3 py-2.5 font-medium">分类</th>
                <th className="px-3 py-2.5 font-medium">作者</th>
                <th className="px-3 py-2.5 font-medium">数据</th>
                <th className="px-3 py-2.5 font-medium">发布时间</th>
                <th className="px-3 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {topics.map((t) => (
                <tr key={t.id}>
                  <td className="max-w-[300px] px-4 py-2.5">
                    <span className="line-clamp-1">
                      {t.pinned && <Pin className="mr-1 inline h-3 w-3 text-accent-500" />}
                      {t.locked && <Lock className="mr-1 inline h-3 w-3 text-zinc-400" />}
                      {t.title}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{CATEGORY_META[t.category].label}</td>
                  <td className="px-3 py-2.5 text-muted">{t.author.displayName}</td>
                  <td className="px-3 py-2.5 text-muted">
                    +1 {t.upvoteCount} · 回复 {t.replyCount}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {t.createdAtText}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={withBasePath(`/discussion/topics/${t.id}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="查看"
                        className={iconBtn}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() =>
                          patch(
                            `/api/discussion/topics/${t.id}`,
                            { pinned: !t.pinned },
                            t.pinned ? '已取消置顶' : '已置顶',
                          )
                        }
                        disabled={pending}
                        title={t.pinned ? '取消置顶' : '置顶'}
                        className={iconBtn}
                      >
                        {t.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() =>
                          patch(
                            `/api/discussion/topics/${t.id}`,
                            { locked: !t.locked },
                            t.locked ? '已解锁' : '已锁定',
                          )
                        }
                        disabled={pending}
                        title={t.locked ? '解锁' : '锁定'}
                        className={iconBtn}
                      >
                        {t.locked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(`确定删除「${t.title}」？`)) return;
                          mutate(`/api/discussion/topics/${t.id}`, { method: 'DELETE' }, '已删除');
                        }}
                        disabled={pending}
                        title="删除"
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
                    暂无讨论帖
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
