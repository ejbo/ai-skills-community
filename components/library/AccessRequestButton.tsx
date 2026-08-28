'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';

/** 受限文档的 申请阅读 flow (skills access-request model). */
export function AccessRequestButton({
  docId,
  initialStatus,
  loggedIn,
}: {
  docId: string;
  initialStatus: string | null;
  loggedIn: boolean;
}) {
  const t = useTranslations('library_ui');
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!loggedIn) {
      router.push(currentLoginHref());
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/library/docs/${docId}/access-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message.trim() ? { message: message.trim() } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'failed');
      setStatus(data.status ?? 'pending');
      setOpen(false);
      pushToast('success', t('access_submitted'));
    } catch {
      pushToast('error', t('access_failed'));
    } finally {
      setBusy(false);
    }
  }

  if (status === 'pending') {
    return (
      <div className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
        <Lock className="h-4 w-4" />
        {t('access_pending')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {open ? (
        <>
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t('access_reason_placeholder')}
            className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:focus:border-zinc-100 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
          >
            {t('access_submit')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300"
        >
          <Lock className="h-4 w-4" />
          {status === 'rejected' ? t('access_reapply') : t('access_request')}
        </button>
      )}
      <p className="text-center text-xs text-muted">{t('access_restricted_hint')}</p>
    </div>
  );
}
