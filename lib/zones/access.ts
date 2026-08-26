// 技术专区 — server-side access resolution. Turns a session + a zone row into
// the pre-decided `ZoneAccess` policy object (lib/zones/permissions.ts) that
// every RSC / API boundary hands to client components. Nothing here decides
// policy itself: it only loads the viewer's membership (+role) and the zone's
// `member` system role and feeds `buildZoneAccess`.

import type { Prisma } from '@prisma/client';
import type { Session } from 'next-auth';
import { prisma } from '@/lib/db';
import { can, type PermissionHolder } from '@/lib/permissions';
import { ZONE_MEMBER_ROLE_KEY, buildZoneAccess, type ZoneAccess } from './permissions';

/**
 * Site-level half of a zone viewer: who is looking, whether they hold the SITE
 * permission `zones` (bypasses visibility and every zone permission) and —
 * orthogonally — whether they may see private users' full identity.
 */
export interface ZoneSiteViewer {
  id: string | null;
  siteAdmin: boolean;
  canSeeIdentity: boolean;
}

export function zoneSiteViewer(user: ({ id: string } & PermissionHolder) | null | undefined): ZoneSiteViewer {
  return {
    id: user?.id ?? null,
    siteAdmin: can(user, 'zones'),
    canSeeIdentity: can(user, 'identity'),
  };
}

export const ZONE_ACCESS_SELECT = {
  id: true,
  slug: true,
  name: true,
  ownerId: true,
  visibility: true,
  joinPolicy: true,
  allowGuestComments: true,
  deletedAt: true,
} satisfies Prisma.ZoneSelect;

export type ZoneAccessRow = Prisma.ZoneGetPayload<{ select: typeof ZONE_ACCESS_SELECT }>;

const ROLE_POLICY_SELECT = { key: true, name: true, permissions: true } satisfies Prisma.ZoneRoleSelect;

/** Loads the viewer's membership (+role) and the zone's `member` role → buildZoneAccess. */
export async function resolveZoneAccess(zone: ZoneAccessRow, viewer: ZoneSiteViewer): Promise<ZoneAccess> {
  const zoneInput = {
    id: zone.id,
    ownerId: zone.ownerId,
    visibility: zone.visibility,
    joinPolicy: zone.joinPolicy,
    allowGuestComments: zone.allowGuestComments,
    deletedAt: zone.deletedAt,
  };
  if (!viewer.id) {
    return buildZoneAccess({
      zone: zoneInput,
      viewerId: null,
      membership: null,
      memberRole: null,
      siteAdmin: viewer.siteAdmin,
      canSeeIdentity: viewer.canSeeIdentity,
    });
  }
  const [membership, memberRole] = await Promise.all([
    prisma.zoneMember.findUnique({
      where: { zoneId_userId: { zoneId: zone.id, userId: viewer.id } },
      select: { status: true, role: { select: ROLE_POLICY_SELECT } },
    }),
    prisma.zoneRole.findUnique({
      where: { zoneId_key: { zoneId: zone.id, key: ZONE_MEMBER_ROLE_KEY } },
      select: ROLE_POLICY_SELECT,
    }),
  ]);
  return buildZoneAccess({
    zone: zoneInput,
    viewerId: viewer.id,
    membership: membership ? { status: membership.status, role: membership.role } : null,
    memberRole,
    siteAdmin: viewer.siteAdmin,
    canSeeIdentity: viewer.canSeeIdentity,
  });
}

/** Deleted zones are invisible to everyone but site admins (they can 恢复). */
function visibleRow(row: ZoneAccessRow | null, viewer: ZoneSiteViewer): ZoneAccessRow | null {
  if (!row) return null;
  if (row.deletedAt && !viewer.siteAdmin) return null;
  return row;
}

export async function loadZoneBySlug(slug: string, viewer: ZoneSiteViewer): Promise<ZoneAccessRow | null> {
  const s = slug.trim().toLowerCase();
  if (!s) return null;
  const row = await prisma.zone.findUnique({ where: { slug: s }, select: ZONE_ACCESS_SELECT });
  return visibleRow(row, viewer);
}

export async function loadZoneById(id: string, viewer: ZoneSiteViewer): Promise<ZoneAccessRow | null> {
  if (!id) return null;
  const row = await prisma.zone.findUnique({ where: { id }, select: ZONE_ACCESS_SELECT });
  return visibleRow(row, viewer);
}

/** API convenience: null when the zone is missing (⇒ 404); otherwise the zone + access for the session. */
export async function zoneContext(
  slug: string,
  session: Session | null,
): Promise<{ zone: ZoneAccessRow; access: ZoneAccess; viewer: ZoneSiteViewer } | null> {
  const viewer = zoneSiteViewer(session?.user);
  const zone = await loadZoneBySlug(slug, viewer);
  if (!zone) return null;
  const access = await resolveZoneAccess(zone, viewer);
  return { zone, access, viewer };
}

/** `can(user,'zones')` OR the per-user `User.canCreateZones` flag (read from the row, never the JWT). */
export async function canUserCreateZone(user: { id: string } & PermissionHolder): Promise<boolean> {
  if (can(user, 'zones')) return true;
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { canCreateZones: true, isActive: true },
  });
  return !!row && row.isActive && row.canCreateZones;
}
