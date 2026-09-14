import { NextResponse } from 'next/server';
import { z } from 'zod';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { getZoneSiteSetting, invalidateZoneSiteSetting, updateZoneSiteSetting } from '@/lib/zones/site-settings';
import { sanitizeZoneSiteCopy } from '@/lib/zones/site-settings-shared';
import { auditIp } from '../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

// 技术专区首页设置 — site `zones` permission.
//   GET /api/admin/zones/settings → ZoneSiteSettingView
//   PUT /api/admin/zones/settings { copy, showWall, showTotals, showHotRail, showFeatured } → { ok, setting }
// `copy` replaces the whole per-locale object (the form sends it complete);
// blanks are dropped by the sanitizer and fall back to the i18n message.

const putSchema = z.object({
  copy: z.unknown().optional(),
  showWall: z.boolean().optional(),
  showTotals: z.boolean().optional(),
  showHotRail: z.boolean().optional(),
  showFeatured: z.boolean().optional(),
});

export async function GET() {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  invalidateZoneSiteSetting();
  return NextResponse.json(await getZoneSiteSetting());
}

export async function PUT(req: Request) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { copy, ...toggles } = parsed.data;
  const setting = await updateZoneSiteSetting({
    ...toggles,
    ...(copy !== undefined ? { copy: sanitizeZoneSiteCopy(copy) } : {}),
  });
  await logAdmin({
    adminUserId: gate.session.user.id,
    action: 'update_zone_site_setting',
    targetType: 'zone_site_setting',
    targetId: 'default',
    details: setting,
    ip: auditIp(req),
  });
  return NextResponse.json({ ok: true, setting });
}
