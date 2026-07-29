'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

/** 提取处理中的占位面板：每 3s 轮询状态，到达终态后刷新页面。 */
export function ProcessingPanel({ docId, status }: { docId: string; status: string }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.status === 'ready' || data?.status === 'failed') {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        /* 轮询失败下轮重试 */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [docId, router]);

  return (
    <div className="surface rounded-2xl p-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="h-4 w-4 animate-spin text-accent-500" />
        {status === 'pending' ? '排队等待处理…' : '正在提取内容…'}
      </div>
      <p className="mt-1 text-xs text-muted">提取完成后自动刷新，通常只需几秒钟。</p>
      <div className="mt-4 space-y-2">
        <div className="shimmer h-3 w-full rounded" />
        <div className="shimmer h-3 w-5/6 rounded" />
        <div className="shimmer h-3 w-2/3 rounded" />
      </div>
    </div>
  );
}

/** 处理失败时的重试按钮（上传者 / 管理员）。 */
export function ReprocessButton({ docId }: { docId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/library/docs/${docId}/reprocess`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? '操作失败，请稍后再试');
        return;
      }
      pushToast('success', '已重新开始处理');
      router.refresh();
    } catch {
      pushToast('error', '网络错误，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={retry}
      disabled={busy}
      className="flex h-8 items-center gap-1.5 rounded-lg border border-danger/40 px-3 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      重试
    </button>
  );
}
