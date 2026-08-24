import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { employeeCreateSchema, normalizeAccountNumber } from '@/lib/employee-admin';
import { syncEntryToUsers } from '@/lib/employee-directory';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const gate = await gateApi('employees');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const parsed = employeeCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const accountNumber = normalizeAccountNumber(parsed.data.accountNumber);
  if (accountNumber) {
    const dup = await prisma.employeeDirectory.findFirst({
      where: { accountNumber: { equals: accountNumber, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ error: 'account_exists' }, { status: 409 });
  }

  let entry;
  try {
    entry = await prisma.employeeDirectory.create({
      data: {
        name: parsed.data.name,
        accountNumber,
        department: parsed.data.department,
        lab: parsed.data.lab,
        avatarUrl: parsed.data.avatarUrl,
        createdById: session.user.id,
      },
    });
  } catch (err) {
    // 工号 unique 竞态（并发创建/导入）→ 409 而不是 500。
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'account_exists' }, { status: 409 });
    }
    throw err;
  }
  const syncedUsers = await syncEntryToUsers(entry);

  await logAdmin({
    adminUserId: session.user.id,
    action: 'create_employee',
    targetType: 'employee',
    targetId: entry.id,
    details: { name: entry.name, accountNumber: entry.accountNumber, department: entry.department, lab: entry.lab, syncedUsers },
  });

  return NextResponse.json({ ok: true, entry, syncedUsers }, { status: 201 });
}
