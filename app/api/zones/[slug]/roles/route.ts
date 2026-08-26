import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { createZoneRole, listZoneRoles } from '@/lib/zones/queries';
import {
  MINUTE_MS,
  actingAsSiteAdmin,
  auditIp,
  invalidInput,
  roleInputSchema,
  zoneErrorResponse,
  zoneFail,
} from '../../_zone-api';

export const dynamic = 'force-dynamic';

const ROLE_WRITES_PER_MINUTE = 60;

// GET /api/zones/[slug]/roles → { roles: ZoneRoleView[] } (canRead).
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const roles = await listZoneRoles(ctx.zone.id);
  return NextResponse.json({ roles });
}

// POST /api/zones/[slug]/roles { key, name, description?, permissions } → 201 { role }
// (`roles` permission — owner / site admin / a role that carries `roles`).
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canManageRoles) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`zones:member-write:${session.user.id}`, ROLE_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_member', 429, { resetAt: gate.resetAt });

  const parsed = roleInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput();

  let role;
  try {
    role = await createZoneRole(zone.id, {
      key: parsed.data.key,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      permissions: parsed.data.permissions,
    });
  } catch (e) {
    return zoneErrorResponse(e);
  }

  if (actingAsSiteAdmin(access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'create_zone_role',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, roleId: role.id, key: role.key, permissions: role.permissions },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ role }, { status: 201 });
}
