import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi, roleErrorResponse } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { ROLE_SELECT, deleteRole, updateRole } from '@/lib/roles';

const patchSchema = z.object({
  key: z.string().min(2).max(32).optional(),
  name: z.string().min(1).max(40).optional(),
  description: z.string().max(200).nullable().optional(),
  permissions: z.array(z.string()).max(64).optional(),
  sortOrder: z.number().int().min(-1000).max(100000).optional(),
});

function ip(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateApi('super');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const before = await prisma.role.findUnique({ where: { id: params.id }, select: ROLE_SELECT });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const role = await updateRole(params.id, parsed.data);
    await logAdmin({
      adminUserId: session.user.id,
      action: 'update_role',
      targetType: 'role',
      targetId: role.id,
      details: {
        key: role.key,
        before: { name: before.name, permissions: before.permissions },
        after: { name: role.name, permissions: role.permissions },
      },
      ip: ip(req),
    });
    return NextResponse.json({ ok: true, role });
  } catch (e) {
    return roleErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateApi('super');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  try {
    const role = await deleteRole(params.id);
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_role',
      targetType: 'role',
      targetId: role.id,
      details: { key: role.key, name: role.name, permissions: role.permissions },
      ip: ip(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return roleErrorResponse(e);
  }
}
