// 技术专区 — 帖子版本历史（docs/contracts/reports.md §4）。
// 快照由 updateZonePost 在内容变化时写入；这里只读 + 恢复（恢复 = 再保存一次，产生新快照）。

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { ZoneError } from './errors';
import { updateZonePost } from './post-queries';
import type { ZonePostRevisionView } from './types';

const REVISION_SELECT = {
  id: true,
  number: true,
  title: true,
  note: true,
  createdAt: true,
  editor: AUTHOR_IDENTITY_SELECT,
} satisfies Prisma.ZonePostRevisionSelect;

type RevisionRow = Prisma.ZonePostRevisionGetPayload<{ select: typeof REVISION_SELECT }> & { size?: number; bodyMd?: string; summary?: string };

function toView(r: RevisionRow, canSeeIdentity: boolean, size: number): ZonePostRevisionView {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    editor: toPublicAuthor(r.editor, canSeeIdentity),
    size,
  };
}

export async function listZonePostRevisions(postId: string, take = 100, canSeeIdentity = false): Promise<ZonePostRevisionView[]> {
  // 列表不拉正文；字数用 SQL 算，列表页只显示增减。
  const rows = await prisma.zonePostRevision.findMany({
    where: { postId },
    orderBy: [{ number: 'desc' }],
    take: Math.min(200, Math.max(1, Math.trunc(take) || 100)),
    select: { ...REVISION_SELECT, bodyMd: true },
  });
  return rows.map((r) => toView(r, canSeeIdentity, r.bodyMd.length));
}

export async function getZonePostRevision(postId: string, revisionId: string, canSeeIdentity = false): Promise<ZonePostRevisionView | null> {
  const row = await prisma.zonePostRevision.findFirst({ where: { id: revisionId, postId }, select: { ...REVISION_SELECT, bodyMd: true, summary: true } });
  if (!row) return null;
  return { ...toView(row, canSeeIdentity, row.bodyMd.length), bodyMd: row.bodyMd, summary: row.summary };
}

/** 恢复 = 以快照内容再保存一次（history is append-only）。 */
export async function restoreZonePostRevision(postId: string, revisionId: string, actorId: string, opts: { canModerate: boolean }): Promise<void> {
  const rev = await prisma.zonePostRevision.findFirst({ where: { id: revisionId, postId }, select: { number: true, title: true, summary: true, bodyMd: true } });
  if (!rev) throw new ZoneError('not_found', 404);
  await updateZonePost(postId, { title: rev.title, summary: rev.summary, bodyMd: rev.bodyMd }, { actorId, canModerate: opts.canModerate, revisionNote: `恢复自第 ${rev.number} 版` });
}
