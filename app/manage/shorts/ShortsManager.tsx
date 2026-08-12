'use client';

// 短视频管理表格（/manage 后台保持中文，见 CLAUDE.md）。精选 = 首页「精选短视频」
// 横条的数据来源（featured 优先，不足回填热门）。

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Eye, Heart, MessageCircle, Star, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { formatCount, formatDuration } from '@/lib/video/types';

interface Row {
  id: string;
  title: string;
  summary: string;
  posterUrl: string | null;
  durationSec: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  featured: boolean;
  createdAt: string;
  uploaderName: string;
  uploaderHandle: string;
}

export function ShortsManager({ items }: { items: Row[] }) {
  const router = useRouter();
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

  function toggleFeatured(row: Row) {
    mutate(
      `/api/shorts/${row.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ featured: !row.featured }),
      },
      row.featured ? '已取消精选' : '已设为精选',
    );
  }

  function remove(row: Row) {
    if (!confirm(`确定删除短视频「${row.title}」？（软删除，可在数据库恢复）`)) return;
    mutate(`/api/shorts/${row.id}`, { method: 'DELETE' }, '已删除');
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold">短视频管理</h1>
        <p className="text-sm text-muted">共 {items.length} 条 · 精选 {items.filter((i) => i.featured).length} 条</p>
      </div>

      {items.length === 0 ? (
        <div className="surface rounded-2xl px-6 py-12 text-center text-sm text-muted">
          还没有短视频。成员可在 极客视频 → 随刷短视频 上传。
        </div>
      ) : (
        <div className="surface overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-muted dark:border-zinc-800">
                <th className="px-4 py-3 font-medium">短视频</th>
                <th className="px-3 py-3 font-medium">上传者</th>
                <th className="px-3 py-3 font-medium">数据</th>
                <th className="px-3 py-3 font-medium">发布时间</th>
                <th className="px-3 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative h-16 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-900">
                        {row.posterUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={withBasePath(row.posterUrl)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                        {row.durationSec > 0 && (
                          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] tabular-nums text-white">
                            {formatDuration(row.durationSec)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 max-w-[280px] font-medium leading-snug">
                          {row.summary || row.title}
                        </p>
                        {row.featured && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                            <Star className="h-3 w-3 fill-current" />
                            精选
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <p className="whitespace-nowrap">{row.uploaderName}</p>
                    <p className="text-xs text-muted">@{row.uploaderHandle}</p>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3 whitespace-nowrap text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" />
                        {formatCount(row.viewCount)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" />
                        {formatCount(row.likeCount)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" />
                        {formatCount(row.commentCount)}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-muted">
                    {new Date(row.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <a
                        href={withBasePath(`/videos/shorts?v=${row.id}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        title="打开"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => toggleFeatured(row)}
                        className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition disabled:opacity-40 ${
                          row.featured
                            ? 'text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'
                            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                        }`}
                        title={row.featured ? '取消精选' : '设为精选'}
                      >
                        <Star className={`h-4 w-4 ${row.featured ? 'fill-current' : ''}`} />
                        {row.featured ? '取消精选' : '精选'}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => remove(row)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-40"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
