'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { pushToast } from '@/components/Toaster';

/** 详情页管理员内联操作：推荐 / 重新处理 / 删除（软删）/ 恢复。 */
export function AdminDocActions({
  docId,
  featured,
  deleted,
}: {
  docId: string;
  featured: boolean;
  deleted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(fn: () => Promise<Response>, okMsg: string, after?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? '操作失败');
        return;
      }
      pushToast('success', okMsg);
      if (after) after();
      else router.refresh();
    } catch {
      pushToast('error', '网络错误，请重试');
    } finally {
      setBusy(false);
    }
  }

  function patch(body: Record<string, unknown>) {
    return fetch(`/api/admin/library/${docId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const btn =
    'rounded border border-zinc-200 px-2 py-1 text-[11px] transition hover:border-accent-500 hover:text-accent-600 disabled:opacity-60 dark:border-zinc-700';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted">管理</span>
      <button
        disabled={busy}
        className={btn}
        onClick={() => call(() => patch({ featured: !featured }), featured ? '已取消推荐' : '已设为推荐')}
      >
        {featured ? '取消推荐' : '推荐'}
      </button>
      <button
        disabled={busy}
        className={btn}
        onClick={() =>
          call(
            () => fetch(`/api/library/docs/${docId}/reprocess`, { method: 'POST' }),
            '已重新开始处理',
          )
        }
      >
        重新处理
      </button>
      {deleted ? (
        <button
          disabled={busy}
          className={btn}
          onClick={() => call(() => patch({ restore: true }), '已恢复')}
        >
          恢复
        </button>
      ) : (
        <button
          disabled={busy}
          className="rounded border border-danger/40 px-2 py-1 text-[11px] text-danger transition hover:bg-danger/10 disabled:opacity-60"
          onClick={() => {
            if (!confirm('确定删除这篇内容？')) return;
            call(
              () => fetch(`/api/admin/library/${docId}`, { method: 'DELETE' }),
              '已删除',
              () => router.push('/library'),
            );
          }}
        >
          删除
        </button>
      )}
    </div>
  );
}
