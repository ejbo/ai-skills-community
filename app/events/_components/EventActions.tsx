'use client';

// Owner/admin inline actions on the event detail page: 编辑 (author only,
// mirrors the PATCH route's content rule) / 取消·恢复 (owner) / 置顶 (admin) /
// 删除 (owner). House pattern: window.confirm + fetch + pushToast + router.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Ban, Loader2, Pencil, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export function EventActions({
  id,
  pinned,
  cancelled,
  isAuthor,
  isAdmin,
}: {
  id: string;
  pinned: boolean;
  cancelled: boolean;
  isAuthor: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations('event_form');
  const tc = useTranslations('common');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('err_action_failed'));
        return;
      }
      pushToast('success', okMsg);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('confirm_delete'))) return;
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('err_delete_failed'));
        return;
      }
      pushToast('success', t('deleted'));
      router.push('/events');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const btn =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
      {isAuthor && (
        <Link href={`/events/${id}/edit`} className={btn}>
          <Pencil className="h-3.5 w-3.5" />
          {tc('edit')}
        </Link>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          cancelled
            ? patch({ cancelled: false }, t('restored'))
            : confirm(t('confirm_cancel')) && patch({ cancelled: true }, t('marked_cancelled'))
        }
        className={btn}
      >
        {cancelled ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
        {cancelled ? t('restore_event') : t('cancel_event')}
      </button>
      {isAdmin && (
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ pinned: !pinned }, pinned ? t('unpinned_ok') : t('pinned_ok'))}
          className={btn}
        >
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          {pinned ? t('unpin') : t('pin')}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={remove}
        className={`${btn} !text-red-600 hover:!bg-red-50 dark:hover:!bg-red-500/10`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {tc('delete')}
      </button>
    </div>
  );
}
