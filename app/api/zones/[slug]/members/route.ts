import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAdmin } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { notifyZoneMember } from '@/lib/notifications';
import { ZONE_ROLE_KEY_RE, canAssignZoneRole } from '@/lib/zones/permissions';
import { zoneContext } from '@/lib/zones/access';
import { addZoneMember, listZoneMembers, listZoneRoles, zoneMemberRolePermissions } from '@/lib/zones/queries';
import {
  MINUTE_MS,
  actingAsSiteAdmin,
  auditIp,
  intParam,
  invalidInput,
  strParam,
  zoneErrorResponse,
  zoneFail,
} from '../../_zone-api';

export const dynamic = 'force-dynamic';

const MEMBER_WRITES_PER_MINUTE = 60;
const DEFAULT_TAKE = 50;
const MAX_TAKE = 100;

const addSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  roleId: z.string().trim().min(1).max(64).nullable().optional(),
});

// GET /api/zones/[slug]/members?status&q&role&skip&take → { items, total }.
// canRead; the pending list (and the join-request notes) only for `members`.
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canRead) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const status: 'active' | 'pending' = sp.get('status') === 'pending' ? 'pending' : 'active';
  if (status === 'pending' && !access.canManageMembers) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const q = strParam(sp.get('q'), 100);
  const roleRaw = strParam(sp.get('role'), 32);
  const roleKey = roleRaw && (ZONE_ROLE_KEY_RE.test(roleRaw) || roleRaw === 'owner') ? roleRaw : undefined;
  const skip = intParam(sp.get('skip'), 0, 0, 100_000);
  const take = intParam(sp.get('take'), DEFAULT_TAKE, 1, MAX_TAKE);

  const result = await listZoneMembers(zone.id, {
    status,
    q: q || undefined,
    roleKey,
    skip,
    take,
    includeMessage: status === 'pending' && access.canManageMembers,
    canSeeIdentity: access.canSeeIdentity,
  });
  return NextResponse.json(result);
}

// POST /api/zones/[slug]/members { userId, roleId? } → 201 { member }.
// `members` permission; a role carrying `roles` needs `roles` (canAssignZoneRole),
// and — since this doubles as a re-role for an existing member — the target's
// CURRENT role is guarded exactly like PATCH does.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canManageMembers) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`zones:member-write:${session.user.id}`, MEMBER_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_member', 429, { resetAt: gate.resetAt });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput();
  const { userId } = parsed.data;
  const roleId = parsed.data.roleId ?? null;

  if (userId === zone.ownerId) return zoneFail('owner_row', 400);

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
  if (!target) return zoneFail('user_not_found', 404);
  if (!target.isActive) return zoneFail('user_inactive', 400);

  // Same escalation PATCH blocks: without `roles` a members-manager must not be
  // able to overwrite (or silently demote) a member whose CURRENT role carries
  // `roles`. Pending rows keep working — this only reads the role.
  if (!access.canManageRoles && (await zoneMemberRolePermissions(zone.id, userId)).includes('roles')) {
    return zoneFail('role_not_assignable', 403);
  }

  let roleName: string | null = null;
  if (roleId) {
    const role = (await listZoneRoles(zone.id)).find((r) => r.id === roleId);
    if (!role) return zoneFail('role_not_found', 400);
    if (!canAssignZoneRole(access, role)) return zoneFail('role_not_assignable', 403);
    roleName = role.name;
  }

  let member;
  try {
    member = await addZoneMember(zone.id, userId, roleId, session.user.id, access.canSeeIdentity);
  } catch (e) {
    return zoneErrorResponse(e);
  }

  void notifyZoneMember({
    recipientId: userId,
    actorId: session.user.id,
    zoneSlug: zone.slug,
    zoneName: zone.name,
    event: 'added',
    roleName,
  }).catch(() => undefined);

  if (actingAsSiteAdmin(access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'add_zone_member',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, userId, roleId },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ member }, { status: 201 });
}
