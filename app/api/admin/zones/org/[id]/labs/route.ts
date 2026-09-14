import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { ORG_DESCRIPTION_MAX, ORG_NAME_MAX, createLab, reorderLabs } from '@/lib/zones/org-admin';
import { auditIp, zoneErrorResponse } from '../../../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// POST /api/admin/zones/org/[id]/labs { name, description? } → { ok, id }   (add a 实验室 under this 研究所)
// PUT  /api/admin/zones/org/[id]/labs { ids: string[] }      → { ok }       (reorder its 实验室)

const createSchema = z.object({
  name: z.string().trim().min(1).max(ORG_NAME_MAX),
  description: z.string().trim().max(ORG_DESCRIPTION_MAX).optional(),
});
const reorderSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).max(500) });

type Params = { params: { id: string } };

export async function POST(req: Request, { params }: Params) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const row = await createLab(params.id, parsed.data);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'create_org_lab',
      targetType: 'org_lab',
      targetId: row.id,
      details: { name: row.name, institute: row.institute },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}

export async function PUT(req: Request, { params }: Params) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = reorderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    await reorderLabs(params.id, parsed.data.ids);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'reorder_org_labs',
      targetType: 'org_institute',
      targetId: params.id,
      details: { ids: parsed.data.ids },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
