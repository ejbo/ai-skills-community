import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import {
  ORG_DESCRIPTION_MAX,
  ORG_IMAGE_URL_MAX,
  ORG_NAME_MAX,
  createInstitute,
  orgCatalogAdminTree,
  reorderInstitutes,
} from '@/lib/zones/org-admin';
import { auditIp, zoneErrorResponse } from '../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// 组织架构目录 (研究所 → 实验室) — site `zones` permission, every write logAdmin'd.
//   GET  /api/admin/zones/org                → { items: OrgInstituteAdminRow[] }
//   POST /api/admin/zones/org  { name, description?, imageUrl? } → { ok, id }
//   PUT  /api/admin/zones/org  { ids: string[] }  (reorder)      → { ok }

const createSchema = z.object({
  name: z.string().trim().min(1).max(ORG_NAME_MAX),
  description: z.string().trim().max(ORG_DESCRIPTION_MAX).optional(),
  imageUrl: z.union([z.string().trim().max(ORG_IMAGE_URL_MAX), z.null()]).optional(),
});

const reorderSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).max(500) });

export async function GET() {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  return NextResponse.json({ items: await orgCatalogAdminTree() });
}

export async function POST(req: Request) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const row = await createInstitute(parsed.data);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'create_org_institute',
      targetType: 'org_institute',
      targetId: row.id,
      details: { name: row.name },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}

export async function PUT(req: Request) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = reorderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    await reorderInstitutes(parsed.data.ids);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'reorder_org_institutes',
      targetType: 'org_institute',
      details: { ids: parsed.data.ids },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
