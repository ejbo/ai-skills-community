'use client';

// 「聊天记录 → 报告」工具 — 我的报告列表（状态 pill · 标题 · 区间 · 可见范围 · 时间 · 已分享的帖子）。

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileBarChart2, Loader2 } from 'lucide-react';
import type { ZoneReportView } from '@/lib/zones/reports/queries';
import { zonePostHref } from '@/lib/zones/shared';
import { VisibilityBadge } from '@/components/audience/VisibilityBadge';
import { RelTime } from '@/app/zones/_components/RelTime';
import { PILL_INK, PILL_MONO } from '@/app/zones/_components/ui';

const RUNNING = new Set(['queued', 'parsing', 'clustering', 'summarizing', 'assembling', 'ingesting']);

export function ReportList({ items }: { items: ZoneReportView[] }) {
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
          <Link href={`/tools/chat-report/${r.id}`} className="min-w-0 flex-1 font-medium after:absolute after:inset-0">
            <span className="line-clamp-1">{r.title}</span>
          </Link>
          <span className="font-mono text-xs tabular-nums text-muted">
            {r.periodStart && r.periodEnd ? `${r.periodStart} ~ ${r.periodEnd}` : t(`report_kind_${r.kind}`)}
          </span>
          <VisibilityBadge visibility={r.visibility} />
          <RelTime at={r.createdAt} className="font-mono text-xs tabular-nums text-muted" />
          {r.post && (
            <Link href={zonePostHref(r.post.zoneSlug, r.post)} className="relative z-10 text-xs underline-offset-2 hover:underline">
              {t('report_open_post')} →
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
