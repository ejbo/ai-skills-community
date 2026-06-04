'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

export function VideoRowActions({ id, slug }: { id: string; slug: string }) {
  const t = useTranslations('video');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(t('manage.delete_confirm'))) return;
    startTransition(async () => {
      const res = await fetch(`/api/videos/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('manage.delete'));
        return;
      }
      pushToast('success', t('manage.delete'));
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/manage/videos/${id}/edit`}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:text-accent-600 dark:border-zinc-800"
        aria-label={t('comments.edit')}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:text-danger disabled:opacity-50 dark:border-zinc-800"
        aria-label={t('manage.delete')}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
