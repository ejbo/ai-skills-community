import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { deleteZoneRole, updateZoneRole } from '@/lib/zones/queries';
import {
  MINUTE_MS,
  actingAsSiteAdmin,
  auditIp,
  invalidInput,
  roleInputSchema,
  zoneErrorResponse,
  zoneFail,
} from '../../../_zone-api';

export const dynamic = 'force-dynamic';

const ROLE_WRITES_PER_MINUTE = 60;

const patchSchema = roleInputSchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined));

type Params = { params: { slug: string; roleId: string } };

// PATCH /api/zones/[slug]/roles/[roleId] { key?, name?, description?, permissions? } → { role }
// (`roles`). System roles keep their key; `member` may change permissions (lib contract).
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canManageRoles) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`zones:member-write:${session.user.id}`, ROLE_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_member', 429, { resetAt: gate.resetAt });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput();
  const { key, name, description, permissions } = parsed.data;

  let role;
  try {
    role = await updateZoneRole(zone.id, params.roleId, {
      ...(key !== undefined ? { key } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(permissions !== undefined ? { permissions } : {}),
    });
  } catch (e) {
    return zoneErrorResponse(e);
  }

  if (actingAsSiteAdmin(access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'update_zone_role',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, roleId: role.id, key: role.key, permissions: role.permissions },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ role });
}

// DELETE /api/zones/[slug]/roles/[roleId] → { ok } (`roles`). System roles
// refuse (ZoneError system_role); holders fall back to the `member` role.
export async function DELETE(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canManageRoles) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`zones:member-write:${session.user.id}`, ROLE_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_member', 429, { resetAt: gate.resetAt });

  try {
    await deleteZoneRole(zone.id, params.roleId);
  } catch (e) {
    return zoneErrorResponse(e);
  }

  if (actingAsSiteAdmin(access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_zone_role',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, roleId: params.roleId },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ ok: true });
}
