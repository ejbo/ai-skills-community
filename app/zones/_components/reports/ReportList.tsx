'use client';

// 版块报告 — 列表（状态 pill · 标题 · 区间 · 创建者 · 时间 · 已发布的帖子）。

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileBarChart2, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import type { ZoneReportView } from '@/lib/zones/reports/queries';
import { zoneHref, zonePostHref } from '@/lib/zones/shared';
import { RelTime } from '../RelTime';
import { PILL_INK, PILL_MONO } from '../ui';

const RUNNING = new Set(['queued', 'parsing', 'clustering', 'summarizing', 'assembling', 'ingesting']);

export function ReportList({ zoneSlug, items }: { zoneSlug: string; items: ZoneReportView[] }) {
  const t = useTranslations('zones');
  if (!items.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-muted dark:border-zinc-700">
        <FileBarChart2 className="mx-auto mb-2 h-6 w-6 text-zinc-400" aria-hidden />
        {t('reports_empty')}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {items.map((r) => (
        <li key={r.id} className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
          <span className={r.status === 'ready' ? PILL_INK : PILL_MONO}>
            {RUNNING.has(r.status) && <Loader2 className="h-3 w-3 animate-spin" />}
            {t(`report_status_${r.status}`)}
          </span>
          <Link href={`${zoneHref(zoneSlug)}/reports/${r.id}`} className="min-w-0 flex-1 font-medium after:absolute after:inset-0">
            <span className="line-clamp-1">{r.title}</span>
          </Link>
          <span className="font-mono text-xs tabular-nums text-muted">
            {r.periodStart && r.periodEnd ? `${r.periodStart} ~ ${r.periodEnd}` : t(`report_kind_${r.kind}`)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <Avatar name={r.createdBy.displayName} src={r.createdBy.avatarUrl} size="xs" />
            {r.createdBy.displayName}
          </span>
          <RelTime at={r.createdAt} className="font-mono text-xs tabular-nums text-muted" />
          {r.post && (
            <Link href={zonePostHref(zoneSlug, r.post)} className="relative z-10 text-xs underline-offset-2 hover:underline">
              {t('report_open_post')} →
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
