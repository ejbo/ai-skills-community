'use client';

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, RefreshCw, RotateCcw, Sparkles, Star, Trash2 } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { pushToast } from '@/components/Toaster';
import { DOC_TYPES, DOC_TYPE_LABELS } from '@/lib/library/types';

interface DocRow {
  id: string;
  slug: string;
  title: string;
  docType: string;
  format: string;
  status: string;
  processingError: string | null;
  aiIndexState: string;
  aiError: string | null;
  featured: boolean;
  shelfCount: number;
  viewCount: number;
  uploader: { handle: string; displayName: string };
  deletedAt: string | null;
  createdAt: string;
}

const STATUS_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: '待处理', bg: '#f4f4f5', color: '#52525b' },
  processing: { label: '处理中', bg: '#dbeafe', color: '#1e40af' },
  ready: { label: '就绪', bg: '#dcfce7', color: '#166534' },
  failed: { label: '失败', bg: '#fee2e2', color: '#991b1b' },
};

const AI_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  none: { label: 'AI 未生成', bg: '#f4f4f5', color: '#52525b' },
  running: { label: 'AI 生成中', bg: '#dbeafe', color: '#1e40af' },
  ready: { label: 'AI 就绪', bg: '#dcfce7', color: '#166534' },
  failed: { label: 'AI 失败', bg: '#fee2e2', color: '#991b1b' },
};

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: '操作过于频繁，请稍后再试',
  already_running: 'AI 正在生成中，请稍候',
  not_ready: '文档尚未就绪，无法重建 AI 导读',
  not_found: '文档不存在',
  forbidden: '没有权限',
};

export function LibraryManager({ docs }: { docs: DocRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const savingRef = useRef(false); // useTransition's flag doesn't span the await

  function mutate(input: { url: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown; success: string }) {
    if (savingRef.current) return;
    savingRef.current = true;
    startTransition(async () => {
      try {
        const res = await fetch(input.url, {
          method: input.method,
          ...(input.body !== undefined
            ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.body) }
            : {}),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          pushToast('error', data.reason ?? ERROR_MESSAGES[data.error as string] ?? '操作失败');
          return;
        }
        pushToast('success', input.success);
        router.refresh();
      } catch {
        pushToast('error', '操作失败，请重试');
      } finally {
        savingRef.current = false;
      }
    });
  }

  const total = docs.length;
  const inFlight = docs.filter((d) => d.status === 'pending' || d.status === 'processing').length;
  const failed = docs.filter((d) => d.status === 'failed').length;
  const featured = docs.filter((d) => d.featured).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800 dark:text-zinc-300">总数 {total}</span>
        <span className="rounded-full px-2 py-0.5" style={{ background: '#dbeafe', color: '#1e40af' }}>
          处理中 {inFlight}
        </span>
        <span className="rounded-full px-2 py-0.5" style={{ background: '#fee2e2', color: '#991b1b' }}>
          失败 {failed}
        </span>
        <span className="rounded-full px-2 py-0.5" style={{ background: '#fef3c7', color: '#92400e' }}>
          已推荐 {featured}
        </span>
      </div>

      <div className="surface overflow-hidden rounded-xl">
        <table className="data">
          <thead>
            <tr>
              <th>标题</th>
              <th>类型</th>
              <th>格式</th>
              <th>状态</th>
              <th>上传者</th>
              <th>收藏/浏览</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-xs text-muted">
                  还没有文档 —— 用户在前台「知识库」提交网页 / PDF / EPUB 后会出现在这里
                </td>
              </tr>
            )}
            {docs.map((d) => {
              const status = STATUS_BADGES[d.status] ?? STATUS_BADGES.pending;
              const ai = AI_BADGES[d.aiIndexState] ?? AI_BADGES.none;
              const deleted = Boolean(d.deletedAt);
              return (
                <tr key={d.id} className={deleted ? 'opacity-60' : undefined}>
                  <td className="max-w-[280px]">
                    <span className="flex items-center gap-1.5">
                      <Link
                        href={`/library/${d.slug}`}
                        target="_blank"
                        className={`truncate font-medium hover:text-zinc-900 ${deleted ? 'line-through' : ''}`}
                        title={d.title}
                      >
                        {d.title}
                      </Link>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted" />
                    </span>
                  </td>
                  <td>
                    <select
                      value={d.docType}
                      disabled={pending || deleted}
                      onChange={(e) =>
                        mutate({
                          url: `/api/admin/library/${d.id}`,
                          method: 'PATCH',
                          body: { docType: e.target.value },
                          success: '已更新类型',
                        })
                      }
                      className="h-6 rounded border border-zinc-200 bg-white px-1 text-[11px] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {DOC_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {DOC_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="font-mono text-[11px] uppercase text-muted">{d.format}</td>
                  <td>
                    <span className="flex flex-wrap items-center gap-1">
                      <span
                        className="badge"
                        style={{ background: status.bg, color: status.color }}
                        title={d.status === 'failed' ? d.processingError ?? undefined : undefined}
                      >
                        {status.label}
                      </span>
                      <span
                        className="badge"
                        style={{ background: ai.bg, color: ai.color }}
                        title={d.aiIndexState === 'failed' ? d.aiError ?? undefined : undefined}
                      >
                        {ai.label}
                      </span>
                      {deleted && (
                        <span className="badge" style={{ background: '#f4f4f5', color: '#71717a' }}>
                          已删除
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="text-[11px]" title={`@${d.uploader.handle}`}>
                    {d.uploader.displayName}
                  </td>
                  <td className="font-mono text-[11px] tabular-nums">
                    {d.shelfCount} / {d.viewCount}
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-muted">
                    {formatDistanceToNowStrict(new Date(d.createdAt), { addSuffix: true })}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      {!deleted && (
                        <>
                          <button
                            onClick={() =>
                              mutate({
                                url: `/api/admin/library/${d.id}`,
                                method: 'PATCH',
                                body: { featured: !d.featured },
                                success: d.featured ? '已取消推荐' : '已推荐',
                              })
                            }
                            disabled={pending}
                            title={d.featured ? '取消推荐' : '推荐'}
                            className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 disabled:opacity-60 dark:border-zinc-700"
                          >
                            <Star
                              className={`h-3.5 w-3.5 ${d.featured ? 'fill-amber-400 text-amber-400' : 'text-muted'}`}
                            />
                          </button>
                          {(d.status === 'failed' || d.status === 'ready') && (
                            <button
                              onClick={() =>
                                mutate({
                                  url: `/api/library/docs/${d.id}/reprocess`,
                                  method: 'POST',
                                  success: '已开始重新处理',
                                })
                              }
                              disabled={pending}
                              title="重新抓取并提取内容"
                              className="flex h-6 items-center gap-1 rounded border border-zinc-200 px-2 text-[11px] hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700"
                            >
                              <RefreshCw className="h-3 w-3" />
                              重新处理
                            </button>
                          )}
                          {d.status === 'ready' && (
                            <button
                              onClick={() =>
                                mutate({
                                  url: `/api/library/docs/${d.id}/index`,
                                  method: 'POST',
                                  success: 'AI 导读重建已开始',
                                })
                              }
                              disabled={pending || d.aiIndexState === 'running'}
                              title="重新生成 AI 导读与章节摘要"
                              className="flex h-6 items-center gap-1 rounded border border-zinc-200 px-2 text-[11px] hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700"
                            >
                              <Sparkles className="h-3 w-3" />
                              AI 重建
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (!confirm(`确定删除「${d.title}」？删除后可在此页恢复。`)) return;
                              mutate({
                                url: `/api/admin/library/${d.id}`,
                                method: 'DELETE',
                                success: '已删除',
                              });
                            }}
                            disabled={pending}
                            className="flex h-6 items-center gap-1 rounded border border-danger/40 px-2 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-60"
                          >
                            <Trash2 className="h-3 w-3" />
                            删除
                          </button>
                        </>
                      )}
                      {deleted && (
                        <button
                          onClick={() => {
                            if (!confirm(`确定恢复「${d.title}」？`)) return;
                            mutate({
                              url: `/api/admin/library/${d.id}`,
                              method: 'PATCH',
                              body: { restore: true },
                              success: '已恢复',
                            });
                          }}
                          disabled={pending}
                          className="flex h-6 items-center gap-1 rounded border border-zinc-200 px-2 text-[11px] hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700"
                        >
                          <RotateCcw className="h-3 w-3" />
                          恢复
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
