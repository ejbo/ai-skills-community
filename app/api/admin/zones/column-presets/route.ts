import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { invalidateColumnPresets, listColumnPresets } from '@/lib/zones/column-presets';
import { createColumnPreset, reorderColumnPresets } from '@/lib/zones/column-presets-admin';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { auditIp, zoneErrorResponse } from '../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// 栏目预设 — site `zones` permission, every write logAdmin'd.
//   GET  /api/admin/zones/column-presets                    → { items }
//   POST /api/admin/zones/column-presets { name, description? } → { ok, id }
//   PUT  /api/admin/zones/column-presets { ids }  (reorder) → { ok }

const createSchema = z.object({
  name: z.string().trim().min(1).max(ZONE_LIMITS.columnNameMax),
  description: z.string().trim().max(ZONE_LIMITS.columnDescriptionMax).optional(),
});
const reorderSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).max(500) });

export async function GET() {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  // Admin reads must not be a minute stale after their own write.
  invalidateColumnPresets();
  return NextResponse.json({ items: await listColumnPresets() });
}

export async function POST(req: Request) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const row = await createColumnPreset(parsed.data);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'create_column_preset',
      targetType: 'zone_column_preset',
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
    await reorderColumnPresets(parsed.data.ids);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'reorder_column_presets',
      targetType: 'zone_column_preset',
      details: { ids: parsed.data.ids },
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
