import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { deleteColumnPreset, updateColumnPreset } from '@/lib/zones/column-presets-admin';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { auditIp, zoneErrorResponse } from '../../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// PATCH  /api/admin/zones/column-presets/[id] { name?, description?, sortOrder? } → { ok }
// DELETE /api/admin/zones/column-presets/[id] → { ok } (boards that already carry the 栏目 keep it)

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(ZONE_LIMITS.columnNameMax).optional(),
    description: z.string().trim().max(ZONE_LIMITS.columnDescriptionMax).optional(),
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
    const r = await updateColumnPreset(params.id, parsed.data);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'update_column_preset',
      targetType: 'zone_column_preset',
      targetId: params.id,
      details: { before: r.before, after: r.after, patch: parsed.data },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  try {
    const r = await deleteColumnPreset(params.id);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'delete_column_preset',
      targetType: 'zone_column_preset',
      targetId: params.id,
      details: { name: r.name },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
