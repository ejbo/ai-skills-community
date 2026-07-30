'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('skill_manage');
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
        pushToast('error', t('action_failed'));
        return;
      }
      pushToast('success', t('updated'));
      router.refresh();
    });
  }

  const btn = 'rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium transition hover:border-accent-500 hover:text-accent-600 disabled:opacity-50 dark:border-zinc-700';

  return (
    <span className="inline-flex items-center gap-1.5">
      {pending && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
      {!isCurrent && status !== 'yanked' && (
        <button type="button" disabled={pending} onClick={() => act('set_current')} className={btn}>
          {t('set_current')}
        </button>
      )}
      {status === 'yanked' ? (
        <button type="button" disabled={pending} onClick={() => act('restore')} className={btn}>
          {t('restore')}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => act('yank', isCurrent ? t('confirm_yank_current') : t('confirm_yank'))}
          className={btn}
        >
          {t('yank')}
        </button>
      )}
    </span>
  );
}
