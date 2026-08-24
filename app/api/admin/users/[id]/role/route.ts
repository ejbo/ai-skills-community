import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi, roleErrorResponse } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { assignRole } from '@/lib/roles';

const schema = z.object({ roleId: z.string().min(1).nullable() });

/** 指派角色 — super admin only (rules live in lib/roles.ts#assignRole). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateApi('super');
  if (!gate.ok) return gate.response;
  const { session, role } = gate;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  try {
    const { before, after } = await assignRole({
      actor: { id: session.user.id, roleKey: role.roleKey, permissions: role.permissions },
      targetUserId: params.id,
      roleId: parsed.data.roleId,
    });
    await logAdmin({
      adminUserId: session.user.id,
      action: 'assign_role',
      targetType: 'user',
      targetId: params.id,
      details: { before: before?.key ?? null, after: after?.key ?? null },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });
    return NextResponse.json({ ok: true, role: after });
  } catch (e) {
    return roleErrorResponse(e);
  }
}
