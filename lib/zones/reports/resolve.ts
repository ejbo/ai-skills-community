// /reports/[slug] 的参数解析：标题 slug，或老链接里的行 id（docs/contracts/slugs.md）。

import { prisma } from '@/lib/db';
import { decodeSlugParam } from '@/lib/slug';
import { resolveSlugAlias } from '@/lib/slug-server';
import { REPORT_GATE_SELECT, type ReportGateRow } from './visibility';

export interface ResolvedReport extends ReportGateRow {
  slug: string | null;
  /** 用 id / 退休 slug 进来的，页面 301 到标题 slug。 */
  needsRedirect: boolean;
}

export async function resolveReportParam(rawParam: string): Promise<ResolvedReport | null> {
  // App Router 把动态段**按百分号编码**交进来：中文标题的 slug（titleSlug 保留 CJK）到这里是 `%E5%8A%A0…`，
  // 不解码就查不到 → 分享页 / 看原文全 404（2026-10-21 owner 报的「看原文显示 404」就是这个）。
  const param = decodeSlugParam(rawParam);
  if (!param) return null;
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
