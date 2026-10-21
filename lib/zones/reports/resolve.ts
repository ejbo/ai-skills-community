// /reports/[slug] 的参数解析：标题 slug，或老链接里的行 id（docs/contracts/slugs.md）。

import { prisma } from '@/lib/db';
import { resolveSlugAlias } from '@/lib/slug-server';
import { REPORT_GATE_SELECT, type ReportGateRow } from './visibility';

export interface ResolvedReport extends ReportGateRow {
  slug: string | null;
  /** 用 id / 退休 slug 进来的，页面 301 到标题 slug。 */
  needsRedirect: boolean;
}

export async function resolveReportParam(param: string): Promise<ResolvedReport | null> {
  const select = { ...REPORT_GATE_SELECT, slug: true } as const;
  const bySlug = await prisma.zoneReport.findUnique({ where: { slug: param }, select });
  if (bySlug) return { ...bySlug, needsRedirect: false };
  const byId = await prisma.zoneReport.findUnique({ where: { id: param }, select });
  if (byId) return { ...byId, needsRedirect: !!byId.slug };
  const aliased = await resolveSlugAlias('report', param);
  if (aliased) {
    const row = await prisma.zoneReport.findUnique({ where: { id: aliased }, select });
    if (row) return { ...row, needsRedirect: !!row.slug };
  }
  return null;
}
