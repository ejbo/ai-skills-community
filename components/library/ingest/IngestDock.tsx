'use client';

// Bottom-right dock: what the minimized 添加内容 dialog collapses to. Shows while
// there are jobs and the dialog is closed; one line per job (up to three), a
// header with the live count, 「展开」 to bring the dialog back, 「清除」 for
// finished ones. Clicking anywhere on the card also expands.

import { useTranslations } from 'next-intl';
import { ChevronUp, Loader2, X } from 'lucide-react';
import { summarize } from '@/lib/library/ingest-shared';
import { useIngestJobs } from './IngestJobsProvider';
import { JobRow } from './JobRow';

const MAX_ROWS = 3;

export function IngestDock() {
  const t = useTranslations('library_ui');
  const { jobs, dialogOpen, openDialog, dismiss, dismissFinished } = useIngestJobs();
  if (dialogOpen || jobs.length === 0) return null;
  const { active, done, failed } = summarize(jobs);
  const title =
    active > 0 ? t('dock_title_running', { count: active }) : failed > 0 && done === 0 ? t('dock_title_failed') : t('dock_title_done');

  return (
    <aside
      className="surface fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl p-3 shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      aria-live="polite"
      aria-label={t('ingest_jobs_title')}
    >
      <div className="flex items-center gap-2">
        {active > 0 && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        <button type="button" onClick={openDialog} className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
          {title}
        </button>
        <button
          type="button"
          onClick={openDialog}
          aria-label={t('dock_expand')}
          title={t('dock_expand')}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        {active === 0 && (
          <button
            type="button"
            onClick={dismissFinished}
            aria-label={t('dock_dismiss')}
            title={t('dock_dismiss')}
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {jobs.slice(0, MAX_ROWS).map((job) => (
          <JobRow key={job.id} job={job} onDismiss={dismiss} compact />
        ))}
      </div>
      {jobs.length > MAX_ROWS && (
        <button type="button" onClick={openDialog} className="mt-1 text-[11px] text-muted hover:text-zinc-900 dark:hover:text-zinc-50">
          {t('dock_more', { count: jobs.length - MAX_ROWS })}
        </button>
      )}
      {active > 0 && <p className="mt-1.5 text-[11px] text-muted">{t('dock_hint')}</p>}
    </aside>
  );
}
