import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { syncAllEntriesToUsers } from '@/lib/employee-directory';

export const dynamic = 'force-dynamic';

export async function POST() {
  const gate = await gateApi('employees');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const result = await syncAllEntriesToUsers();

  await logAdmin({
    adminUserId: session.user.id,
    action: 'sync_employees',
    targetType: 'employee',
    details: result,
  });

  return NextResponse.json({ ok: true, ...result });
}
