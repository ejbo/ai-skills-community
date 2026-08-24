import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { employeeUpdateSchema, normalizeAccountNumber } from '@/lib/employee-admin';
import { syncEntryToUsers } from '@/lib/employee-directory';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateApi('employees');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const parsed = employeeUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const entry = await prisma.employeeDirectory.findUnique({ where: { id: params.id } });
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const input = parsed.data;
  const data: Prisma.EmployeeDirectoryUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (input.accountNumber !== undefined) {
    const next = normalizeAccountNumber(input.accountNumber);
    if (next && next.toLowerCase() !== (entry.accountNumber ?? '').toLowerCase()) {
      const dup = await prisma.employeeDirectory.findFirst({
        where: { accountNumber: { equals: next, mode: 'insensitive' }, NOT: { id: entry.id } },
        select: { id: true },
      });
      if (dup) return NextResponse.json({ error: 'account_exists' }, { status: 409 });
    }
    if (next !== entry.accountNumber) {
      data.accountNumber = next;
      before.accountNumber = entry.accountNumber;
      after.accountNumber = next;
    }
  }
  for (const field of ['name', 'department', 'lab', 'avatarUrl'] as const) {
    const value = input[field];
    if (value !== undefined && value !== entry[field]) {
      data[field] = value;
      before[field] = entry[field];
      after[field] = value;
    }
  }
  if (input.isActive !== undefined && input.isActive !== entry.isActive) {
    data.isActive = input.isActive;
    before.isActive = entry.isActive;
    after.isActive = input.isActive;
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ ok: true, entry, syncedUsers: 0 });
  }

  let updated;
  try {
    updated = await prisma.employeeDirectory.update({ where: { id: entry.id }, data });
  } catch (err) {
    // 工号 unique 竞态（dup-check 与 update 之间被并发写入）→ 409 而不是 500。
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'account_exists' }, { status: 409 });
    }
    throw err;
  }

  // 同步条件：工号/部门/研究所变了，或条目被重新启用（停用条目不参与同步）。
  const syncTouched =
    'accountNumber' in after || 'department' in after || 'lab' in after || after.isActive === true;
  const syncedUsers = syncTouched ? await syncEntryToUsers(updated) : 0;

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_employee',
    targetType: 'employee',
    targetId: entry.id,
    details: { before, after, syncedUsers },
  });

  return NextResponse.json({ ok: true, entry: updated, syncedUsers });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateApi('employees');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const entry = await prisma.employeeDirectory.findUnique({ where: { id: params.id } });
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // 删除名单条目从不回收用户上已同步的部门/研究所（与 ai4news 语义一致）。
  await prisma.employeeDirectory.delete({ where: { id: entry.id } });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'delete_employee',
    targetType: 'employee',
    targetId: entry.id,
    details: { name: entry.name, accountNumber: entry.accountNumber },
  });

  return NextResponse.json({ ok: true });
}
