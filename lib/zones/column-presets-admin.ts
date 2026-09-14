// 栏目预设 — the admin write side (管理后台 → 技术专区 → 栏目预设).
//
// Presets are a FLOOR for every board's taxonomy, never a cage: creating a
// board seeds them (lib/zones/queries.ts#createZone via seedPresetColumns) and
// 「同步到所有版块」 (applyColumnPresetsToZones) ADDS any preset a live board is
// missing as an official 栏目 — it never renames, demotes or deletes a board's
// own 栏目, and a board that already has MAX_ZONE_COLUMNS is skipped and
// counted. Dedupe is `columnDedupeKey` (case/space-insensitive) on both sides,
// so a board that already calls a preset "技术 报告" simply keeps it.
// `planPresetsForZone` is the pure decision (tests/zone-column-presets.test.ts).

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { invalidateColumnPresets, seedPresetColumns } from './column-presets';
import { ZoneError } from './errors';
import { MAX_ZONE_COLUMNS, ZONE_LIMITS, columnDedupeKey, normalizeColumnName } from './shared';

/** A board cannot hold more than MAX_ZONE_COLUMNS anyway. */
const MAX_PRESETS = MAX_ZONE_COLUMNS;
const SORT_STEP = 10;
const OFFICIAL_SORT_STEP = 10;
const ZONE_SCAN_MAX = 2_000;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const key = columnDedupeKey(name);
  const rows = await prisma.zoneColumnPreset.findMany({ select: { id: true, name: true }, take: MAX_PRESETS * 2 });
  if (rows.some((r) => r.id !== exceptId && columnDedupeKey(r.name) === key)) throw new ZoneError('name_taken', 409);
}

export async function createColumnPreset(input: { name: string; description?: string }): Promise<{ id: string; name: string }> {
  const name = normalizeColumnName(input.name ?? '');
  if (!name) throw new ZoneError('invalid_input', 400);
  const count = await prisma.zoneColumnPreset.count();
  if (count >= MAX_PRESETS) throw new ZoneError('presets_full', 400);
  await assertNameFree(name);
  const last = await prisma.zoneColumnPreset.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  try {
    const row = await prisma.zoneColumnPreset.create({
      data: {
        name,
        description: (input.description ?? '').trim().slice(0, ZONE_LIMITS.columnDescriptionMax),
        sortOrder: (last?.sortOrder ?? 0) + SORT_STEP,
      },
      select: { id: true, name: true },
    });
    invalidateColumnPresets();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('name_taken', 409);
    throw e;
  }
}

export async function updateColumnPreset(
  id: string,
  patch: { name?: string; description?: string; sortOrder?: number },
): Promise<{ before: string; after: string }> {
  const row = await prisma.zoneColumnPreset.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!row) throw new ZoneError('not_found', 404);
  const data: Prisma.ZoneColumnPresetUpdateInput = {};
  let after = row.name;
  if (patch.name !== undefined) {
    const name = normalizeColumnName(patch.name);
    if (!name) throw new ZoneError('invalid_input', 400);
    if (columnDedupeKey(name) !== columnDedupeKey(row.name)) await assertNameFree(name, id);
    data.name = name;
    after = name;
  }
  if (patch.description !== undefined) {
    data.description = patch.description.trim().slice(0, ZONE_LIMITS.columnDescriptionMax);
  }
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    data.sortOrder = Math.max(0, Math.min(100_000, Math.trunc(patch.sortOrder)));
  }
  try {
    if (Object.keys(data).length > 0) await prisma.zoneColumnPreset.update({ where: { id }, data });
    invalidateColumnPresets();
    return { before: row.name, after };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('name_taken', 409);
    throw e;
  }
}

/** Removes the preset only — boards that already carry the 栏目 keep it. */
export async function deleteColumnPreset(id: string): Promise<{ name: string }> {
  const row = await prisma.zoneColumnPreset.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!row) throw new ZoneError('not_found', 404);
  await prisma.zoneColumnPreset.delete({ where: { id } });
  invalidateColumnPresets();
  return { name: row.name };
}

export async function reorderColumnPresets(ids: readonly string[]): Promise<void> {
  const existing = await prisma.zoneColumnPreset.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const known = new Set(existing.map((r) => r.id));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const r of existing) if (!seen.has(r.id)) ordered.push(r.id);
  await prisma.$transaction(
    ordered.map((id, i) => prisma.zoneColumnPreset.update({ where: { id }, data: { sortOrder: (i + 1) * SORT_STEP } })),
  );
  invalidateColumnPresets();
}

export interface ApplyPresetsResult {
  zonesScanned: number;
  zonesTouched: number;
  columnsCreated: number;
  zonesSkippedFull: number;
}

export interface PlannedColumn {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

/**
 * Pure: given a board's existing 栏目 and the preset list, the official rows to
 * ADD — dedupe by columnDedupeKey against existing names, slugs made unique
 * against the board's slugs, sortOrder continuing the board's official steps
 * of 10. `[]` when nothing is missing; `null` when something IS missing but the
 * board has no room for even one (the caller counts it as skipped-full).
 */
export function planPresetsForZone(
  existing: readonly { name: string; slug: string; official: boolean; sortOrder: number }[],
  presets: readonly { name: string; description?: string }[],
): PlannedColumn[] | null {
  const keys = new Set(existing.map((c) => columnDedupeKey(c.name)));
  const slugs = new Set(existing.map((c) => c.slug));
  const room = MAX_ZONE_COLUMNS - existing.length;
  const missing = seedPresetColumns(presets).filter((p) => !keys.has(columnDedupeKey(p.name)));
  if (missing.length === 0) return [];
  if (room <= 0) return null;
  let next = existing.filter((c) => c.official).reduce((max, c) => Math.max(max, c.sortOrder), 0);
  const out: PlannedColumn[] = [];
  for (const p of missing.slice(0, room)) {
    let slug = p.slug;
    for (let n = 2; slugs.has(slug) && n < 100; n++) slug = `${p.slug.slice(0, 36).replace(/-+$/, '')}-${n}`;
    slugs.add(slug);
    next += OFFICIAL_SORT_STEP;
    out.push({ slug, name: p.name, description: p.description, sortOrder: next });
  }
  return out;
}

export async function applyColumnPresetsToZones(actorId: string): Promise<ApplyPresetsResult> {
  const presets = await prisma.zoneColumnPreset.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { name: true, description: true },
  });
  const result: ApplyPresetsResult = { zonesScanned: 0, zonesTouched: 0, columnsCreated: 0, zonesSkippedFull: 0 };
  if (presets.length === 0) return result;

  const zones = await prisma.zone.findMany({
    where: { deletedAt: null },
    take: ZONE_SCAN_MAX,
    select: { id: true, ZoneColumn: { select: { name: true, slug: true, official: true, sortOrder: true } } },
  });
  result.zonesScanned = zones.length;

  for (const zone of zones) {
    const plan = planPresetsForZone(zone.ZoneColumn, presets);
    if (plan === null) {
      result.zonesSkippedFull += 1;
      continue;
    }
    if (plan.length === 0) continue;
    // skipDuplicates: a concurrent composer creating the same slug simply wins.
    const r = await prisma.zoneColumn.createMany({
      data: plan.map((p) => ({ zoneId: zone.id, ...p, official: true, createdById: actorId || null })),
      skipDuplicates: true,
    });
    if (r.count > 0) {
      result.zonesTouched += 1;
      result.columnsCreated += r.count;
    }
  }
  return result;
}
