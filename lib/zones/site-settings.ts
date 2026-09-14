// 技术专区站级设置 — server half. ONE row (`ZoneSiteSetting`, id "default"),
// created lazily on first write; reads memoize for SETTING_TTL_MS and the admin
// write path calls `invalidateZoneSiteSetting()`.

import { prisma } from '@/lib/db';
import {
  DEFAULT_ZONE_SITE_TOGGLES,
  sanitizeZoneSiteCopy,
  type ZoneSiteCopy,
  type ZoneSiteSettingView,
  type ZoneSiteToggles,
} from './site-settings-shared';

const SETTING_ID = 'default';
const SETTING_TTL_MS = 30_000;

let cache: { at: number; data: ZoneSiteSettingView } | null = null;

function defaults(): ZoneSiteSettingView {
  return { ...DEFAULT_ZONE_SITE_TOGGLES, copy: {} };
}

export async function getZoneSiteSetting(): Promise<ZoneSiteSettingView> {
  if (cache && Date.now() - cache.at < SETTING_TTL_MS) return cache.data;
  try {
    const row = await prisma.zoneSiteSetting.findUnique({ where: { id: SETTING_ID } });
    const data: ZoneSiteSettingView = row
      ? {
          copy: sanitizeZoneSiteCopy(row.copy),
          showWall: row.showWall,
          showTotals: row.showTotals,
          showHotRail: row.showHotRail,
          showFeatured: row.showFeatured,
        }
      : defaults();
    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    // Copy and toggles decorate the hub; the hub must render without them.
    console.error('[zone-site-setting] failed', err);
    return cache?.data ?? defaults();
  }
}

export interface ZoneSiteSettingPatch extends Partial<ZoneSiteToggles> {
  copy?: ZoneSiteCopy;
}

/** Upsert the single row. `copy` replaces the whole object (the admin form sends it complete). */
export async function updateZoneSiteSetting(patch: ZoneSiteSettingPatch): Promise<ZoneSiteSettingView> {
  const data: Record<string, unknown> = {};
  if (patch.copy !== undefined) data.copy = sanitizeZoneSiteCopy(patch.copy);
  for (const k of ['showWall', 'showTotals', 'showHotRail', 'showFeatured'] as const) {
    if (typeof patch[k] === 'boolean') data[k] = patch[k];
  }
  await prisma.zoneSiteSetting.upsert({
    where: { id: SETTING_ID },
    create: { id: SETTING_ID, ...data },
    update: data,
  });
  invalidateZoneSiteSetting();
  return getZoneSiteSetting();
}

export function invalidateZoneSiteSetting(): void {
  cache = null;
}
