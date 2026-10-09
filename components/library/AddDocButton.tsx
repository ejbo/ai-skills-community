'use client';

// 「+ 添加内容」 — just the button. The dialog, the jobs and the bottom-right dock
// live in components/library/ingest/IngestJobsProvider (mounted in the root
// layout), so an upload keeps running while the member browses elsewhere.

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';
import { useIngestJobs } from './ingest/IngestJobsProvider';

export function AddDocButton({ loggedIn }: { loggedIn: boolean }) {
  const t = useTranslations('library_ui');
  const router = useRouter();
  const { openDialog } = useIngestJobs();

  function onClick() {
    if (!loggedIn) {
      pushToast('error', t('login_before_add'));
      router.push(currentLoginHref());
      return;
    }
    openDialog();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      <Plus className="h-4 w-4" />
      {t('add_content')}
    </button>
  );
}
