import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { backfillPoolCovers } from '@/lib/library/cover-pool';

export const dynamic = 'force-dynamic';

// POST /api/admin/library/cover-pool/backfill — 给所有没有封面的文档从图片库配一张 → { assigned }
export async function POST() {
  const gate = await gateApi('library');
  if (!gate.ok) return gate.response;
  const assigned = await backfillPoolCovers();
  await logAdmin({ adminUserId: gate.session.user.id, action: 'library.cover_pool.backfill', targetType: 'library_cover_pool', targetId: 'pool', details: { assigned } });
  return NextResponse.json({ assigned });
}
