import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { isLastActiveSuperAdmin, isSerializationFailure } from '@/lib/roles';

// Per-user switches. `isAdmin` is deliberately NOT here any more — it is a
// derived cache of the role; roles are assigned via POST /api/admin/users/[id]/role
// (super admin only). Staff accounts can only be touched by a super admin, so a
// 用户管理 holder can never disable or restrict a peer/superior.
const BOOL_FIELDS = ['isActive', 'canPublishSkills', 'canRemix', 'canUseCli'] as const;
const NUM_FIELDS = ['dailyDownloadLimit', 'dailyPublishLimit'] as const;

class LastSuperAdminError extends Error {}

const schema = z.object({
  field: z.string(),
  value: z.union([z.boolean(), z.number().int().nonnegative().nullable()]),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateApi('users');
  if (!gate.ok) return gate.response;
  const { session, role } = gate;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { field, value } = parsed.data;
  if (field === 'isAdmin') return NextResponse.json({ error: 'use_role_endpoint' }, { status: 400 });
  const isBool = (BOOL_FIELDS as readonly string[]).includes(field);
  const isNum = (NUM_FIELDS as readonly string[]).includes(field);
  if (!isBool && !isNum) return NextResponse.json({ error: 'unknown_field' }, { status: 400 });
  if (isBool && typeof value !== 'boolean')
    return NextResponse.json({ error: 'expected_boolean' }, { status: 400 });
  if (isNum && typeof value !== 'number' && value !== null)
    return NextResponse.json({ error: 'expected_number_or_null' }, { status: 400 });

  const before = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, isAdmin: true, [field]: true } as Record<string, true>,
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if ((before as { isAdmin?: boolean }).isAdmin && !role.isSuperAdmin) {
    return NextResponse.json({ error: 'staff_target_requires_super' }, { status: 403 });
  }
  if (field === 'isActive' && value === false && params.id === session.user.id) {
    return NextResponse.json({ error: 'self_disable' }, { status: 400 });
  }

  let updated;
  try {
    // 停用 re-checks "last active super admin" INSIDE a Serializable tx so two
    // concurrent disables cannot both pass the guard and lock everyone out.
    updated = await prisma.$transaction(
      async (tx) => {
        if (field === 'isActive' && value === false && (await isLastActiveSuperAdmin(params.id, tx))) {
          throw new LastSuperAdminError();
        }
        return tx.user.update({
          where: { id: params.id },
          data: { [field]: value } as Record<string, unknown>,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof LastSuperAdminError) return NextResponse.json({ error: 'last_super_admin' }, { status: 409 });
    if (isSerializationFailure(e)) return NextResponse.json({ error: 'conflict' }, { status: 409 });
    throw e;
  }

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_user',
    targetType: 'user',
    targetId: params.id,
    details: { field, before: (before as Record<string, unknown>)[field], after: value },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });

  return NextResponse.json({ ok: true, user: { id: updated.id, [field]: (updated as Record<string, unknown>)[field] } });
}
