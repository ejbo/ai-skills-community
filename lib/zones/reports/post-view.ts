// 版块报告帖子的原生渲染数据（docs/contracts/reports.md §3a）。
//
// 帖子详情里带上 `post.report`：reportJson 本体 + 发言人→站内用户（头像 / 悬停名片）+ 附件→知识库 slug。
// 发言人身份走 AUTHOR_IDENTITY_FIELDS → toPublicAuthor(canSeeIdentity)（和作者一样在服务端边界脱敏）。
// 目录（右栏 TOC）也从这里出：ReportArticle 的 section id 必须和 reportHeadings 一致。

import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_FIELDS, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import { zoneMediaPublicUrl } from '@/lib/zones/storage';
import type { ZonePostReportView } from '@/lib/zones/types';
import type { AuthorMatchRow } from './authors';
import { reportSchema, type Report } from './schema';

export { REPORT_SECTION_IDS, reportHeadings } from './sections';

export interface PostReportRow {
  id: string;
  slug: string | null;
  status: string;
  reportJson: unknown;
  authorMatches: unknown;
}

/** null when the linked report is not ready / its JSON does not parse (the post falls back to bodyMd). */
export async function loadZonePostReportView(row: PostReportRow | null | undefined, canSeeIdentity: boolean): Promise<ZonePostReportView | null> {
  if (!row || row.status !== 'ready' || !row.reportJson) return null;
  const parsed = reportSchema.safeParse(row.reportJson);
  if (!parsed.success) return null;
  const report = parsed.data as unknown as Report;

  const matches = Array.isArray(row.authorMatches) ? (row.authorMatches as unknown as AuthorMatchRow[]) : [];
  const ids = [...new Set(matches.map((m) => m.userId).filter((id): id is string => !!id))];
  const speakers: Record<string, PublicAuthor> = {};
  if (ids.length) {
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, ...AUTHOR_IDENTITY_FIELDS } });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const m of matches) {
      const u = m.userId ? byId.get(m.userId) : undefined;
      if (u) speakers[m.account.toLowerCase()] = toPublicAuthor(u, canSeeIdentity);
    }
  }
  const assetUrls: Record<string, string> = {};
  for (const a of report.attachments) if (a.assetKey) assetUrls[a.id] = zoneMediaPublicUrl(a.assetKey);
  return { id: row.id, slug: row.slug, report, speakers, librarySlugs: await librarySlugsByName(row.id), assetUrls };
}

/** 附件文件名 → 知识库 slug（只认未删除的文档）。和 library.ts 的 librarySlugsForReport 同一条查询，
 *  这里不 import 那个模块——它带着整个知识库收录链（ingest / storage），帖子详情用不着。 */
async function librarySlugsByName(reportId: string): Promise<Record<string, string>> {
  const rows = await prisma.zoneReportAsset.findMany({ where: { reportId, libraryDocId: { not: null } }, select: { name: true, libraryDocId: true } });
  const ids = rows.map((r) => r.libraryDocId!).filter(Boolean);
  if (!ids.length) return {};
  const docs = await prisma.libraryDoc.findMany({ where: { id: { in: ids }, deletedAt: null, status: 'ready' }, select: { id: true, slug: true } });
  const slugById = new Map(docs.map((d) => [d.id, d.slug]));
  const out: Record<string, string> = {};
  for (const r of rows) {
    const slug = r.libraryDocId ? slugById.get(r.libraryDocId) : undefined;
    if (slug) out[r.name] = slug;
  }
  return out;
}
