import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { ORG_DESCRIPTION_MAX, ORG_IMAGE_URL_MAX, ORG_NAME_MAX, deleteInstitute, updateInstitute } from '@/lib/zones/org-admin';
import { auditIp, zoneErrorResponse } from '../../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// PATCH  /api/admin/zones/org/[id] { name?, description?, imageUrl?, sortOrder? }
//        → { ok, renamedZones } — a rename rewrites Zone.lab on every board (same tx).
// DELETE /api/admin/zones/org/[id] → { ok, zonesKeepingName } — labs cascade, boards untouched.

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(ORG_NAME_MAX).optional(),
    description: z.string().trim().max(ORG_DESCRIPTION_MAX).optional(),
    imageUrl: z.union([z.string().trim().max(ORG_IMAGE_URL_MAX), z.null()]).optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const r = await updateInstitute(params.id, parsed.data);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: r.before !== r.after ? 'rename_org_institute' : 'update_org_institute',
      targetType: 'org_institute',
      targetId: params.id,
      details: { before: r.before, after: r.after, renamedZones: r.renamedZones, patch: parsed.data },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true, renamedZones: r.renamedZones });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  try {
    const r = await deleteInstitute(params.id);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'delete_org_institute',
      targetType: 'org_institute',
      targetId: params.id,
      details: { name: r.name, zonesKeepingName: r.zonesKeepingName },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true, zonesKeepingName: r.zonesKeepingName });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
