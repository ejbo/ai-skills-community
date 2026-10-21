// 版块报告 — 附件 → 知识库收录（**按需**，不再自动）；版块的「资料」视角（docs/contracts/reports.md §2、§5）。
//
// owner 2026-10-21：「不要把月报里的内容直接转到知识库里……会变得很乱」。所以附件留在报告里（ZoneReportAsset，
// 报告页 / 帖子页里直接在预览面板打开），只有所有者点「分享到知识库」才走 ingestOneReportAsset：
// 复制一份进知识库存储目录后走 createDocFromFile（去重、章节提取、AI 导读全部复用）；asset.libraryDocId 记下结果，
// 正文里用 `[embed:library:<slug>]` 引用。ingestReportAssets（整批）只剩给脚本 / 将来的「全部分享」用。

import fsp from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { createDocFromFile, IngestError } from '@/lib/library/ingest';
import { detectLibraryFormat, newLibraryKey, saveLibraryBuffer } from '@/lib/library/storage';
import { BROWSABLE_DOC_WHERE, DOC_CARD_SELECT } from '@/lib/library-queries';
import { zoneMediaAbsPath } from '@/lib/zones/storage';

export interface IngestedAsset {
  assetId: string;
  name: string;
  docId: string;
  slug: string;
  existing: boolean;
}

/** 文件名能被知识库收录吗（格式判断，不读文件）。 */
export function isLibraryIngestible(name: string, mimeType: string): boolean {
  return detectLibraryFormat(mimeType, name) !== null;
}

/**
 * 把报告的可收录附件送进知识库（best-effort：单个失败只记日志，不抛）。
 * 已收录过的（libraryDocId 非空）跳过；知识库按内容哈希去重，所以重复上传同一份 PDF 只会复用。
 */
export async function ingestReportAssets(reportId: string, uploaderId: string, log: (line: string) => void = () => {}): Promise<IngestedAsset[]> {
  const assets = await prisma.zoneReportAsset.findMany({
    where: { reportId, libraryDocId: null },
    select: { id: true, key: true, name: true, mimeType: true, sizeBytes: true },
  });
  const out: IngestedAsset[] = [];
  for (const a of assets) {
    const format = detectLibraryFormat(a.mimeType, a.name);
    if (!format) continue;
    const src = zoneMediaAbsPath(a.key);
    if (!src) continue;
    try {
      const buf = await fsp.readFile(src);
      const key = newLibraryKey('original', path.extname(a.name).slice(1) || format);
      await saveLibraryBuffer(key, buf);
      const res = await createDocFromFile({
        fileKey: key,
        format,
        filename: a.name,
        mimeType: a.mimeType || mimeFor(format),
        sizeBytes: a.sizeBytes || buf.length,
        uploaderId,
        docType: 'auto',
      });
      await prisma.zoneReportAsset.update({ where: { id: a.id }, data: { libraryDocId: res.id } });
      out.push({ assetId: a.id, name: a.name, docId: res.id, slug: res.slug, existing: res.existing });
      log(`收录 ${a.name} → 知识库 ${res.slug}${res.existing ? '（已存在，复用）' : ''}`);
    } catch (e) {
      const msg = e instanceof IngestError ? `${e.code}: ${e.message}` : (e as Error).message;
      log(`收录 ${a.name} 失败：${msg}`);
    }
  }
  return out;
}

/** 按需把一个附件送进知识库（所有者点「分享到知识库」）。已收录的直接返回现有文档。 */
export async function ingestOneReportAsset(assetId: string, uploaderId: string): Promise<{ ok: true; docId: string; slug: string; existing: boolean } | { ok: false; reason: 'not_found' | 'unsupported' | 'failed'; message?: string }> {
  const a = await prisma.zoneReportAsset.findUnique({ where: { id: assetId }, select: { id: true, key: true, name: true, mimeType: true, sizeBytes: true, libraryDocId: true } });
  if (!a) return { ok: false, reason: 'not_found' };
  if (a.libraryDocId) {
    const doc = await prisma.libraryDoc.findUnique({ where: { id: a.libraryDocId }, select: { id: true, slug: true, deletedAt: true } });
    if (doc && !doc.deletedAt) return { ok: true, docId: doc.id, slug: doc.slug, existing: true };
  }
  const format = detectLibraryFormat(a.mimeType, a.name);
  if (!format) return { ok: false, reason: 'unsupported' };
  const src = zoneMediaAbsPath(a.key);
  if (!src) return { ok: false, reason: 'not_found' };
  try {
    const buf = await fsp.readFile(src);
    const key = newLibraryKey('original', path.extname(a.name).slice(1) || format);
    await saveLibraryBuffer(key, buf);
    const res = await createDocFromFile({ fileKey: key, format, filename: a.name, mimeType: a.mimeType || mimeFor(format), sizeBytes: a.sizeBytes || buf.length, uploaderId, docType: 'auto' });
    await prisma.zoneReportAsset.update({ where: { id: a.id }, data: { libraryDocId: res.id } });
    return { ok: true, docId: res.id, slug: res.slug, existing: res.existing };
  } catch (e) {
    const message = e instanceof IngestError ? `${e.code}: ${e.message}` : (e as Error).message;
    return { ok: false, reason: 'failed', message };
  }
}

function mimeFor(format: string): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'epub':
      return 'application/epub+zip';
    case 'html':
      return 'text/html';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/octet-stream';
  }
}

/** 文件名 → 知识库 slug（render-md 用）。只含当前可浏览的文档。 */
export async function librarySlugsForReport(reportId: string): Promise<Map<string, string>> {
  const rows = await prisma.zoneReportAsset.findMany({
    where: { reportId, libraryDocId: { not: null } },
    select: { name: true, libraryDocId: true },
  });
  const ids = rows.map((r) => r.libraryDocId!).filter(Boolean);
  if (!ids.length) return new Map();
  const docs = await prisma.libraryDoc.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, slug: true } });
  const slugById = new Map(docs.map((d) => [d.id, d.slug]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const slug = r.libraryDocId ? slugById.get(r.libraryDocId) : undefined;
    if (slug) out.set(r.name, slug);
  }
  return out;
}

export type ZoneLibraryDocCard = { id: string; slug: string; title: string; summary: string | null; format: string; createdAt: Date; reportId: string; reportTitle: string };

/**
 * 版块的「资料」：本版块所有报告收录进知识库的文档，按收录时间倒序。
 * 只列公开可浏览的（BROWSABLE_DOC_WHERE）——受限文档走它自己的申请流程。
 */
export async function listZoneLibraryDocs(zoneId: string, take = 50): Promise<ZoneLibraryDocCard[]> {
  const assets = await prisma.zoneReportAsset.findMany({
    where: { libraryDocId: { not: null }, report: { zoneId } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, take * 2),
    select: { libraryDocId: true, createdAt: true, report: { select: { id: true, title: true } } },
  });
  const ids = [...new Set(assets.map((a) => a.libraryDocId!))];
  if (!ids.length) return [];
  const docs = await prisma.libraryDoc.findMany({
    where: { ...BROWSABLE_DOC_WHERE, id: { in: ids } },
    select: DOC_CARD_SELECT,
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const out: ZoneLibraryDocCard[] = [];
  for (const a of assets) {
    const d = byId.get(a.libraryDocId!);
    if (!d || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({ id: d.id, slug: d.slug, title: d.title, summary: d.summary ?? null, format: d.format, createdAt: a.createdAt, reportId: a.report.id, reportTitle: a.report.title });
    if (out.length >= take) break;
  }
  return out;
}
