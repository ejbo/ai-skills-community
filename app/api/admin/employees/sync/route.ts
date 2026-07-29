import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { syncAllEntriesToUsers } from '@/lib/employee-directory';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const result = await syncAllEntriesToUsers();

  await logAdmin({
    adminUserId: session.user.id,
    action: 'sync_employees',
    targetType: 'employee',
    details: result,
  });

  return NextResponse.json({ ok: true, ...result });
}
