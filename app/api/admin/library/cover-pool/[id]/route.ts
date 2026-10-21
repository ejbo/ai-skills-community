import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { removeCoverPoolImage } from '@/lib/library/cover-pool';

export const dynamic = 'force-dynamic';

// DELETE /api/admin/library/cover-pool/[id] — 从图片库移除（已配给文档的封面不动）
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateApi('library');
  if (!gate.ok) return gate.response;
  const ok = await removeCoverPoolImage(params.id);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await logAdmin({ adminUserId: gate.session.user.id, action: 'library.cover_pool.remove', targetType: 'library_cover_pool', targetId: params.id });
  return NextResponse.json({ ok: true });
}
