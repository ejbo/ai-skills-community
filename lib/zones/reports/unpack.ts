// 版块报告 — 把一次上传的文件夹 / zip（bundleKey）解包成流水线认识的东西（docs/contracts/reports.md §2a）。
//
// 规则在 bundle.ts（和向导共用）；这里只负责：读 zip → 按规则落盘成 zone media → 建 ZoneReportAsset
// → 回写 sourceKey / manifestKey / importKey / namesJson。可重入：中途崩了再跑一次，同名附件不会重复建。
// zip 里的路径从不用于磁盘路径（key 永远是 nanoid），所以不存在 zip-slip。

import fsp from 'node:fs/promises';
import JSZip from 'jszip';
import { prisma } from '@/lib/db';
import { MAX_ZONE_FILE_BYTES, MAX_ZONE_IMAGE_BYTES } from '@/lib/zones/shared';
import { newZoneMediaKey, saveZoneMediaBuffer, zoneMediaAbsPath, zoneMediaExtFor } from '@/lib/zones/storage';
import { bundleBasename, bundleHasChat, HEAD_BYTES, isTextLike, MAX_SNIFF_BYTES, mergeWelinkPages, namesFromBundle, planReportBundle, type BundleFile } from './bundle';

/** 一个 zip 最多处理这么多条目 / 这么多附件（和 createReport 的上限一致）。 */
export const MAX_BUNDLE_ENTRIES = 3000;
export const MAX_BUNDLE_ASSETS = 300;

interface ZipFile extends BundleFile {
  entry: JSZip.JSZipObject;
}

function textOf(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}

export interface UnpackResult {
  sourceKey: string | null;
  sourceName: string | null;
  manifestKey: string | null;
  importKey: string | null;
  names: Record<string, string>;
  /** 本次新建的附件（name → key）。 */
  assets: { key: string; name: string; kind: 'image' | 'file'; sizeBytes: number }[];
  skipped: string[];
}

export async function unpackReportBundle(reportId: string, bundleKey: string, note: (line: string) => void): Promise<UnpackResult> {
  const abs = zoneMediaAbsPath(bundleKey);
  if (!abs) throw new Error('上传的压缩包路径无效');
  const zip = await JSZip.loadAsync(await fsp.readFile(abs));
  const files: ZipFile[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (files.length >= MAX_BUNDLE_ENTRIES) throw new Error(`压缩包条目超过 ${MAX_BUNDLE_ENTRIES} 个`);
    // JSZip 不公开未压缩大小；分类只用它挑最大的 TXT，内部字段够用，取不到就当 1。
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 1;
    // 文本类读开头几 KB 按内容识别（bundle.ts sniffText）——文件名随便叫。
    let head: string | undefined;
    if (isTextLike(path) && size <= MAX_SNIFF_BYTES) {
      const buf = await entry.async('nodebuffer');
      head = textOf(buf.subarray(0, HEAD_BYTES));
    }
    files.push({ path, size, head, entry });
  }
  const plan = planReportBundle(files);
  if (!bundleHasChat(plan)) {
    const seen = files.filter((f) => isTextLike(f.path)).slice(0, 8).map((f) => bundleBasename(f.path)).join('、');
    throw new Error(`压缩包里没有认出聊天记录：要么是 welink-cli 的 JSON（消息对象带 msgId / serverSendTime），要么是 TXT（每条以 "[YYYY-MM-DD HH:mm:ss] 姓名（账号）" 开头，或 "#### 日期 ####" 日头 + "[HH:mm:ss] 姓名（账号）"）。看到的文本文件：${seen || '无'}`);
  }

  const result: UnpackResult = { sourceKey: null, sourceName: null, manifestKey: null, importKey: null, names: {}, assets: [], skipped: [] };
  const read = (f: ZipFile) => f.entry.async('nodebuffer');

  if (plan.importJson) {
    const key = newZoneMediaKey('file', 'json');
    await saveZoneMediaBuffer(key, await read(plan.importJson), MAX_ZONE_FILE_BYTES);
    result.importKey = key;
    note(`解包：report.json（导入模式）`);
  } else if (plan.sources.length && plan.sources[0].kind === 'welink_json') {
    // 所有 welink JSON（页 / 合并数组）一起合并、按 msgId 去重
    const texts: string[] = [];
    for (const s of plan.sources) texts.push(textOf(await read(s.file)));
    const merged = mergeWelinkPages(texts);
    const count = (JSON.parse(merged) as unknown[]).length;
    if (!count) throw new Error(`welink JSON 里没有消息（${plan.sources.map((s) => bundleBasename(s.file.path)).slice(0, 5).join('、')}）`);
    const key = newZoneMediaKey('file', 'json');
    await saveZoneMediaBuffer(key, Buffer.from(merged, 'utf8'), MAX_ZONE_FILE_BYTES);
    result.sourceKey = key;
    result.sourceName = plan.sources.length === 1 ? bundleBasename(plan.sources[0].file.path).slice(0, 200) : `${plan.sources.length} 份 welink-cli JSON（合并 ${count} 条）`;
    note(`解包：合并 ${plan.sources.length} 份 welink-cli JSON → ${count} 条消息`);
  } else if (plan.sources.length) {
    const src = plan.sources[0].file;
    const name = bundleBasename(src.path);
    const key = newZoneMediaKey('file', 'txt');
    await saveZoneMediaBuffer(key, await read(src), MAX_ZONE_FILE_BYTES);
    result.sourceKey = key;
    result.sourceName = name.slice(0, 200);
    note(`解包：聊天记录 ${name}`);
  }

  if (plan.manifest) {
    const key = newZoneMediaKey('file', 'csv');
    await saveZoneMediaBuffer(key, await read(plan.manifest), MAX_ZONE_FILE_BYTES);
    result.manifestKey = key;
    note(`解包：附件清单 ${bundleBasename(plan.manifest.path)}`);
  }

  if (plan.names.length) {
    const entries: { path: string; text: string }[] = [];
    for (const f of plan.names) entries.push({ path: f.path, text: textOf(await read(f)) });
    result.names = namesFromBundle(entries);
    note(`解包：姓名表 ${Object.keys(result.names).length} 人`);
  }

  // 附件：同名的只建一次（重试时不重复）
  const existing = new Set((await prisma.zoneReportAsset.findMany({ where: { reportId }, select: { name: true } })).map((a) => a.name));
  let count = existing.size;
  for (const { file, kind } of plan.assets) {
    const name = bundleBasename(file.path).slice(0, 200);
    if (existing.has(name)) continue;
    if (count >= MAX_BUNDLE_ASSETS) {
      result.skipped.push(`${name}（附件超过 ${MAX_BUNDLE_ASSETS} 个）`);
      continue;
    }
    const buf = await read(file);
    const max = kind === 'image' ? MAX_ZONE_IMAGE_BYTES : MAX_ZONE_FILE_BYTES;
    if (buf.length === 0 || buf.length > max) {
      result.skipped.push(`${name}（${buf.length === 0 ? '空文件' : '超过大小上限'}）`);
      continue;
    }
    const key = newZoneMediaKey(kind, zoneMediaExtFor(kind, '', name));
    await saveZoneMediaBuffer(key, buf, max);
    await prisma.zoneReportAsset.create({ data: { reportId, key, name, kind, mimeType: '', sizeBytes: buf.length } });
    existing.add(name);
    count++;
    result.assets.push({ key, name, kind, sizeBytes: buf.length });
  }
  for (const f of plan.ignored) if (f.reason !== 'system') result.skipped.push(`${bundleBasename(f.file.path)}（${f.reason}）`);
  note(`解包：附件 ${result.assets.length} 个${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}`);

  await prisma.zoneReport.update({
    where: { id: reportId },
    data: {
      sourceKey: result.sourceKey,
      sourceName: result.sourceName,
      manifestKey: result.manifestKey,
      importKey: result.importKey,
      namesJson: Object.keys(result.names).length ? result.names : undefined,
    },
  });
  return result;
}
