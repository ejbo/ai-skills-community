// 组织架构目录 — the admin write side (管理后台 → 技术专区 → 组织架构).
//
// The catalog is the STRUCTURE (which 研究所/实验室 exist, in what order, with
// what description); the 版块 rows carry the NAMES. Because the name is the join
// key (Zone.lab = 研究所, Zone.department = 实验室 — backwards column names, see
// lib/org.ts), a RENAME here must rewrite the matching Zone rows in the SAME
// transaction, or every board filed under the old spelling silently drops out
// of the rail. A DELETE deliberately leaves the rows alone: the board keeps its
// value and stays filterable as a live extra (lib/org.ts merge rules) — the
// admin sees the count and decides. The pure planners (`planInstituteRename`,
// `planLabRename`, `planReorder`) are what the tests pin; the DB code around
// them is thin.
//
// Every write ends with both invalidators: the catalog memo (org-catalog.ts)
// and the navbar tiles memo (labs.ts).

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ZoneError } from './errors';
import { invalidateZoneLabCards } from './labs';
import { invalidateOrgCatalog } from './org-catalog';
import { ZONE_LIMITS } from './shared';

/** A name must fit the Zone column it is stored in (labMax = departmentMax = 64). */
export const ORG_NAME_MAX = ZONE_LIMITS.labMax;
export const ORG_DESCRIPTION_MAX = 200;
export const ORG_IMAGE_URL_MAX = 500;
const MAX_INSTITUTES = 200;
const MAX_LABS_PER_INSTITUTE = 200;
const SORT_STEP = 10;

export interface OrgLabAdminRow {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  /** Live 版块 (deletedAt null) whose (研究所, 实验室) pair is exactly this lab. */
  zoneCount: number;
}

export interface OrgInstituteAdminRow {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  sortOrder: number;
  /** Live 版块 filed under this 研究所 (any 实验室, or none). */
  zoneCount: number;
  labs: OrgLabAdminRow[];
}

export function cleanOrgName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, ORG_NAME_MAX) : '';
}
function cleanDescription(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, ORG_DESCRIPTION_MAX) : '';
}
/** Root-relative (`/labs/x.jpg`, `/api/zones/media/…`) or http(s); anything else ⇒ null. */
export function cleanImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().slice(0, ORG_IMAGE_URL_MAX);
  if (!v) return null;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return null;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function invalidate(): void {
  invalidateOrgCatalog();
  invalidateZoneLabCards();
}

// ── Pure planners (tests/zone-org-admin.test.ts) ─────────────────────────────

export interface RenamePlan<W, D> {
  changed: boolean;
  where: W | null;
  data: D | null;
}

/**
 * What an institute rename must do to the 版块 rows: nothing when the name is
 * unchanged (whitespace-normalised compare), else rewrite `Zone.lab` from old
 * to new. Stored values are already trimmed by every writer, so the trimmed
 * compare matches the rows.
 */
export function planInstituteRename(oldName: string, newName: string): RenamePlan<{ lab: string }, { lab: string }> {
  const from = cleanOrgName(oldName);
  const to = cleanOrgName(newName);
  if (!to) throw new ZoneError('invalid_input', 400);
  if (from === to) return { changed: false, where: null, data: null };
  return { changed: true, where: { lab: from }, data: { lab: to } };
}

/** Same for a lab, scoped to rows under its own 研究所 — a same-named lab elsewhere is untouched. */
export function planLabRename(
  institute: string,
  oldName: string,
  newName: string,
): RenamePlan<{ lab: string; department: string }, { department: string }> {
  const from = cleanOrgName(oldName);
  const to = cleanOrgName(newName);
  if (!to) throw new ZoneError('invalid_input', 400);
  if (from === to) return { changed: false, where: null, data: null };
  return { changed: true, where: { lab: cleanOrgName(institute), department: from }, data: { department: to } };
}

/** ids in the requested order → sortOrder 10, 20, …; ids not in the list keep their relative place after. */
export function planReorder(requested: readonly string[], existingIds: readonly string[]): { id: string; sortOrder: number }[] {
  const known = new Set(existingIds);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of requested) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const id of existingIds) if (!seen.has(id)) ordered.push(id);
  return ordered.map((id, i) => ({ id, sortOrder: (i + 1) * SORT_STEP }));
}

const PAIR_SEP = '';

// ── Reads ────────────────────────────────────────────────────────────────────

export async function orgCatalogAdminTree(): Promise<OrgInstituteAdminRow[]> {
  const [institutes, pairs] = await Promise.all([
    prisma.orgInstitute.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: MAX_INSTITUTES,
      select: {
        id: true,
        name: true,
        description: true,
        imageUrl: true,
        sortOrder: true,
        labs: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: MAX_LABS_PER_INSTITUTE,
          select: { id: true, name: true, description: true, sortOrder: true },
        },
      },
    }),
    prisma.zone.groupBy({ by: ['lab', 'department'], where: { deletedAt: null }, _count: { _all: true } }),
  ]);
  const byInstitute = new Map<string, number>();
  const byPair = new Map<string, number>();
  for (const p of pairs) {
    const lab = (p.lab ?? '').trim();
    if (!lab) continue;
    byInstitute.set(lab, (byInstitute.get(lab) ?? 0) + p._count._all);
    const dept = (p.department ?? '').trim();
    if (dept) {
      const k = `${lab}${PAIR_SEP}${dept}`;
      byPair.set(k, (byPair.get(k) ?? 0) + p._count._all);
    }
  }
  return institutes.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    imageUrl: i.imageUrl,
    sortOrder: i.sortOrder,
    zoneCount: byInstitute.get(i.name) ?? 0,
    labs: i.labs.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      sortOrder: l.sortOrder,
      zoneCount: byPair.get(`${i.name}${PAIR_SEP}${l.name}`) ?? 0,
    })),
  }));
}

// ── Institutes ───────────────────────────────────────────────────────────────

export async function createInstitute(input: {
  name: string;
  description?: string;
  imageUrl?: string | null;
}): Promise<{ id: string; name: string }> {
  const name = cleanOrgName(input.name);
  if (!name) throw new ZoneError('invalid_input', 400);
  const count = await prisma.orgInstitute.count();
  if (count >= MAX_INSTITUTES) throw new ZoneError('org_full', 400);
  const last = await prisma.orgInstitute.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  try {
    const row = await prisma.orgInstitute.create({
      data: {
        name,
        description: cleanDescription(input.description),
        imageUrl: cleanImageUrl(input.imageUrl),
        sortOrder: (last?.sortOrder ?? 0) + SORT_STEP,
      },
      select: { id: true, name: true },
    });
    invalidate();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('name_taken', 409);
    throw e;
  }
}

export interface InstitutePatch {
  name?: string;
  description?: string;
  imageUrl?: string | null;
  sortOrder?: number;
}

/** Rename propagates to `Zone.lab` in the same transaction. Returns how many 版块 rows were rewritten. */
export async function updateInstitute(
  id: string,
  patch: InstitutePatch,
): Promise<{ renamedZones: number; before: string; after: string }> {
  const row = await prisma.orgInstitute.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!row) throw new ZoneError('not_found', 404);

  const data: Prisma.OrgInstituteUpdateInput = {};
  let plan: ReturnType<typeof planInstituteRename> | null = null;
  if (patch.name !== undefined) {
    plan = planInstituteRename(row.name, patch.name);
    if (plan.changed && plan.data) data.name = plan.data.lab;
  }
  if (patch.description !== undefined) data.description = cleanDescription(patch.description);
  if (patch.imageUrl !== undefined) data.imageUrl = cleanImageUrl(patch.imageUrl);
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    data.sortOrder = Math.max(0, Math.min(100_000, Math.trunc(patch.sortOrder)));
  }

  try {
    const renamedZones = await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) await tx.orgInstitute.update({ where: { id }, data });
      if (plan?.changed && plan.where && plan.data) {
        // Soft-deleted boards included: a restored board must land under the new name.
        const r = await tx.zone.updateMany({ where: plan.where, data: plan.data });
        return r.count;
      }
      return 0;
    });
    invalidate();
    return { renamedZones, before: row.name, after: plan?.changed && plan.data ? plan.data.lab : row.name };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('name_taken', 409);
    throw e;
  }
}

/** Labs cascade (FK). 版块 rows are untouched — the count tells the admin what keeps the name. */
export async function deleteInstitute(id: string): Promise<{ name: string; zonesKeepingName: number }> {
  const row = await prisma.orgInstitute.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!row) throw new ZoneError('not_found', 404);
  const zonesKeepingName = await prisma.zone.count({ where: { deletedAt: null, lab: row.name } });
  await prisma.orgInstitute.delete({ where: { id } });
  invalidate();
  return { name: row.name, zonesKeepingName };
}

export async function reorderInstitutes(ids: readonly string[]): Promise<void> {
  const existing = await prisma.orgInstitute.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const plan = planReorder(
    ids,
    existing.map((r) => r.id),
  );
  await prisma.$transaction(
    plan.map((p) => prisma.orgInstitute.update({ where: { id: p.id }, data: { sortOrder: p.sortOrder } })),
  );
  invalidate();
}

// ── Labs ─────────────────────────────────────────────────────────────────────

export async function createLab(
  instituteId: string,
  input: { name: string; description?: string },
): Promise<{ id: string; name: string; institute: string }> {
  const name = cleanOrgName(input.name);
  if (!name) throw new ZoneError('invalid_input', 400);
  const institute = await prisma.orgInstitute.findUnique({ where: { id: instituteId }, select: { id: true, name: true } });
  if (!institute) throw new ZoneError('not_found', 404);
  const count = await prisma.orgLab.count({ where: { instituteId } });
  if (count >= MAX_LABS_PER_INSTITUTE) throw new ZoneError('org_full', 400);
  const last = await prisma.orgLab.findFirst({
    where: { instituteId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  try {
    const row = await prisma.orgLab.create({
      data: {
        instituteId,
        name,
        description: cleanDescription(input.description),
        sortOrder: (last?.sortOrder ?? 0) + SORT_STEP,
      },
      select: { id: true, name: true },
    });
    invalidate();
    return { ...row, institute: institute.name };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('name_taken', 409);
    throw e;
  }
}

export interface LabPatch {
  name?: string;
  description?: string;
  sortOrder?: number;
}

/** Rename propagates to `Zone.department` for rows under the SAME 研究所. */
export async function updateLab(
  labId: string,
  patch: LabPatch,
): Promise<{ renamedZones: number; before: string; after: string; institute: string }> {
  const row = await prisma.orgLab.findUnique({
    where: { id: labId },
    select: { id: true, name: true, institute: { select: { name: true } } },
  });
  if (!row) throw new ZoneError('not_found', 404);

  const data: Prisma.OrgLabUpdateInput = {};
  let plan: ReturnType<typeof planLabRename> | null = null;
  if (patch.name !== undefined) {
    plan = planLabRename(row.institute.name, row.name, patch.name);
    if (plan.changed && plan.data) data.name = plan.data.department;
  }
  if (patch.description !== undefined) data.description = cleanDescription(patch.description);
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    data.sortOrder = Math.max(0, Math.min(100_000, Math.trunc(patch.sortOrder)));
  }

  try {
    const renamedZones = await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) await tx.orgLab.update({ where: { id: labId }, data });
      if (plan?.changed && plan.where && plan.data) {
        const r = await tx.zone.updateMany({ where: plan.where, data: plan.data });
        return r.count;
      }
      return 0;
    });
    invalidate();
    return {
      renamedZones,
      before: row.name,
      after: plan?.changed && plan.data ? plan.data.department : row.name,
      institute: row.institute.name,
    };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('name_taken', 409);
    throw e;
  }
}

export async function deleteLab(labId: string): Promise<{ name: string; institute: string; zonesKeepingName: number }> {
  const row = await prisma.orgLab.findUnique({
    where: { id: labId },
    select: { id: true, name: true, institute: { select: { name: true } } },
  });
  if (!row) throw new ZoneError('not_found', 404);
  const zonesKeepingName = await prisma.zone.count({
    where: { deletedAt: null, lab: row.institute.name, department: row.name },
  });
  await prisma.orgLab.delete({ where: { id: labId } });
  invalidate();
  return { name: row.name, institute: row.institute.name, zonesKeepingName };
}

export async function reorderLabs(instituteId: string, ids: readonly string[]): Promise<void> {
  const institute = await prisma.orgInstitute.findUnique({ where: { id: instituteId }, select: { id: true } });
  if (!institute) throw new ZoneError('not_found', 404);
  const existing = await prisma.orgLab.findMany({
    where: { instituteId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (existing.length === 0) return;
  const plan = planReorder(
    ids,
    existing.map((r) => r.id),
  );
  await prisma.$transaction(plan.map((p) => prisma.orgLab.update({ where: { id: p.id }, data: { sortOrder: p.sortOrder } })));
  invalidate();
}
