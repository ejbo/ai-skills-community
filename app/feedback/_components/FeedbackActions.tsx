'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import type { FeedbackStatus } from '@prisma/client';
import { pushToast } from '@/components/Toaster';
import { STATUS_META } from './badges';

/**
 * Inline moderation on the detail page — no separate admin screen. Admins get
 * the status select; the author (and admins) get delete.
 */
export function FeedbackActions({
  feedbackId,
  status,
  isAdmin,
  canDelete,
}: {
  feedbackId: string;
  status: FeedbackStatus;
  isAdmin: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function changeStatus(next: string) {
    if (next === status || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/feedback/${feedbackId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        pushToast('error', '状态更新失败');
        return;
      }
      pushToast('success', `已标记为「${STATUS_META[next as FeedbackStatus].label}」`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('确定删除这条反馈？所有评论和 +1 会一并删除。')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/feedback/${feedbackId}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        setBusy(false);
        return;
      }
      pushToast('success', '已删除');
      router.push('/feedback');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  if (!isAdmin && !canDelete) return null;

  return (
    <div className="flex items-center gap-2">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
      {isAdmin && (
        <select
          value={status}
          disabled={busy}
          onChange={(e) => changeStatus(e.target.value)}
          title="标记处理状态（管理员）"
          className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
      )}
      {canDelete && (
        <button
          onClick={remove}
          disabled={busy}
          className="flex h-8 items-center gap-1 rounded-lg border border-danger/40 px-2.5 text-xs text-danger hover:bg-danger/10 disabled:opacity-60"
        >
          <Trash2 className="h-3 w-3" />
          删除
        </button>
      )}
    </div>
  );
}
