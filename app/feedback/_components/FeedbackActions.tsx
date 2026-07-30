'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('feedback');
  const g = useTranslations();
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
        pushToast('error', t('status_update_failed'));
        return;
      }
      pushToast('success', t('marked_as', { status: t(`status_${next}`) }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('delete_feedback_confirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/feedback/${feedbackId}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('delete_failed'));
        setBusy(false);
        return;
      }
      pushToast('success', t('delete_done'));
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
          title={t('status_select_title')}
          className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          {Object.keys(STATUS_META).map((key) => (
            <option key={key} value={key}>
              {t(`status_${key}`)}
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
          {g('common.delete')}
        </button>
      )}
    </div>
  );
}
