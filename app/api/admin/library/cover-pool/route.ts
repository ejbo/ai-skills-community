import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { addCoverPoolImage, COVER_POOL_MAX_BYTES, listCoverPool } from '@/lib/library/cover-pool';

export const dynamic = 'force-dynamic';

// GET /api/admin/library/cover-pool (library 管理员) — 图片库全部图片
export async function GET() {
  const gate = await gateApi('library');
  if (!gate.ok) return gate.response;
  return NextResponse.json({ images: await listCoverPool(), maxBytes: COVER_POOL_MAX_BYTES });
}

// POST /api/admin/library/cover-pool — multipart，字段 `files`（可多个）→ { added, rejected }
export async function POST(req: Request) {
  const gate = await gateApi('library');
  if (!gate.ok) return gate.response;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, 40);
  if (!files.length) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const added = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const res = await addCoverPoolImage(buf, f.name, gate.session.user.id);
    if ('error' in res) rejected.push({ name: f.name, reason: res.error });
    else added.push(res);
  }
  await logAdmin({ adminUserId: gate.session.user.id, action: 'library.cover_pool.add', targetType: 'library_cover_pool', targetId: 'pool', details: { added: added.length, rejected } });
  return NextResponse.json({ added, rejected });
}
