'use client';

// 投票活动管理表（/manage 全站中文，不走 i18n —— 与其他 manage 页一致）。

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Star, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export interface VoteAdminRow {
  id: string;
  title: string;
  status: 'draft' | 'published';
  over: boolean;
  endAt: string | null;
  featured: boolean;
  entryCount: number;
  voteCount: number;
  voterCount: number;
  createdAt: string;
  creatorName: string;
  creatorHandle: string;
}

export function VotesManager({ items }: { items: VoteAdminRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function mutate(id: string, url: string, init: RequestInit, okMsg: string) {
    setBusyId(id);
    startTransition(async () => {
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          pushToast('error', data.reason ?? '操作失败');
          return;
        }
        pushToast('success', okMsg);
        router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <div className="surface overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-muted dark:border-zinc-800">
            <th className="px-3 py-2.5 font-medium">活动</th>
            <th className="px-3 py-2.5 font-medium">发起人</th>
            <th className="px-3 py-2.5 font-medium">状态</th>
            <th className="px-3 py-2.5 text-right font-medium">作品</th>
            <th className="px-3 py-2.5 text-right font-medium">参与</th>
            <th className="px-3 py-2.5 text-right font-medium">票数</th>
            <th className="px-3 py-2.5 font-medium">创建时间</th>
            <th className="px-3 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className="max-w-[260px] px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  {row.featured && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                  <span className="truncate font-medium">{row.title}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-muted">
                {row.creatorName}
                <span className="ml-1 text-xs">@{row.creatorHandle}</span>
              </td>
              <td className="px-3 py-2.5">
                {row.status === 'draft' ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    草稿
                  </span>
                ) : row.over ? (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    已结束
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                    进行中
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.entryCount}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.voterCount}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{row.voteCount}</td>
              <td className="px-3 py-2.5 text-xs text-muted">{row.createdAt.slice(0, 10)}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={`/votes/${row.id}`}
                    title="查看"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    disabled={pending && busyId === row.id}
                    title={row.featured ? '取消精选' : '设为精选'}
                    onClick={() =>
                      mutate(
                        row.id,
                        `/api/votes/${row.id}`,
                        {
                          method: 'PATCH',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ featured: !row.featured }),
                        },
                        row.featured ? '已取消精选' : '已设为精选',
                      )
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                  >
                    <Star className={`h-4 w-4 ${row.featured ? 'fill-amber-400 text-amber-400' : ''}`} />
                  </button>
                  <button
                    type="button"
                    disabled={pending && busyId === row.id}
                    title="删除"
                    onClick={() => {
                      if (window.confirm(`删除「${row.title}」？活动将从前台移除（软删除）。`)) {
                        mutate(row.id, `/api/votes/${row.id}`, { method: 'DELETE' }, '已删除');
                      }
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted">
                暂无投票活动
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
