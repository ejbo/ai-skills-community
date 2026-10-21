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
import { bundleBasename, bundleHasChat, HEAD_BYTES, isTextLike, MAX_SNIFF_BYTES, namesFromBundle, planReportBundle, type BundleFile } from './bundle';
import { parseRawMessages, type RawMessage } from './parse';

/** 一个 zip 最多处理这么多条目 / 这么多附件（和 createReport 的上限一致）。 */
export const MAX_BUNDLE_ENTRIES = 3000;
export const MAX_BUNDLE_ASSETS = 300;
/** 最多真解析这么多个聊天记录候选 / 单个候选最大字节数（guess 候选可能是任何文本）。 */
const MAX_SOURCE_TRIES = 24;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

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
    const seen = files.filter((f) => !f.path.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX')).slice(0, 12).map((f) => bundleBasename(f.path)).join('、');
    throw new Error(`上传的文件夹里没有任何文本文件可以当聊天记录（json / txt / csv / log / md 一个都没有）。看到的文件：${seen || '无'}`);
  }

  const result: UnpackResult = { sourceKey: null, sourceName: null, manifestKey: null, importKey: null, names: {}, assets: [], skipped: [] };
  const read = (f: ZipFile) => f.entry.async('nodebuffer');
  const usedAsSource = new Set<string>();

  if (plan.importJson) {
    const key = newZoneMediaKey('file', 'json');
    await saveZoneMediaBuffer(key, await read(plan.importJson), MAX_ZONE_FILE_BYTES);
    result.importKey = key;
    note(`解包：report.json（导入模式）`);
  } else {
    // 候选逐个真解析（不看名字、不看开头像不像）：JSON 候选解析出来的合并去重（welink-cli 是分页的），
    // TXT / CSV 各自独立；最后谁消息多用谁——JSON 字段更全，不少于最佳的 80% 就优先 JSON。
    // 一个都解析不出时，也不在这里报错：把最大的文本候选存成 source，交给流水线让模型推断格式（pipeline.ts）。
    const jsonRaw = new Map<string, RawMessage>();
    const jsonFiles: string[] = [];
    let bestText: { file: ZipFile; count: number; buf: Buffer } | null = null;
    let largest: { file: ZipFile; buf: Buffer } | null = null;
    const tried: string[] = [];
    for (const s of plan.sources.slice(0, MAX_SOURCE_TRIES)) {
      const name = bundleBasename(s.file.path);
      const buf = await read(s.file);
      if (buf.length === 0 || buf.length > MAX_SOURCE_BYTES) {
        tried.push(`${name}（${buf.length === 0 ? '空' : '太大'}）`);
        continue;
      }
      // 兜底候选：非 JSON 的文本优先（模型推断行头格式只对文本有意义），同类里取最大的
      const rank = (p: string) => (p.toLowerCase().endsWith('.json') ? 0 : 1);
      if (!largest || rank(s.file.path) > rank(largest.file.path) || (rank(s.file.path) === rank(largest.file.path) && buf.length > largest.buf.length)) largest = { file: s.file, buf };
      let raw: RawMessage[] = [];
      let kind = '';
      try {
        const r = parseRawMessages(textOf(buf));
        raw = r.raw.filter((m) => Number.isFinite(m.ts));
        kind = r.kind;
      } catch {
        raw = [];
      }
      if (!raw.length) {
        tried.push(`${name}（0 条）`);
        continue;
      }
      tried.push(`${name}（${raw.length} 条）`);
      if (kind === 'welink-cli-json') {
        for (const m of raw) {
          const key = m.msgId ?? `${m.ts}:${m.account}:${m.content.slice(0, 40)}`;
          if (!jsonRaw.has(key)) jsonRaw.set(key, m);
        }
        jsonFiles.push(s.file.path);
      } else if (!bestText || raw.length > bestText.count) {
        bestText = { file: s.file, count: raw.length, buf };
      }
    }
    if (jsonRaw.size && (!bestText || jsonRaw.size >= bestText.count * 0.8)) {
      const merged = [...jsonRaw.values()].sort((a, b) => a.ts - b.ts);
      const key = newZoneMediaKey('file', 'json');
      await saveZoneMediaBuffer(key, Buffer.from(JSON.stringify(merged), 'utf8'), MAX_ZONE_FILE_BYTES);
      result.sourceKey = key;
      result.sourceName = (jsonFiles.length === 1 ? bundleBasename(jsonFiles[0]) : `${jsonFiles.length} 份 JSON（合并 ${merged.length} 条）`).slice(0, 200);
      for (const p of jsonFiles) usedAsSource.add(p);
      note(`解包：聊天记录 ← ${jsonFiles.map((p) => bundleBasename(p)).slice(0, 4).join('、')}${jsonFiles.length > 4 ? '…' : ''} → ${merged.length} 条消息`);
    } else if (bestText) {
      const name = bundleBasename(bestText.file.path);
      const key = newZoneMediaKey('file', /\.csv$/i.test(name) ? 'csv' : 'txt');
      await saveZoneMediaBuffer(key, bestText.buf, MAX_ZONE_FILE_BYTES);
      result.sourceKey = key;
      result.sourceName = name.slice(0, 200);
      usedAsSource.add(bestText.file.path);
      note(`解包：聊天记录 ← ${name} → ${bestText.count} 条消息`);
    } else if (largest) {
      const name = bundleBasename(largest.file.path);
      const key = newZoneMediaKey('file', /\.(json|csv)$/i.exec(name)?.[1].toLowerCase() ?? 'txt');
      await saveZoneMediaBuffer(key, largest.buf, MAX_ZONE_FILE_BYTES);
      result.sourceKey = key;
      result.sourceName = name.slice(0, 200);
      usedAsSource.add(largest.file.path);
      note(`解包：没有解析器直接认出聊天记录（试过 ${tried.slice(0, 8).join('、')}），先用 ${name}，交给模型推断格式`);
    } else {
      throw new Error(`聊天记录候选都读不了：${tried.slice(0, 8).join('、') || '无'}`);
    }
    if (tried.length > 1) note(`解包：候选解析结果 ${tried.slice(0, 10).join('、')}${tried.length > 10 ? '…' : ''}`);
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
    if (usedAsSource.has(file.path)) continue; // 被当成聊天记录的文本不再当附件
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
