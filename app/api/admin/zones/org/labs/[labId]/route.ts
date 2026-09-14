import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { ORG_DESCRIPTION_MAX, ORG_NAME_MAX, deleteLab, updateLab } from '@/lib/zones/org-admin';
import { auditIp, zoneErrorResponse } from '../../../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// PATCH  /api/admin/zones/org/labs/[labId] { name?, description?, sortOrder? }
//        → { ok, renamedZones } — a rename rewrites Zone.department on boards under the same 研究所.
// DELETE /api/admin/zones/org/labs/[labId] → { ok, zonesKeepingName }

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(ORG_NAME_MAX).optional(),
    description: z.string().trim().max(ORG_DESCRIPTION_MAX).optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);

type Params = { params: { labId: string } };

export async function PATCH(req: Request, { params }: Params) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const r = await updateLab(params.labId, parsed.data);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: r.before !== r.after ? 'rename_org_lab' : 'update_org_lab',
      targetType: 'org_lab',
      targetId: params.labId,
      details: { institute: r.institute, before: r.before, after: r.after, renamedZones: r.renamedZones, patch: parsed.data },
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
    const r = await deleteLab(params.labId);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'delete_org_lab',
      targetType: 'org_lab',
      targetId: params.labId,
      details: { institute: r.institute, name: r.name, zonesKeepingName: r.zonesKeepingName },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true, zonesKeepingName: r.zonesKeepingName });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
