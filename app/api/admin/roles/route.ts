import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi, roleErrorResponse } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { createRole, listRolesWithCounts } from '@/lib/roles';

const createSchema = z.object({
  key: z.string().min(2).max(32),
  name: z.string().min(1).max(40),
  description: z.string().max(200).nullable().optional(),
  permissions: z.array(z.string()).max(64),
  sortOrder: z.number().int().min(-1000).max(100000).optional(),
});

export async function GET() {
  const gate = await gateApi('super');
  if (!gate.ok) return gate.response;
  return NextResponse.json({ roles: await listRolesWithCounts() });
}

export async function POST(req: Request) {
  const gate = await gateApi('super');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  try {
    const role = await createRole(parsed.data);
    await logAdmin({
      adminUserId: session.user.id,
      action: 'create_role',
      targetType: 'role',
      targetId: role.id,
      details: { key: role.key, name: role.name, permissions: role.permissions },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });
    return NextResponse.json({ ok: true, role });
  } catch (e) {
    return roleErrorResponse(e);
  }
}
