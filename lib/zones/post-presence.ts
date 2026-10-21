// 技术专区 — 谁正在编辑这篇帖子（docs/contracts/reports.md §4）。
// 心跳表，不是锁：编辑器每 20 s PUT 一次，60 s 没心跳就不算在线；离开时 DELETE。
// PUT 顺手清掉本帖 10 分钟没心跳的行，不做定时任务。

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import type { ZonePostEditorView } from './types';

export const PRESENCE_ACTIVE_MS = 60 * 1000;
export const PRESENCE_HEARTBEAT_MS = 20 * 1000;
const PRESENCE_SWEEP_MS = 10 * 60 * 1000;

const EDITOR_SELECT = { startedAt: true, lastSeenAt: true, user: AUTHOR_IDENTITY_SELECT } satisfies Prisma.ZonePostEditorSelect;

export async function listActiveEditors(postId: string, excludeUserId: string | null, canSeeIdentity: boolean, now = new Date()): Promise<ZonePostEditorView[]> {
  const rows = await prisma.zonePostEditor.findMany({
    where: { postId, lastSeenAt: { gte: new Date(now.getTime() - PRESENCE_ACTIVE_MS) }, ...(excludeUserId ? { userId: { not: excludeUserId } } : {}) },
    orderBy: { startedAt: 'asc' },
    take: 20,
    select: EDITOR_SELECT,
  });
  return rows.map((r) => ({ user: toPublicAuthor(r.user, canSeeIdentity), startedAt: r.startedAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString() }));
}

/** 心跳：upsert 自己，返回其他在线编辑者。 */
export async function heartbeatEditor(postId: string, userId: string, canSeeIdentity: boolean): Promise<ZonePostEditorView[]> {
  const now = new Date();
  await prisma.$transaction([
    prisma.zonePostEditor.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, startedAt: now, lastSeenAt: now },
      update: { lastSeenAt: now },
    }),
    prisma.zonePostEditor.deleteMany({ where: { postId, lastSeenAt: { lt: new Date(now.getTime() - PRESENCE_SWEEP_MS) } } }),
  ]);
  return listActiveEditors(postId, userId, canSeeIdentity, now);
}

export async function leaveEditor(postId: string, userId: string): Promise<void> {
  await prisma.zonePostEditor.deleteMany({ where: { postId, userId } });
}
