// 知识库封面图片库（docs/contracts/library.md「封面图片库」）。
//
// owner 2026-10-21：抓来的封面「非常丑」或者根本没有——希望有一个图片库，随机把合适的图贴上去。
// 规则：管理员在 /manage/library 上传一批图（png / jpg / webp / gif，≤ 5 MB）；文档收录完成后没有封面
// → `assignPoolCoverIfMissing` 按文档 id 的哈希稳定地挑一张（同一篇每次都是同一张，刷新不跳）；
// 配的封面记 `coverFromPool = true`，以后重新处理抓到真封面时允许覆盖。管理页有「给没有封面的文档配图」一键补齐。

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { deleteLibraryFile, libraryPublicUrl, newLibraryKey, saveLibraryBuffer } from './storage';

export const COVER_POOL_MAX_BYTES = 5 * 1024 * 1024;

/** 只认真图：魔数判断，不信 mime / 扩展名。 */
export function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | 'gif' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  return null;
}

export interface CoverPoolImage {
  id: string;
  key: string;
  url: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
}

export async function listCoverPool(): Promise<CoverPoolImage[]> {
  const rows = await prisma.libraryCoverPoolImage.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({ id: r.id, key: r.key, url: libraryPublicUrl(r.key), name: r.name, sizeBytes: r.sizeBytes, createdAt: r.createdAt.toISOString() }));
}

export async function addCoverPoolImage(buf: Buffer, name: string, createdById: string): Promise<CoverPoolImage | { error: 'not_image' | 'too_large' }> {
  if (buf.length > COVER_POOL_MAX_BYTES) return { error: 'too_large' };
  const ext = sniffImage(buf);
  if (!ext) return { error: 'not_image' };
  const key = newLibraryKey('cover', ext);
  await saveLibraryBuffer(key, buf);
  const row = await prisma.libraryCoverPoolImage.create({ data: { key, name: name.slice(0, 200), sizeBytes: buf.length, createdById } });
  return { id: row.id, key: row.key, url: libraryPublicUrl(row.key), name: row.name, sizeBytes: row.sizeBytes, createdAt: row.createdAt.toISOString() };
}

/** 删掉图片库里的一张；已经配给文档的封面不动（文件保留一份引用计数太重——配出去的 coverUrl 指向同一个 key，所以只删行不删文件）。 */
export async function removeCoverPoolImage(id: string): Promise<boolean> {
  const row = await prisma.libraryCoverPoolImage.findUnique({ where: { id } });
  if (!row) return false;
  await prisma.libraryCoverPoolImage.delete({ where: { id } });
  const url = libraryPublicUrl(row.key);
  const inUse = await prisma.libraryDoc.count({ where: { coverUrl: url } });
  if (!inUse) await deleteLibraryFile(row.key).catch(() => {});
  return true;
}

/** 稳定的随机：同一个 seed 永远挑到同一张（图片库不变的前提下）。 */
export function pickFromPool<T>(pool: readonly T[], seed: string): T | null {
  if (!pool.length) return null;
  const h = createHash('sha1').update(seed).digest();
  return pool[h.readUInt32BE(0) % pool.length];
}

/** 文档没有封面 → 从图片库配一张。返回是否配了。best-effort，从不抛。 */
export async function assignPoolCoverIfMissing(docId: string): Promise<boolean> {
  try {
    const doc = await prisma.libraryDoc.findUnique({ where: { id: docId }, select: { coverUrl: true } });
    if (!doc || doc.coverUrl) return false;
    const pool = await prisma.libraryCoverPoolImage.findMany({ select: { key: true }, orderBy: { createdAt: 'asc' } });
    const pick = pickFromPool(pool, docId);
    if (!pick) return false;
    await prisma.libraryDoc.update({ where: { id: docId }, data: { coverUrl: libraryPublicUrl(pick.key), coverFromPool: true } });
    return true;
  } catch (e) {
    console.error('[library] pool cover failed', e);
    return false;
  }
}

/** 管理页一键：给所有没有封面的文档配图。 */
export async function backfillPoolCovers(limit = 2000): Promise<number> {
  const pool = await prisma.libraryCoverPoolImage.findMany({ select: { key: true }, orderBy: { createdAt: 'asc' } });
  if (!pool.length) return 0;
  const docs = await prisma.libraryDoc.findMany({ where: { coverUrl: null, deletedAt: null }, select: { id: true }, take: limit });
  let n = 0;
  for (const d of docs) {
    const pick = pickFromPool(pool, d.id)!;
    await prisma.libraryDoc.update({ where: { id: d.id }, data: { coverUrl: libraryPublicUrl(pick.key), coverFromPool: true } });
    n++;
  }
  return n;
}
