import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { applyColumnPresetsToZones } from '@/lib/zones/column-presets-admin';
import { auditIp, zoneErrorResponse } from '../../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// POST /api/admin/zones/column-presets/apply → { ok, zonesScanned, zonesTouched, columnsCreated, zonesSkippedFull }
// 同步到所有版块: ADDS missing presets as official 栏目 on every live board; never renames or removes.
export async function POST(req: Request) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  try {
    const r = await applyColumnPresetsToZones(gate.session.user.id);
    await logAdmin({
      adminUserId: gate.session.user.id,
      action: 'apply_column_presets',
      targetType: 'zone_column_preset',
      details: r,
      ip: auditIp(req),
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
