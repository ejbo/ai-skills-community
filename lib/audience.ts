// 指定成员可见 — the DB half (docs/contracts/audience.md). Rules that need no DB are in
// lib/audience-shared.ts (client-safe); this module reads and writes ContentAudience.
//
// One polymorphic table for every surface: `kind` (AUDIENCE_KINDS) names the surface,
// `itemId` is that surface's row id. Nothing here decides who may READ an item — every
// surface keeps its own gate (lib/vote-queries.ts#canSeeVoteActivity for votes) and only
// asks this module "is this user on the list?" / "which items list this user?".
// Nothing here decides who may EDIT the list either: callers check ownership first.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_FIELDS, toPublicAuthor } from '@/lib/user-identity';
import { MAX_AUDIENCE, normalizeAudienceIds, type AudiencePick } from '@/lib/audience-shared';

/**
 * Every surface that stores an audience. Adding one = an entry here + a
 * `visibility ContentVisibility` column on its row + routing its own list/detail gate
 * (and its translation loader) through `isInAudience` / `audienceItemIds`.
 */
export const AUDIENCE_KINDS = ['vote'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

/** Is this user named on the item's list? (False for a signed-out viewer.) */
export async function isInAudience(kind: AudienceKind, itemId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const row = await prisma.contentAudience.findUnique({
    where: { kind_itemId_userId: { kind, itemId, userId } },
    select: { userId: true },
  });
  return row !== null;
}

/**
 * The ids of every item of this kind that lists the user — for list WHERE clauses:
 * `{ visibility: 'audience', id: { in: ids } }`. A member is on a handful of lists, so
 * this stays a tiny indexed read (`@@index([userId, kind])`).
 */
export async function audienceItemIds(kind: AudienceKind, userId: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await prisma.contentAudience.findMany({
    where: { kind, userId },
    select: { itemId: true },
    take: 5000,
  });
  return rows.map((r) => r.itemId);
}

/**
 * The list as the editor shows it: active users only, trimmed through `toPublicAuthor`
 * with the EDITING viewer's `identity` permission (the server boundary of the identity
 * contract — a private member's 部门/研究所 never reaches a viewer without `identity`).
 */
export async function loadAudience(
  kind: AudienceKind,
  itemId: string,
  canSeeIdentity: boolean,
): Promise<AudiencePick[]> {
  const rows = await prisma.contentAudience.findMany({
    where: { kind, itemId, user: { isActive: true } },
    orderBy: { createdAt: 'asc' },
    take: MAX_AUDIENCE,
    select: { userId: true, user: { select: AUTHOR_IDENTITY_FIELDS } },
  });
  return rows.map((r) => ({ userId: r.userId, user: toPublicAuthor(r.user, canSeeIdentity) }));
}

/** The raw user ids on the list (inactive accounts included — they are just inert). */
export async function audienceUserIds(
  db: Prisma.TransactionClient | typeof prisma,
  kind: AudienceKind,
  itemId: string,
): Promise<string[]> {
  const rows = await db.contentAudience.findMany({ where: { kind, itemId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/**
 * Replace the whole list (the editor always sends the full list). Normalizes first —
 * dedupe, drop the owner (implicit), cap at MAX_AUDIENCE — and keeps only ids of ACTIVE
 * users, so a forged id simply does not land. Call inside the surface's own transaction
 * so the visibility column and the list move together.
 *
 * @returns the final list and which ids were newly added by this call.
 */
export async function replaceAudience(
  tx: Prisma.TransactionClient,
  kind: AudienceKind,
  itemId: string,
  requested: readonly string[],
  opts: { ownerId: string; addedById: string },
): Promise<{ userIds: string[]; added: string[] }> {
  const wanted = normalizeAudienceIds(requested, opts.ownerId);
  const valid = wanted.length
    ? new Set(
        (
          await tx.user.findMany({
            where: { id: { in: wanted }, isActive: true },
            select: { id: true },
          })
        ).map((u) => u.id),
      )
    : new Set<string>();
  const next = wanted.filter((id) => valid.has(id));
  const nextSet = new Set(next);
  const current = new Set(await audienceUserIds(tx, kind, itemId));

  const toRemove = [...current].filter((id) => !nextSet.has(id));
  const added = next.filter((id) => !current.has(id));
  if (toRemove.length) {
    await tx.contentAudience.deleteMany({ where: { kind, itemId, userId: { in: toRemove } } });
  }
  if (added.length) {
    await tx.contentAudience.createMany({
      data: added.map((userId) => ({ kind, itemId, userId, addedById: opts.addedById })),
      skipDuplicates: true,
    });
  }
  return { userIds: next, added };
}
