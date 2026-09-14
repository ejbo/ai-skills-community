// 栏目预设 — the site-wide standard 栏目 list (`ZoneColumnPreset`), maintained at
// 管理后台 → 技术专区 → 栏目预设. Three consumers:
//   • createZone seeds every preset as an `official` ZoneColumn on the new board
//     (lib/zones/queries.ts) — a fresh board opens with the house taxonomy;
//   • 「同步到所有版块」 (applyColumnPresetsToZones) adds any MISSING preset to
//     every live board by name — it never renames or deletes a board's own 栏目
//     (版主 keep their autonomy; the preset is a floor, not a cage);
//   • the hub's 栏目 facet orders preset names first (orderColumnFacet, pure).
// Reads memoize for PRESET_TTL_MS; the admin routes call `invalidateColumnPresets()`.

import { prisma } from '@/lib/db';
import { MAX_ZONE_COLUMNS, ZONE_LIMITS, columnDedupeKey, columnSlugFrom, isValidColumnSlug, normalizeColumnName } from './shared';

const PRESET_TTL_MS = 60_000;

export interface ZoneColumnPresetView {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
}

let cache: { at: number; data: ZoneColumnPresetView[] } | null = null;

export async function listColumnPresets(): Promise<ZoneColumnPresetView[]> {
  if (cache && Date.now() - cache.at < PRESET_TTL_MS) return cache.data;
  try {
    const rows = await prisma.zoneColumnPreset.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, description: true, sortOrder: true },
    });
    cache = { at: Date.now(), data: rows };
    return rows;
  } catch (err) {
    console.error('[column-presets] failed', err);
    return cache?.data ?? [];
  }
}

export function invalidateColumnPresets(): void {
  cache = null;
}

/**
 * Pure: the hub facet in preset order first (even at zero posts, so the rail
 * shows the house taxonomy), then everything else busiest-first as before.
 */
export function orderColumnFacet<T extends { name: string; postCount: number }>(
  columns: readonly T[],
  presets: readonly { name: string }[],
): T[] {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const out: T[] = [];
  const taken = new Set<string>();
  for (const p of presets) {
    const name = p.name.trim();
    if (!name || taken.has(name)) continue;
    taken.add(name);
    out.push(byName.get(name) ?? ({ name, postCount: 0 } as T));
  }
  for (const c of columns) if (!taken.has(c.name)) out.push(c);
  return out;
}

/**
 * Pure: the official 栏目 rows a brand-new board is seeded with — preset order,
 * name-deduped (`columnDedupeKey`), slugs made unique within the batch, sort
 * steps of 10, capped at MAX_ZONE_COLUMNS. Used by createZone (lib/zones/queries.ts).
 */
export function seedPresetColumns(
  presets: readonly { name: string; description?: string }[],
): { slug: string; name: string; description: string; sortOrder: number }[] {
  const out: { slug: string; name: string; description: string; sortOrder: number }[] = [];
  const keys = new Set<string>();
  const slugs = new Set<string>();
  for (const p of presets) {
    const name = normalizeColumnName(p.name ?? '');
    if (!name) continue;
    const key = columnDedupeKey(name);
    if (keys.has(key)) continue;
    keys.add(key);
    let base = columnSlugFrom(name);
    if (!base || !isValidColumnSlug(base)) base = `col-${simpleHash(name)}`;
    let slug = base;
    for (let n = 2; slugs.has(slug) && n < 100; n++) slug = `${base.slice(0, 36).replace(/-+$/, '')}-${n}`;
    slugs.add(slug);
    out.push({
      slug,
      name,
      description: (p.description ?? '').trim().slice(0, ZONE_LIMITS.columnDescriptionMax),
      sortOrder: (out.length + 1) * 10,
    });
    if (out.length >= MAX_ZONE_COLUMNS) break;
  }
  return out;
}

/** Deterministic 6-char base36 hash — a slug for a CJK-only name (no nanoid: pure + testable). */
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6).padStart(6, '0');
}
