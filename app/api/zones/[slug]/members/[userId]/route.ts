import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { notifyZoneMember } from '@/lib/notifications';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { ZONE_MEMBER_ROLE_KEY, canAssignZoneRole, type ZoneAccess } from '@/lib/zones/permissions';
import { zoneContext } from '@/lib/zones/access';
import {
  leaveZone,
  listZoneRoles,
  removeZoneMember,
  reviewJoinRequest,
  updateZoneMember,
  zoneMemberRolePermissions,
} from '@/lib/zones/queries';
import {
  MINUTE_MS,
  actingAsSiteAdmin,
  auditIp,
  invalidInput,
  zoneErrorResponse,
  zoneFail,
} from '../../../_zone-api';

export const dynamic = 'force-dynamic';

const MEMBER_WRITES_PER_MINUTE = 60;

const patchSchema = z
  .object({
    roleId: z.string().trim().min(1).max(64).nullable().optional(),
    title: z.string().trim().max(ZONE_LIMITS.memberTitleMax).optional(),
    status: z.enum(['active', 'rejected']).optional(),
  })
  .refine((v) => v.roleId !== undefined || v.title !== undefined || v.status !== undefined);

type Params = { params: { slug: string; userId: string } };

/**
 * A members-manager without `roles` must not be able to touch a member whose
 * CURRENT role carries `roles` (demoting / removing the role admin is the same
 * escalation canAssignZoneRole blocks on assignment). Returns the reason code
 * or null when the target is editable by this actor.
 */
async function guardCurrentRole(zoneId: string, userId: string, access: ZoneAccess): Promise<string | null> {
  if (access.canManageRoles) return null;
  const current = await zoneMemberRolePermissions(zoneId, userId);
  if (current.includes('roles')) return 'role_not_assignable';
  return null;
}

// PATCH /api/zones/[slug]/members/[userId] { roleId?, title?, status? } → { ok }.
// status: review a pending request (active = 通过, rejected = 驳回).
// roleId/title: `members` (+ canAssignZoneRole for the target role). The owner
// row is untouchable from here (转让 is the only way to change it).
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canManageMembers) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`zones:member-write:${session.user.id}`, MEMBER_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_member', 429, { resetAt: gate.resetAt });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput();
  const { roleId, title, status } = parsed.data;
  const userId = params.userId;

  if (userId === zone.ownerId) return zoneFail('owner_row', 403);

  const guarded = await guardCurrentRole(zone.id, userId, access);
  if (guarded) return zoneFail(guarded, 403);

  // Resolve the target role before any write so a bad payload changes nothing.
  let roleName: string | null = null;
  if (roleId !== undefined) {
    const roles = await listZoneRoles(zone.id);
    if (roleId === null) {
      roleName = roles.find((r) => r.key === ZONE_MEMBER_ROLE_KEY)?.name ?? null;
    } else {
      const role = roles.find((r) => r.id === roleId);
      if (!role) return zoneFail('role_not_found', 400);
      if (!canAssignZoneRole(access, role)) return zoneFail('role_not_assignable', 403);
      roleName = role.name;
    }
  }

  const events: Array<'approved' | 'rejected' | 'role_changed'> = [];
  try {
    if (status !== undefined) {
      const approve = status === 'active';
      const reviewed = await reviewJoinRequest(zone.id, userId, approve);
      if (!reviewed) return zoneFail('not_pending', 404);
      events.push(approve ? 'approved' : 'rejected');
      // A rejected request has no row left to set a role/title on.
      if (!approve && (roleId !== undefined || title !== undefined)) {
        return NextResponse.json({ ok: true });
      }
    }
    if (roleId !== undefined || title !== undefined) {
      await updateZoneMember(zone.id, userId, {
        ...(roleId !== undefined ? { roleId } : {}),
        ...(title !== undefined ? { title } : {}),
      });
      if (roleId !== undefined) events.push('role_changed');
    }
  } catch (e) {
    return zoneErrorResponse(e);
  }

  for (const event of events) {
    void notifyZoneMember({
      recipientId: userId,
      actorId: session.user.id,
      zoneSlug: zone.slug,
      zoneName: zone.name,
      event,
      roleName: event === 'role_changed' ? roleName : null,
    }).catch(() => undefined);
  }

  if (actingAsSiteAdmin(access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'update_zone_member',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, userId, roleId, title, status },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/zones/[slug]/members/[userId] → { ok }. Removing yourself =
// leave (any member, incl. withdrawing a pending request); anyone else needs
// `members`, and the owner row can never be removed.
export async function DELETE(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  const userId = params.userId;

  if (userId === session.user.id) {
    try {
      const ok = await leaveZone(zone.id, userId);
      return NextResponse.json({ ok });
    } catch (e) {
      return zoneErrorResponse(e);
    }
  }

  if (!access.canManageMembers) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (userId === zone.ownerId) return zoneFail('owner_row', 403);

  const gate = rateLimit(`zones:member-write:${session.user.id}`, MEMBER_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_member', 429, { resetAt: gate.resetAt });

  const guarded = await guardCurrentRole(zone.id, userId, access);
  if (guarded) return zoneFail(guarded, 403);

  let removed: boolean;
  try {
    removed = await removeZoneMember(zone.id, userId);
  } catch (e) {
    return zoneErrorResponse(e);
  }
  if (!removed) return zoneFail('not_member', 404);

  void notifyZoneMember({
    recipientId: userId,
    actorId: session.user.id,
    zoneSlug: zone.slug,
    zoneName: zone.name,
    event: 'removed',
  }).catch(() => undefined);

  if (actingAsSiteAdmin(access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'remove_zone_member',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, userId },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ ok: true });
}
