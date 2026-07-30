'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

type Action = 'approve' | 'reject' | 'revoke';

/** Owner/admin approve-reject (pending) or revoke (active grant) controls. */
export function DecisionButtons({
  slug,
  id,
  variant,
}: {
  slug: string;
  id: string;
  variant: 'pending' | 'grant';
}) {
  const t = useTranslations('skill_detail');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: Action) {
    if (action === 'revoke' && !confirm(t('revoke_confirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/skills/${slug}/access-requests/${id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        pushToast('success', t('updated'));
        router.refresh();
      } else {
        pushToast('error', t('action_failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (variant === 'grant') {
    return (
      <button
        disabled={busy}
        onClick={() => act('revoke')}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-danger/40 px-2 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
      >
        <Ban className="h-3 w-3" />
        {t('revoke')}
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        disabled={busy}
        onClick={() => act('approve')}
        className="inline-flex h-7 items-center gap-1 rounded-md bg-ok/15 px-2 text-xs font-medium text-ok transition hover:bg-ok/25 disabled:opacity-50"
      >
        <Check className="h-3 w-3" />
        {t('approve')}
      </button>
      <button
        disabled={busy}
        onClick={() => act('reject')}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-300 px-2 text-xs font-medium text-muted transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-50"
      >
        <X className="h-3 w-3" />
        {t('reject')}
      </button>
    </div>
  );
}
