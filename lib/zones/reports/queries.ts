// 「聊天记录 → 报告」工具 — 视图、创建、可见范围、删除、分享到版块（docs/contracts/reports.md §3）。
// 2026-10-20 起报告归创建者所有、不绑定版块：列表 = 我的；详情 / 分享页走 canSeeReport（visibility.ts）；
// 「分享到技术专区」时才把 zoneId / postId 写上。
// 列表 / 状态接口永远不 select messagesJson（可达数百 KB）；reportJson 只在详情与发布时读。

import type { Prisma, ZoneReportKind, ZoneReportStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import type { ZoneAccessRow } from '@/lib/zones/access';
import { loadAudience, replaceAudience } from '@/lib/audience';
import { newlyGrantedAudience, type AudiencePick, type AudienceState, type ContentVisibility } from '@/lib/audience-shared';
import { notifyAudienceGranted } from '@/lib/notifications';
import { createWithSlug, freeTitleSlug, isSlugConflict } from '@/lib/slug-server';
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
  /** 分享到版块后才有。 */
  zoneId: string | null;
  slug: string | null;
  visibility: ContentVisibility;
  instructions: string;
  instructionMode: 'append' | 'override';
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
  post: { id: string; slug: string | null; title: string; zoneSlug: string; zoneName: string } | null;
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
  /** 指定成员可见的名单（只给所有者 / 管理员）。 */
  audience: AudiencePick[];
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
  slug: true,
  visibility: true,
  instructions: true,
  instructionMode: true,
  createdBy: AUTHOR_IDENTITY_SELECT,
  post: { select: { id: true, slug: true, title: true, deletedAt: true, zone: { select: { slug: true, name: true } } } },
  _count: { select: { assets: true } },
} satisfies Prisma.ZoneReportSelect;

type ReportListRow = Prisma.ZoneReportGetPayload<{ select: typeof REPORT_LIST_SELECT }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function toView(r: ReportListRow, viewerId: string | null, canSeeIdentity: boolean): ZoneReportView {
  return {
    id: r.id,
    zoneId: r.zoneId,
    slug: r.slug,
    visibility: r.visibility,
    instructions: r.instructions,
    instructionMode: r.instructionMode === 'override' ? 'override' : 'append',
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
    post: r.post && !r.post.deletedAt ? { id: r.post.id, slug: r.post.slug, title: r.post.title, zoneSlug: r.post.zone.slug, zoneName: r.post.zone.name } : null,
  };
}

/** 我创建的报告（工具页列表）。 */
export async function listMyReports(viewerId: string, canSeeIdentity: boolean, take = 50): Promise<ZoneReportView[]> {
  const rows = await prisma.zoneReport.findMany({ where: { createdById: viewerId }, orderBy: { createdAt: 'desc' }, take: Math.min(200, take), select: REPORT_LIST_SELECT });
  return rows.map((r) => toView(r, viewerId, canSeeIdentity));
}

/** 详情（调用方先过 canSeeReport）。`withAudience` 只给所有者 / 管理员。 */
export async function getReportDetail(reportId: string, viewerId: string | null, canSeeIdentity: boolean, opts: { withAudience?: boolean } = {}): Promise<ZoneReportDetailView | null> {
  const r = await prisma.zoneReport.findUnique({
    where: { id: reportId },
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
    audience: opts.withAudience ? await loadAudience('report', r.id, canSeeIdentity) : [],
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
    /** 用户的补充要求（进每一步提示词）；override = 取代默认写作规范。 */
    instructions: z.string().trim().max(4000).default(''),
    instructionMode: z.enum(['append', 'override']).default('append'),
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

export const REPORT_RESERVED_SLUGS = ['new'] as const;

/** 独立分享页的 slug：标题 slug，全站唯一（退休的也不复用）。 */
export function pickReportSlug(title: string, exceptId?: string): Promise<string> {
  return freeTitleSlug({
    kind: 'report',
    title,
    fallback: 'report',
    reserved: REPORT_RESERVED_SLUGS,
    takenUnder: (base) =>
      prisma.zoneReport
        .findMany({ where: { slug: { startsWith: base }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { slug: true } })
        .then((rows) => rows.map((r) => r.slug).filter((x): x is string => !!x)),
  });
}

export async function createReport(creatorId: string, input: CreateReportInput): Promise<{ id: string }> {
  const keys = [input.sourceKey, input.manifestKey, input.importKey, input.bundleKey, ...input.assets.map((a) => a.key)].filter((k): k is string => !!k);
  if (new Set(keys).size !== keys.length) throw new ZoneError('attachments_invalid', 400);
  await assertOnDisk(keys);
  if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) throw new ZoneError('invalid_input', 400);
  const title = input.title || (input.subject ? `${input.subject} · ${{ daily: '日报', weekly: '周报', monthly: '月报', custom: '报告' }[input.kind]}` : '报告');
  const row = await createWithSlug(
    () => pickReportSlug(title),
    (slug) =>
      prisma.zoneReport.create({
    data: {
      slug,
      createdById: creatorId,
      kind: input.kind,
      title,
      subject: input.subject,
      instructions: input.instructions,
      instructionMode: input.instructionMode,
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
      }),
  );
  triggerZoneReport(row.id);
  return row;
}

// ── 可见范围（独立分享页；docs/contracts/audience.md）────────────────────────

export const reportSettingsInputSchema = z.object({
  title: z.string().trim().min(1).max(ZONE_LIMITS.postTitleMax).optional(),
  visibility: z.enum(['public', 'private', 'audience']).optional(),
  audienceUserIds: z.array(z.string().min(1).max(64)).max(200).optional(),
});
export type ReportSettingsInput = z.infer<typeof reportSettingsInputSchema>;

/** 改标题 / 可见范围 / 名单（所有者）。可见范围列与名单同一事务；事务后给新获准的人发通知（失败只记日志）。 */
export async function updateReportSettings(reportId: string, actorId: string, input: ReportSettingsInput): Promise<void> {
  const r = await prisma.zoneReport.findUnique({ where: { id: reportId }, select: { id: true, createdById: true, title: true, slug: true, visibility: true } });
  if (!r) throw new ZoneError('not_found', 404);
  // 报告没有草稿态：分享页随时可开（live 恒 true）。
  const before: AudienceState = { live: true, visibility: r.visibility as ContentVisibility, audience: await loadAudienceIds(r.id) };
  let slug = r.slug;
  if (input.title && input.title !== r.title) {
    try {
      slug = await pickReportSlug(input.title, r.id);
    } catch (e) {
      if (!isSlugConflict(e)) throw e;
    }
  }
  const after = await prisma.$transaction(async (tx) => {
    await tx.zoneReport.update({
      where: { id: r.id },
      data: {
        ...(input.title ? { title: input.title, slug } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
    });
    const ids = input.audienceUserIds !== undefined ? (await replaceAudience(tx, 'report', r.id, input.audienceUserIds, { ownerId: r.createdById, addedById: actorId })).userIds : before.audience;
    return { live: true, visibility: (input.visibility ?? before.visibility) as ContentVisibility, audience: ids } satisfies AudienceState;
  });
  const granted = newlyGrantedAudience(before, after);
  if (granted.length) {
    try {
      const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true, handle: true } });
      await notifyAudienceGranted({ recipientIds: granted, actorId, actorName: actor?.displayName?.trim() || actor?.handle || '', what: '报告', title: input.title ?? r.title, link: reportHref({ id: r.id, slug }) });
    } catch (e) {
      console.error('[report] audience notify failed', e);
    }
  }
}

/** 独立分享页的路径（标题 slug，老行没有 slug 时退回 id）。 */
export function reportHref(r: { id: string; slug: string | null }): string {
  return `/reports/${encodeURIComponent(r.slug ?? r.id)}`;
}

async function loadAudienceIds(reportId: string): Promise<string[]> {
  const rows = await prisma.contentAudience.findMany({ where: { kind: 'report', itemId: reportId }, select: { userId: true } });
  return rows.map((x) => x.userId);
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
  const r = await prisma.zoneReport.findUnique({
    where: { id: reportId },
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
  // 分享到哪个版块，报告就归到哪个版块（帖子页靠 post.report 原生渲染）。
  await prisma.zoneReport.update({ where: { id: r.id }, data: { postId: post.id, zoneId: zone.id } });
  return post;
}
