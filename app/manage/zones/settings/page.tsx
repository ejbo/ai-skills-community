import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requirePermission } from '@/lib/admin';
import { getZoneSiteSetting, invalidateZoneSiteSetting } from '@/lib/zones/site-settings';
import { ZONE_COPY_LOCALES, type ZoneCopyLocale, type ZoneHubCopy } from '@/lib/zones/site-settings-shared';
import { ZonesSubNav } from '../_components/ZonesSubNav';
import { ZoneSiteSettingsForm } from './ZoneSiteSettingsForm';

export const dynamic = 'force-dynamic';

// /manage/zones/settings — 技术专区首页的文案（按语言）与模块开关。留空的字段用
// messages/<locale>.json 里的默认文案（同时作为输入框的 placeholder 展示给管理员）。
// 写操作走 PUT /api/admin/zones/settings（gateApi('zones') + logAdmin）。

const FIELD_KEYS: Record<keyof ZoneHubCopy, string> = {
  eyebrow: 'hub_eyebrow',
  title: 'hub_title',
  subtitle: 'hub_subtitle',
  createTitle: 'hub_create_card_title',
  createDesc: 'hub_create_card_desc',
};

function readDefaults(): Record<ZoneCopyLocale, ZoneHubCopy> {
  const out = {} as Record<ZoneCopyLocale, ZoneHubCopy>;
  for (const locale of ZONE_COPY_LOCALES) {
    let zones: Record<string, unknown> = {};
    try {
      const json = JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as Record<string, unknown>;
      zones = (json.zones ?? {}) as Record<string, unknown>;
    } catch {
      zones = {};
    }
    const copy = {} as ZoneHubCopy;
    for (const [field, key] of Object.entries(FIELD_KEYS) as [keyof ZoneHubCopy, string][]) {
      const v = zones[key];
      copy[field] = typeof v === 'string' ? v : '';
    }
    out[locale] = copy;
  }
  return out;
}

export default async function ManageZonesSettingsPage() {
  await requirePermission('zones');
  invalidateZoneSiteSetting();
  const [setting, defaults] = await Promise.all([getZoneSiteSetting(), Promise.resolve(readDefaults())]);

  return (
    <div className="space-y-4">
      <ZonesSubNav />
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">首页设置</h2>
        <p className="mt-1 text-xs text-muted">
          技术专区首页（/zones）顶部的文案与模块开关。文案按语言分别填写，留空即用系统默认（输入框里灰色显示的那句）；
          只填中文时，英文 / 法文界面也会显示中文。保存后约 30 秒内生效。
        </p>
      </div>
      <ZoneSiteSettingsForm initial={setting} defaults={defaults} />
    </div>
  );
}
