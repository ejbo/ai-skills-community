'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Trash2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

export function EditVideoControls({ slug }: { slug: string }) {
  const t = useTranslations('video');
  const router = useRouter();
  const [regenerating, startRegenerate] = useTransition();
  const [deleting, startDelete] = useTransition();

  function regenerate() {
    startRegenerate(async () => {
      const res = await fetch(`/api/videos/${slug}/summary`, { method: 'POST' });
      if (!res.ok) {
        pushToast('error', t('manage.regenerate_summary'));
        return;
      }
      pushToast('success', t('manage.regenerate_summary'));
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(t('manage.delete_confirm'))) return;
    startDelete(async () => {
      const res = await fetch(`/api/videos/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('manage.delete'));
        return;
      }
      pushToast('success', t('manage.delete'));
      router.push('/manage/videos');
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={regenerate}
        disabled={regenerating}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {t('manage.regenerate_summary')}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-danger/30 px-3 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        {t('manage.delete')}
      </button>
    </div>
  );
}
