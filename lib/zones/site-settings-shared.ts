// 技术专区站级设置 — the pure half (client-safe, import-free): the per-locale
// hub copy shape, its sanitizer, and the module toggles. The server half
// (lib/zones/site-settings.ts) reads/writes the single `ZoneSiteSetting` row.
//
// Copy is stored PER LOCALE because the site is trilingual: an admin fills the
// 中文 at least; an empty string in any locale falls back to that locale's
// i18n message (`zones.hub_*`), so a half-filled form never renders blanks.

export const ZONE_COPY_LOCALES = ['zh-CN', 'en', 'fr'] as const;
export type ZoneCopyLocale = (typeof ZONE_COPY_LOCALES)[number];

export const ZONE_COPY_FIELDS = ['eyebrow', 'title', 'subtitle', 'createTitle', 'createDesc'] as const;
export type ZoneCopyField = (typeof ZONE_COPY_FIELDS)[number];

export const ZONE_COPY_LIMITS: Record<ZoneCopyField, number> = {
  eyebrow: 40,
  title: 40,
  subtitle: 200,
  createTitle: 40,
  createDesc: 200,
};

export type ZoneHubCopy = Record<ZoneCopyField, string>;
export type ZoneSiteCopy = Partial<Record<ZoneCopyLocale, Partial<ZoneHubCopy>>>;

export interface ZoneSiteToggles {
  showWall: boolean;
  showTotals: boolean;
  showHotRail: boolean;
  showFeatured: boolean;
}

export interface ZoneSiteSettingView extends ZoneSiteToggles {
  copy: ZoneSiteCopy;
}

export const DEFAULT_ZONE_SITE_TOGGLES: ZoneSiteToggles = {
  showWall: true,
  showTotals: true,
  showHotRail: true,
  showFeatured: true,
};

export function isZoneCopyLocale(v: string): v is ZoneCopyLocale {
  return (ZONE_COPY_LOCALES as readonly string[]).includes(v);
}

/** Drop unknown locales/fields, trim, cap lengths. Never throws. */
export function sanitizeZoneSiteCopy(raw: unknown): ZoneSiteCopy {
  const out: ZoneSiteCopy = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const locale of ZONE_COPY_LOCALES) {
    const block = (raw as Record<string, unknown>)[locale];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const entry: Partial<ZoneHubCopy> = {};
    for (const field of ZONE_COPY_FIELDS) {
      const v = (block as Record<string, unknown>)[field];
      if (typeof v !== 'string') continue;
      const s = v.trim().slice(0, ZONE_COPY_LIMITS[field]);
      if (s) entry[field] = s;
    }
    if (Object.keys(entry).length > 0) out[locale] = entry;
  }
  return out;
}

/**
 * Resolve the copy for ONE locale: the stored value if the admin wrote one,
 * else the 中文 value (source of truth, like the rest of the site's stored
 * content), else the i18n fallback the caller passes in.
 */
export function resolveZoneHubCopy(copy: ZoneSiteCopy, locale: string, fallback: ZoneHubCopy): ZoneHubCopy {
  const own = isZoneCopyLocale(locale) ? copy[locale] : undefined;
  const zh = copy['zh-CN'];
  const out = { ...fallback };
  for (const field of ZONE_COPY_FIELDS) {
    const v = own?.[field] || zh?.[field];
    if (v) out[field] = v;
  }
  return out;
}
