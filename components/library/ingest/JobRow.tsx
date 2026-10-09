'use client';

// One 收录任务 as the dialog and the dock both draw it: label, the three-step bar
// (上传/抓取 → 解析 → AI 导读), the stage line, and 「查看」 / dismiss when finished.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, FileText, Link2, Loader2, X } from 'lucide-react';
import { INGEST_STEPS, isActiveJob, jobPercent, stageKey, stepIndex, type IngestJob } from '@/lib/library/ingest-shared';

export function JobRow({ job, onDismiss, compact = false }: { job: IngestJob; onDismiss?: (id: string) => void; compact?: boolean }) {
  const t = useTranslations('library_ui');
  const active = isActiveJob(job);
  const pct = jobPercent(job);
  const step = stepIndex(job);
  const label = job.title ?? job.label;
  const line = t(stageKey(job), { pct: job.percent ?? 0 });
  const stepNames: Record<(typeof INGEST_STEPS)[number], string> = {
    transfer: job.kind === 'file' ? t('step_upload') : t('step_fetch'),
    parse: t('step_parse'),
    ai: t('step_ai'),
  };

  return (
    <div className={`flex gap-2.5 ${compact ? 'py-1.5' : 'py-2.5'}`}>
      <span className="mt-0.5 shrink-0 text-muted">
        {job.stage === 'failed' ? (
          <AlertCircle className="h-4 w-4 text-danger" />
        ) : active ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]">
          {job.kind === 'file' ? <FileText className="h-3.5 w-3.5 shrink-0 text-muted" /> : <Link2 className="h-3.5 w-3.5 shrink-0 text-muted" />}
          <span className="min-w-0 truncate font-medium" title={label}>
            {label}
          </span>
          {!active && job.slug && (
            <Link href={`/library/${job.slug}`} className="ml-auto shrink-0 text-xs font-medium underline decoration-dotted underline-offset-2">
              {t('view_doc')}
            </Link>
          )}
          {!active && onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(job.id)}
              aria-label={t('dock_dismiss')}
              className={`shrink-0 rounded text-muted transition hover:text-zinc-900 dark:hover:text-zinc-50 ${job.slug ? '' : 'ml-auto'}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* Three segments; the current one carries the live percent (upload) or an animated fill. */}
        <div className="mt-1.5 flex gap-1" aria-hidden>
          {INGEST_STEPS.map((s, i) => {
            const segPct = i < step ? 100 : i > step ? 0 : job.stage === 'uploading' ? (job.percent ?? 0) : 100;
            return (
              <span key={s} className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <span
                  className={`block h-full bg-zinc-900 transition-[width] duration-300 dark:bg-zinc-100 ${
                    i === step && active && job.stage !== 'uploading' ? 'animate-pulse' : ''
                  } ${job.stage === 'failed' && i === step ? 'bg-danger dark:bg-danger' : ''}`}
                  style={{ width: `${segPct}%` }}
                />
              </span>
            );
          })}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
          <span className={job.stage === 'failed' ? 'text-danger' : ''}>{job.stage === 'failed' && job.error ? `${line}：${job.error}` : line}</span>
          {!compact && active && (
            <span className="ml-auto shrink-0 font-mono tabular-nums">
              {stepNames[INGEST_STEPS[Math.min(step, 2)]]} · {pct}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
