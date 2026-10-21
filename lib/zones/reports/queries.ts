// 版块报告 — 视图、创建、删除、发布为帖子（docs/contracts/reports.md §3）。
// 列表 / 状态接口永远不 select messagesJson（可达数百 KB）；reportJson 只在详情与发布时读。

import type { Prisma, ZoneReportKind, ZoneReportStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import type { ZoneAccessRow } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { createZonePost, type AttachmentInput, type ZonePostInput } from '@/lib/zones/post-queries';
import { ZONE_LIMITS, ZONE_MEDIA_KEY_RE, ZONE_POST_VISIBILITIES, type ZonePostVisibilityValue } from '@/lib/zones/shared';
import { statZoneMediaAsync, zoneMediaPublicUrl } from '@/lib/zones/storage';
import { authorMatchViews, type AuthorMatchRow, type AuthorMatchView } from './authors';
import { librarySlugsForReport } from './library';
import { effectiveStatus, triggerZoneReport } from './pipeline';
import { renderReportMarkdown, reportSummaryText, reportTags } from './render-md';
import { REPORT_KINDS, type Report } from './schema';

export const MAX_REPORT_ASSETS = 300;

export interface ZoneReportView {
  id: string;
  zoneId: string;
  kind: ZoneReportKind;
  title: string;
  subject: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: ZoneReportStatus;
  stage: string;
  progress: number;
  error: string | null;
  sourceName: string | null;
  imported: boolean;
  model: string | null;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: PublicAuthor;
  isMine: boolean;
  post: { id: string; slug: string | null; title: string } | null;
}

export interface ZoneReportAssetView {
  id: string;
  key: string;
  name: string;
  kind: string;
  sizeBytes: number;
  libraryDoc: { id: string; slug: string; title: string } | null;
  /** 根相对 `/api/zones/media/<key>`（渲染时 withBasePath）。 */
  url: string;
}

export interface ZoneReportDetailView extends ZoneReportView {
  report: Report | null;
  authorMatches: AuthorMatchView[];
  assets: ZoneReportAssetView[];
  warnings: string[];
}

const REPORT_LIST_SELECT = {
  id: true,
  zoneId: true,
  kind: true,
  title: true,
  subject: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  stage: true,
  progress: true,
  error: true,
  sourceName: true,
  importKey: true,
  model: true,
  heartbeatAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  createdBy: AUTHOR_IDENTITY_SELECT,
  post: { select: { id: true, slug: true, title: true, deletedAt: true } },
  _count: { select: { assets: true } },
} satisfies Prisma.ZoneReportSelect;

type ReportListRow = Prisma.ZoneReportGetPayload<{ select: typeof REPORT_LIST_SELECT }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function toView(r: ReportListRow, viewerId: string | null, canSeeIdentity: boolean): ZoneReportView {
  return {
    id: r.id,
    zoneId: r.zoneId,
    kind: r.kind,
    title: r.title,
    subject: r.subject,
    periodStart: day(r.periodStart),
    periodEnd: day(r.periodEnd),
    status: effectiveStatus(r),
    stage: r.stage,
    progress: r.progress,
    error: effectiveStatus(r) === 'failed' && r.status !== 'failed' ? '生成进程中断（超过 10 分钟没有进度），可以重试' : r.error,
    sourceName: r.sourceName,
    imported: !!r.importKey,
    model: r.model,
    assetCount: r._count.assets,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: toPublicAuthor(r.createdBy, canSeeIdentity),
    isMine: !!viewerId && viewerId === r.createdById,
    post: r.post && !r.post.deletedAt ? { id: r.post.id, slug: r.post.slug, title: r.post.title } : null,
  };
}

export async function listZoneReports(zoneId: string, viewerId: string | null, canSeeIdentity: boolean, take = 50): Promise<ZoneReportView[]> {
  const rows = await prisma.zoneReport.findMany({ where: { zoneId }, orderBy: { createdAt: 'desc' }, take: Math.min(200, take), select: REPORT_LIST_SELECT });
  return rows.map((r) => toView(r, viewerId, canSeeIdentity));
}

export async function getZoneReportDetail(zoneId: string, reportId: string, viewerId: string | null, canSeeIdentity: boolean): Promise<ZoneReportDetailView | null> {
  const r = await prisma.zoneReport.findFirst({
    where: { id: reportId, zoneId },
    select: {
      ...REPORT_LIST_SELECT,
      reportJson: true,
      authorMatches: true,
      clusterJson: true,
      assets: { select: { id: true, key: true, name: true, kind: true, sizeBytes: true, libraryDocId: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!r) return null;
  const docIds = r.assets.map((a) => a.libraryDocId).filter((x): x is string => !!x);
  const docs = docIds.length ? await prisma.libraryDoc.findMany({ where: { id: { in: docIds }, deletedAt: null }, select: { id: true, slug: true, title: true } }) : [];
  const docById = new Map(docs.map((d) => [d.id, d]));
  const matches = ((r.authorMatches as unknown as AuthorMatchRow[] | null) ?? []).filter((m) => m && typeof m.account === 'string');
  const warnings = ((r.clusterJson as { warnings?: unknown } | null)?.warnings as string[] | undefined) ?? [];
  return {
    ...toView(r, viewerId, canSeeIdentity),
    report: r.status === 'ready' ? ((r.reportJson as unknown as Report | null) ?? null) : null,
    authorMatches: await authorMatchViews(matches, canSeeIdentity),
    assets: r.assets.map((a) => ({ id: a.id, key: a.key, name: a.name, kind: a.kind, sizeBytes: a.sizeBytes, libraryDoc: a.libraryDocId ? (docById.get(a.libraryDocId) ?? null) : null, url: zoneMediaPublicUrl(a.key) })),
    warnings: Array.isArray(warnings) ? warnings.slice(0, 50) : [],
  };
}

// ── 创建 ────────────────────────────────────────────────────────────────────

export const reportAssetInputSchema = z.object({
  key: z.string().regex(ZONE_MEDIA_KEY_RE),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['image', 'file']),
  mimeType: z.string().max(120).default(''),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});

export const createReportInputSchema = z
  .object({
    title: z.string().trim().max(ZONE_LIMITS.postTitleMax).default(''),
    kind: z.enum(REPORT_KINDS).default('monthly'),
    subject: z.string().trim().max(80).default(''),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    sourceKey: z.string().regex(ZONE_MEDIA_KEY_RE).nullable().default(null),
    sourceName: z.string().trim().max(200).nullable().default(null),
    manifestKey: z.string().regex(ZONE_MEDIA_KEY_RE).nullable().default(null),
    importKey: z.string().regex(ZONE_MEDIA_KEY_RE).nullable().default(null),
    /** 一次上传的整个文件夹 / zip（`file/*.zip`）；流水线第一步解包（lib/zones/reports/bundle.ts 的规则）。 */
    bundleKey: z.string().regex(ZONE_MEDIA_KEY_RE).nullable().default(null),
    assets: z.array(reportAssetInputSchema).max(MAX_REPORT_ASSETS).default([]),
  })
  .refine((v) => !!v.sourceKey || !!v.importKey || !!v.bundleKey, { message: 'source_required' });
export type CreateReportInput = z.infer<typeof createReportInputSchema>;

/** 上传过的 key 必须真实存在于磁盘（和帖子附件一样再验一遍）。 */
async function assertOnDisk(keys: string[]): Promise<void> {
  for (const key of keys) {
    const st = await statZoneMediaAsync(key);
    if (!st) throw new ZoneError('attachments_invalid', 400);
  }
}

export async function createZoneReport(zoneId: string, creatorId: string, input: CreateReportInput): Promise<{ id: string }> {
  const keys = [input.sourceKey, input.manifestKey, input.importKey, input.bundleKey, ...input.assets.map((a) => a.key)].filter((k): k is string => !!k);
  if (new Set(keys).size !== keys.length) throw new ZoneError('attachments_invalid', 400);
  await assertOnDisk(keys);
  if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) throw new ZoneError('invalid_input', 400);
  const title = input.title || (input.subject ? `${input.subject} · ${{ daily: '日报', weekly: '周报', monthly: '月报', custom: '报告' }[input.kind]}` : '报告');
  const row = await prisma.zoneReport.create({
    data: {
      zoneId,
      createdById: creatorId,
      kind: input.kind,
      title,
      subject: input.subject,
      periodStart: input.periodStart ? new Date(`${input.periodStart}T00:00:00Z`) : null,
      periodEnd: input.periodEnd ? new Date(`${input.periodEnd}T00:00:00Z`) : null,
      sourceKey: input.sourceKey,
      sourceName: input.sourceName,
      manifestKey: input.manifestKey,
      importKey: input.importKey,
      bundleKey: input.bundleKey,
      status: 'queued',
      stage: '排队中',
      assets: { create: input.assets.map((a) => ({ key: a.key, name: a.name.slice(0, 200), kind: a.kind, mimeType: a.mimeType, sizeBytes: a.sizeBytes })) },
    },
    select: { id: true },
  });
  triggerZoneReport(row.id);
  return row;
}

/** 失败 / 中断的重试：从失败的那一步继续（中间产物在行上）。 */
export async function retryZoneReport(reportId: string): Promise<boolean> {
  const r = await prisma.zoneReport.findUnique({ where: { id: reportId }, select: { status: true, heartbeatAt: true, postId: true } });
  if (!r) return false;
  const eff = effectiveStatus(r);
  if (eff !== 'failed' && eff !== 'queued') return false;
  await prisma.zoneReport.update({ where: { id: reportId }, data: { status: 'queued', error: null, stage: '排队中（重试）' } });
  triggerZoneReport(reportId);
  return true;
}

/** 删除报告行（上传的文件保留给已发布的帖子；未发布的附件也不主动删——帖子附件清理走它自己的路径）。 */
export async function deleteZoneReport(reportId: string): Promise<void> {
  await prisma.zoneReport.delete({ where: { id: reportId } });
}

// ── 发布为帖子 ──────────────────────────────────────────────────────────────

export const publishReportInputSchema = z.object({
  coauthorUserIds: z.array(z.string().min(1).max(64)).max(ZONE_LIMITS.maxCoauthors).default([]),
  columnId: z.string().trim().max(64).nullable().default(null),
  visibility: z.enum(ZONE_POST_VISIBILITIES).default('zone'),
  status: z.enum(['draft', 'published']).default('draft'),
  includeStats: z.boolean().default(false),
});
export type PublishReportInput = z.infer<typeof publishReportInputSchema>;

export async function publishZoneReport(
  zone: ZoneAccessRow,
  reportId: string,
  actorId: string,
  input: PublishReportInput,
  opts: { canModerate: boolean },
): Promise<{ id: string; slug: string | null }> {
  const r = await prisma.zoneReport.findFirst({
    where: { id: reportId, zoneId: zone.id },
    select: { id: true, status: true, heartbeatAt: true, title: true, reportJson: true, authorMatches: true, postId: true, assets: { select: { key: true, name: true, kind: true, mimeType: true, sizeBytes: true } } },
  });
  if (!r) throw new ZoneError('not_found', 404);
  if (r.postId) throw new ZoneError('report_already_published', 409);
  if (effectiveStatus(r) !== 'ready' || !r.reportJson) throw new ZoneError('report_not_ready', 409);
  const report = r.reportJson as unknown as Report;
  const librarySlugs = await librarySlugsForReport(r.id);
  const bodyMd = renderReportMarkdown(report, { librarySlugs, includeStats: input.includeStats });
  // 合著者只能来自匹配结果（页面上勾选的），创建者本人不是自己的合著者
  const matched = new Set(((r.authorMatches as unknown as AuthorMatchRow[] | null) ?? []).map((m) => m.userId).filter((x): x is string => !!x));
  const coauthorIds = [...new Set(input.coauthorUserIds)].filter((id) => id !== actorId && matched.has(id));
  const attachments: AttachmentInput[] = r.assets.map((a) => ({ key: a.key, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, width: null, height: null, posterKey: null }));
  const postInput: ZonePostInput = {
    type: 'article',
    title: (report.title || r.title).slice(0, ZONE_LIMITS.postTitleMax),
    summary: reportSummaryText(report, ZONE_LIMITS.postSummaryMax),
    bodyMd,
    coverKey: null,
    linkUrl: null,
    tags: reportTags(report),
    coauthorIds,
    attachments,
    status: input.status,
    columnId: input.columnId,
    columnName: null,
    visibility: input.visibility as ZonePostVisibilityValue,
    designatedUserIds: [],
    regenerateAccessCode: false,
  };
  const post = await createZonePost(zone, actorId, postInput, { canModerate: opts.canModerate });
  await prisma.zoneReport.update({ where: { id: r.id }, data: { postId: post.id } });
  return post;
}
