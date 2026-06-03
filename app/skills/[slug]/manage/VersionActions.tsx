'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

type Action = 'set_current' | 'yank' | 'restore';

export function VersionActions({
  slug,
  versionId,
  status,
  isCurrent,
}: {
  slug: string;
  versionId: string;
  status: 'draft' | 'published' | 'yanked';
  isCurrent: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function act(action: Action, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    start(async () => {
      const res = await fetch(`/api/skills/${slug}/versions/${versionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        pushToast('error', '操作失败');
        return;
      }
      pushToast('success', '已更新');
      router.refresh();
    });
  }

  const btn = 'rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium transition hover:border-accent-500 hover:text-accent-600 disabled:opacity-50 dark:border-zinc-700';

  return (
    <span className="inline-flex items-center gap-1.5">
      {pending && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
      {!isCurrent && status !== 'yanked' && (
        <button type="button" disabled={pending} onClick={() => act('set_current')} className={btn}>
          设为当前
        </button>
      )}
      {status === 'yanked' ? (
        <button type="button" disabled={pending} onClick={() => act('restore')} className={btn}>
          恢复
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => act('yank', isCurrent ? '这是当前版本，撤回后将回退到上一个已发布版本。确定？' : '确定撤回该版本？')}
          className={btn}
        >
          撤回
        </button>
      )}
    </span>
  );
}
