// 报告的可见范围闸门（docs/contracts/audience.md；reports.md §3b）。
//
// 一个闸门管所有读：独立分享页 /reports/[slug]、看原文页、导出、工具详情 API。
//   deleted（没有软删，直接没了）→ 404；所有者 / 站级 zones 管理员 → 总能看；
//   public → 任何登录用户；private（隐藏）→ 只有所有者；audience → 名单上的人；
//   另外：报告已分享到某篇帖子，而该帖子对这个人可见 → 也能看（帖子里的「看原文」靠它）。
// 轻量：只依赖 prisma + lib/audience，不读 session。

import type { Prisma } from '@prisma/client';
import { isInAudience } from '@/lib/audience';
import { canSeeByVisibility, type ContentVisibility } from '@/lib/audience-shared';
import { prisma } from '@/lib/db';
import { resolveZoneAccess, ZONE_ACCESS_SELECT, zoneSiteViewer, type ZoneSiteViewer } from '@/lib/zones/access';
import { canSeeZonePost, ZONE_POST_ACCESS_SELECT } from '@/lib/zones/post-queries';

export const REPORT_GATE_SELECT = {
  id: true,
  createdById: true,
  visibility: true,
  postId: true,
} as const satisfies Prisma.ZoneReportSelect;

export interface ReportGateRow {
  id: string;
  createdById: string;
  visibility: ContentVisibility;
  postId: string | null;
}

export interface ReportViewer {
  id: string | null;
  /** 站级 `zones` 权限 = 这个工具的管理员。 */
  canManage: boolean;
}

export function isReportOwner(row: { createdById: string }, viewer: ReportViewer): boolean {
  return viewer.canManage || (Boolean(viewer.id) && viewer.id === row.createdById);
}

export async function canSeeReport(row: ReportGateRow, viewer: ReportViewer, siteViewer?: ZoneSiteViewer): Promise<boolean> {
  if (!viewer.id) return false; // 整个工具都在登录墙后面
  const isOwner = isReportOwner(row, viewer);
  if (isOwner || row.visibility === 'public') return true;
  if (row.visibility === 'audience') {
    const ok = canSeeByVisibility({ visibility: row.visibility, isOwner, inAudience: await isInAudience('report', row.id, viewer.id) });
    if (ok) return true;
  }
  // 已分享到版块：帖子对这个人可见 ⇒ 报告对他可见（原生视图 / 看原文都从帖子进来）
  if (row.postId && siteViewer) return canSeeLinkedPost(row.postId, siteViewer);
  return false;
}

async function canSeeLinkedPost(postId: string, viewer: ZoneSiteViewer): Promise<boolean> {
  const post = await prisma.zonePost.findUnique({ where: { id: postId }, select: { ...ZONE_POST_ACCESS_SELECT, zone: { select: ZONE_ACCESS_SELECT } } });
  if (!post || post.deletedAt || post.zone.deletedAt) return false;
  const access = await resolveZoneAccess(post.zone, viewer);
  return canSeeZonePost(post, access, viewer);
}

export { zoneSiteViewer };
