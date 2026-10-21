// 报告原生视图的 section id 与目录（docs/contracts/reports.md §3a）。纯模块：客户端 ReportArticle
// 和服务端 post-view 都 import 它——section 的 id 在这里定一次，右栏目录才能和正文对上。

import type { MdHeading } from '@/lib/zones/shared';
import type { Report } from './schema';

export const REPORT_SECTION_IDS = {
  brief: 'report-brief',
  events: 'report-events',
  recap: 'report-recap',
  resources: 'report-resources',
  stats: 'report-stats',
  appendix: 'report-appendix',
} as const;

/** 右栏目录：要点 → 各专题 → 活动 → Recap → 资料 → 数据。 */
export function reportHeadings(report: Report): MdHeading[] {
  const out: MdHeading[] = [{ level: 2, text: '本期要点', id: REPORT_SECTION_IDS.brief }];
  report.themes.forEach((t, i) => out.push({ level: 2, text: `${String(i + 1).padStart(2, '0')} ${t.title}`, id: t.id }));
  if (report.events.length) out.push({ level: 2, text: '活动与通知', id: REPORT_SECTION_IDS.events });
  if (report.recap?.items.length) out.push({ level: 2, text: report.recap.title || '快速 Recap', id: REPORT_SECTION_IDS.recap });
  if (report.themes.some((t) => t.resources.length || t.viewpoints.some((v) => v.sources.some((s) => s.url)))) out.push({ level: 2, text: '资源索引', id: REPORT_SECTION_IDS.resources });
  out.push({ level: 2, text: '数据概览', id: REPORT_SECTION_IDS.stats });
  return out;
}
