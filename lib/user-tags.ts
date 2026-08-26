// 用户标签 — the badges on a 用户卡片.
//
// Two kinds, one table. `manual` tags are handed out in 管理后台 (singly or in
// bulk). `auto` tags describe what a member demonstrably IS — today: 版主 of a
// 专区 — and are reconciled from the source of truth rather than granted, so
// they appear and disappear on their own. Either kind can be hidden by the
// member: assignment stays, the card just stops showing it.

import { prisma } from '@/lib/db';

/** Palette tokens a tag may use — never raw CSS from the DB. */
export const TAG_COLORS = ['zinc', 'blue', 'green', 'amber', 'rose', 'violet'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(v: unknown): v is TagColor {
  return typeof v === 'string' && (TAG_COLORS as readonly string[]).includes(v);
}

/** Tailwind classes per token. Static strings — Tailwind must see them whole. */
export const TAG_COLOR_CLASS: Record<TagColor, string> = {
  zinc: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

export function tagColorClass(color: string): string {
  return TAG_COLOR_CLASS[isTagColor(color) ? color : 'zinc'];
}

/** The 版主 auto-tag. Created on demand so a fresh deploy needs no seed step. */
export const ZONE_MODERATOR_TAG_KEY = 'zone_moderator';

export interface PublicUserTag {
  key: string;
  name: string;
  color: string;
  kind: 'manual' | 'auto';
}

/**
 * Reconcile a member's AUTO tags against reality, then return every tag the
 * card should show (assigned, not hidden).
 *
 * Best-effort by design: the 专区 tables are a separate, evolving feature, so a
 * failure there must never take down a user card — it just means no 版主 badge
 * this time.
 */
export async function syncAndLoadUserTags(userId: string): Promise<PublicUserTag[]> {
  await syncZoneModeratorTag(userId).catch(() => undefined);
  const rows = await prisma.userTagAssignment.findMany({
    where: { userId, hidden: false },
    orderBy: [{ tag: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
    select: { tag: { select: { key: true, name: true, color: true, kind: true } } },
  });
  return rows.map((r) => r.tag);
}

/** Grant/revoke 版主 from actual zone role membership. */
async function syncZoneModeratorTag(userId: string): Promise<void> {
  const moderating = await prisma.zoneMember.count({
    where: {
      userId,
      status: 'active',
      // A named zone role that is not the plain member role = 管理身份.
      role: { is: { isSystem: true, key: { not: 'member' } } },
    },
  });
  const tag = await prisma.userTag.findUnique({
    where: { key: ZONE_MODERATOR_TAG_KEY },
    select: { id: true },
  });

  if (moderating === 0) {
    if (tag) {
      await prisma.userTagAssignment.deleteMany({ where: { userId, tagId: tag.id } });
    }
    return;
  }

  const tagId =
    tag?.id ??
    (
      await prisma.userTag.create({
        data: {
          key: ZONE_MODERATOR_TAG_KEY,
          name: '版主',
          description: '至少在一个专区担任管理角色，系统自动授予。',
          color: 'violet',
          kind: 'auto',
          sortOrder: 10,
        },
        select: { id: true },
      })
    ).id;
  await prisma.userTagAssignment
    .createMany({ data: [{ userId, tagId }], skipDuplicates: true })
    .catch(() => undefined);
}

/** Every tag assigned to a member, including hidden ones (own settings view). */
export async function loadOwnTags(userId: string) {
  await syncZoneModeratorTag(userId).catch(() => undefined);
  return prisma.userTagAssignment.findMany({
    where: { userId },
    orderBy: [{ tag: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
    select: {
      hidden: true,
      tag: { select: { key: true, name: true, description: true, color: true, kind: true } },
    },
  });
}
