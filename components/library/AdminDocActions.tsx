'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('library_ui');
  const tc = useTranslations('common');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(fn: () => Promise<Response>, okMsg: string, after?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('op_failed'));
        return;
      }
      pushToast('success', okMsg);
      if (after) after();
      else router.refresh();
    } catch {
      pushToast('error', t('network_error'));
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
    'rounded border border-zinc-200 px-2 py-1 text-[11px] transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted">{t('admin_label')}</span>
      <button
        disabled={busy}
        className={btn}
        onClick={() =>
          call(() => patch({ featured: !featured }), featured ? t('unfeature_done') : t('feature_done'))
        }
      >
        {featured ? t('unfeature') : t('feature')}
      </button>
      <button
        disabled={busy}
        className={btn}
        onClick={() =>
          call(
            () => fetch(`/api/library/docs/${docId}/reprocess`, { method: 'POST' }),
            t('reprocess_done'),
          )
        }
      >
        {t('reprocess')}
      </button>
      {deleted ? (
        <button
          disabled={busy}
          className={btn}
          onClick={() => call(() => patch({ restore: true }), t('restore_done'))}
        >
          {t('restore')}
        </button>
      ) : (
        <button
          disabled={busy}
          className="rounded border border-danger/40 px-2 py-1 text-[11px] text-danger transition hover:bg-danger/10 disabled:opacity-60"
          onClick={() => {
            if (!confirm(t('delete_doc_confirm'))) return;
            call(
              () => fetch(`/api/admin/library/${docId}`, { method: 'DELETE' }),
              t('deleted_done'),
              () => router.push('/library'),
            );
          }}
        >
          {tc('delete')}
        </button>
      )}
    </div>
  );
}
