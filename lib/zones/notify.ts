// 技术专区 notification helpers — who gets told about what inside a zone.
// The notification writers themselves live in lib/notifications.ts
// (notifyZoneReply / notifyZoneMember / notifyZoneJoinRequest); this module
// only resolves recipients and offers thin conveniences. Best-effort like the
// rest of the notification stack: never let a failure here break the write
// that triggered it.

import { prisma } from '@/lib/db';
import { notifyZoneJoinRequest } from '@/lib/notifications';

/** Owner + every active member whose role carries the `members` permission. */
export async function managerIdsFor(zoneId: string): Promise<string[]> {
  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: {
      ownerId: true,
      members: {
        where: { status: 'active', role: { is: { permissions: { has: 'members' } } } },
        select: { userId: true },
      },
    },
  });
  if (!zone) return [];
  return [...new Set([zone.ownerId, ...zone.members.map((m) => m.userId)])];
}

/** Owner + every active member whose role carries `moderate` (for 公告 / report fan-outs). */
export async function moderatorIdsFor(zoneId: string): Promise<string[]> {
  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: {
      ownerId: true,
      members: {
        where: { status: 'active', role: { is: { permissions: { has: 'moderate' } } } },
        select: { userId: true },
      },
    },
  });
  if (!zone) return [];
  return [...new Set([zone.ownerId, ...zone.members.map((m) => m.userId)])];
}

/** Convenience for the join route: resolve managers, then fan out one zone_request each. */
export async function notifyManagersOfJoinRequest(opts: {
  zoneId: string;
  zoneSlug: string;
  zoneName: string;
  actorId: string;
  actorName: string;
  message: string;
}): Promise<void> {
  try {
    const recipientIds = await managerIdsFor(opts.zoneId);
    await notifyZoneJoinRequest({
      recipientIds,
      actorId: opts.actorId,
      actorName: opts.actorName,
      zoneSlug: opts.zoneSlug,
      zoneName: opts.zoneName,
      message: opts.message,
    });
  } catch (e) {
    console.error('[notify] zone join request fan-out failed:', e);
  }
}
