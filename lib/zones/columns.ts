// 技术专区 栏目 (ZoneColumn) — the zone-scoped content taxonomy.
//
// ORTHOGONAL to ZonePostType (which is the FORMAT: 文章 / 研究报告 / 论文 / …):
// a 栏目 is what the 版块 itself calls that stream of posts. 版主 curates the
// `official` ones in 版块设置; members may add their own from the composer when
// `Zone.allowMemberColumns` — which is why `getOrCreateColumn` takes an explicit
// `allowCreate` instead of re-deriving policy here (house rule: policy is
// decided once, in lib/zones/permissions.ts, and handed down as booleans).
//
// Two invariants worth keeping:
// - names dedupe case/space-insensitively (`columnDedupeKey`), so "大模型 推理"
//   and "大模型推理" never both exist; the SLUG is what URLs use and it never
//   changes on rename (post filters like `?column=<slug>` are shared links).
// - `postCount` is recomputed from rows (`recountZoneColumns`) inside the SAME
//   transaction as the post create / update / publish / delete that moved it —
//   never incremented blindly.

import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/lib/db';
import { ZoneError } from './errors';
import {
  MAX_ZONE_COLUMNS,
  ZONE_LIMITS,
  columnDedupeKey,
  columnSlugFrom,
  isValidColumnSlug,
  normalizeColumnName,
} from './shared';
import type { ZoneColumnView } from './types';

type Db = Prisma.TransactionClient | typeof prisma;

const randomSlugPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);
const COLUMN_SLUG_MAX = 40;
/** Official columns are hand-ordered in steps of 10 so a single insert never needs a full renumber. */
const OFFICIAL_SORT_STEP = 10;
/** Member-created columns sort after every official one; their list order is by postCount. */
const MEMBER_SORT_ORDER = 1_000;
const MAX_COLUMN_ROWS = MAX_ZONE_COLUMNS * 4;

const COLUMN_SELECT = {
  id: true,
  zoneId: true,
  slug: true,
  name: true,
  description: true,
  official: true,
  sortOrder: true,
  postCount: true,
  createdById: true,
  // Display name only — not an identity boundary (department / lab never ship here).
  createdBy: { select: { displayName: true } },
} satisfies Prisma.ZoneColumnSelect;

type ColumnRow = Prisma.ZoneColumnGetPayload<{ select: typeof COLUMN_SELECT }>;

export function toZoneColumnView(row: ColumnRow): ZoneColumnView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    official: row.official,
    sortOrder: row.sortOrder,
    postCount: row.postCount,
    createdBy: row.official ? null : (row.createdBy?.displayName ?? null),
  };
}

/** Official (hand-ordered) first, then member-created by postCount desc. */
function compareColumns(a: ColumnRow, b: ColumnRow): number {
  if (a.official !== b.official) return a.official ? -1 : 1;
  if (a.official) return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN');
  return b.postCount - a.postCount || a.name.localeCompare(b.name, 'zh-CN');
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function isSerializationFailure(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
}

function clampSortOrder(v: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100_000, Math.max(0, Math.trunc(n))) : MEMBER_SORT_ORDER;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listZoneColumns(zoneId: string, db: Db = prisma): Promise<ZoneColumnView[]> {
  if (!zoneId) return [];
  const rows = await db.zoneColumn.findMany({ where: { zoneId }, take: MAX_COLUMN_ROWS, select: COLUMN_SELECT });
  return rows.sort(compareColumns).map(toZoneColumnView);
}

export async function getZoneColumn(zoneId: string, columnId: string): Promise<ZoneColumnView | null> {
  const row = await prisma.zoneColumn.findFirst({ where: { id: columnId, zoneId }, select: COLUMN_SELECT });
  return row ? toZoneColumnView(row) : null;
}

/** Resolve a `?column=` value (slug OR id) to a row id inside this zone; null when unknown. */
export async function resolveColumnRef(zoneId: string, ref: string): Promise<string | null> {
  const value = (ref ?? '').trim().slice(0, 64);
  if (!value) return null;
  const row = await prisma.zoneColumn.findFirst({
    where: { zoneId, OR: [{ slug: value }, { id: value }] },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ── Create / get ─────────────────────────────────────────────────────────────

async function uniqueColumnSlug(db: Db, zoneId: string, base: string): Promise<string> {
  const start = base && isValidColumnSlug(base) ? base : `col-${randomSlugPart()}`;
  let candidate = start;
  for (let n = 2; n < 200; n++) {
    const clash = await db.zoneColumn.findFirst({ where: { zoneId, slug: candidate }, select: { id: true } });
    if (!clash) return candidate;
    const suffix = `-${n}`;
    candidate = `${start.slice(0, COLUMN_SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
  return `col-${randomSlugPart()}`;
}

/**
 * The composer's create-on-the-fly path. Dedupes on `columnDedupeKey` against
 * the zone's existing rows BEFORE creating anything, so typing an existing
 * 栏目 name just picks it. `allowCreate` is the caller's pre-decided policy
 * (`access.canModerate || zone.allowMemberColumns`).
 */
export async function getOrCreateColumn(
  zoneId: string,
  name: string,
  opts: { userId: string; official?: boolean; allowCreate: boolean },
): Promise<{ id: string; created: boolean }> {
  const clean = normalizeColumnName(name ?? '');
  if (!clean) throw new ZoneError('column_name_required', 400);
  const key = columnDedupeKey(clean);

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.zoneColumn.findMany({
            where: { zoneId },
            take: MAX_COLUMN_ROWS,
            select: { id: true, name: true, official: true, sortOrder: true },
          });
          const hit = existing.find((c) => columnDedupeKey(c.name) === key);
          if (hit) {
            // 版主 typing an existing member column promotes it instead of forking a twin.
            if (opts.official && !hit.official) {
              await tx.zoneColumn.update({ where: { id: hit.id }, data: { official: true } });
            }
            return { id: hit.id, created: false };
          }
          if (!opts.allowCreate) throw new ZoneError('column_create_forbidden', 403);
          if (existing.length >= MAX_ZONE_COLUMNS) throw new ZoneError('columns_full', 400);

          const slug = await uniqueColumnSlug(tx, zoneId, columnSlugFrom(clean));
          const nextOfficial =
            existing.filter((c) => c.official).reduce((max, c) => Math.max(max, c.sortOrder), 0) + OFFICIAL_SORT_STEP;
          const created = await tx.zoneColumn.create({
            data: {
              zoneId,
              slug,
              name: clean,
              official: !!opts.official,
              sortOrder: opts.official ? nextOfficial : MEMBER_SORT_ORDER,
              createdById: opts.userId || null,
            },
            select: { id: true },
          });
          return { id: created.id, created: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // A concurrent composer claimed the same slug / serialized differently:
      // retry so the second writer lands on the dedupe branch. A ZoneError is a
      // decision, never a race — it propagates untouched.
      if ((isSerializationFailure(e) || isUniqueViolation(e)) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 40));
        continue;
      }
      throw e;
    }
  }
}

/** 版块设置 → 栏目: create (or promote) an official column. */
export async function createOfficialColumn(
  zoneId: string,
  input: { name: string; description?: string },
  userId: string,
): Promise<ZoneColumnView> {
  const { id } = await getOrCreateColumn(zoneId, input.name, { userId, official: true, allowCreate: true });
  const description = (input.description ?? '').trim().slice(0, ZONE_LIMITS.columnDescriptionMax);
  if (description) await prisma.zoneColumn.update({ where: { id }, data: { description } });
  const row = await prisma.zoneColumn.findFirst({ where: { id, zoneId }, select: COLUMN_SELECT });
  if (!row) throw new ZoneError('column_not_found', 404);
  return toZoneColumnView(row);
}

// ── Update / delete / order ──────────────────────────────────────────────────

/**
 * Name / description / official / sortOrder. The SLUG is deliberately stable:
 * `?column=<slug>` links are shared, so a rename must not 404 them.
 */
export async function updateZoneColumn(
  zoneId: string,
  columnId: string,
  patch: { name?: string; description?: string; official?: boolean; sortOrder?: number },
): Promise<ZoneColumnView> {
  const row = await prisma.zoneColumn.findFirst({ where: { id: columnId, zoneId }, select: { id: true, name: true } });
  if (!row) throw new ZoneError('column_not_found', 404);

  const data: Prisma.ZoneColumnUpdateInput = {};
  if (patch.name !== undefined) {
    const clean = normalizeColumnName(patch.name);
    if (!clean) throw new ZoneError('column_name_required', 400);
    const key = columnDedupeKey(clean);
    if (key !== columnDedupeKey(row.name)) {
      const others = await prisma.zoneColumn.findMany({
        where: { zoneId, id: { not: columnId } },
        take: MAX_COLUMN_ROWS,
        select: { name: true },
      });
      if (others.some((o) => columnDedupeKey(o.name) === key)) throw new ZoneError('column_exists', 409);
    }
    data.name = clean;
  }
  if (patch.description !== undefined) {
    data.description = patch.description.trim().slice(0, ZONE_LIMITS.columnDescriptionMax);
  }
  if (patch.official !== undefined) data.official = patch.official;
  if (patch.sortOrder !== undefined) data.sortOrder = clampSortOrder(patch.sortOrder);

  const updated =
    Object.keys(data).length > 0
      ? await prisma.zoneColumn.update({ where: { id: columnId }, data, select: COLUMN_SELECT })
      : await prisma.zoneColumn.findFirstOrThrow({ where: { id: columnId, zoneId }, select: COLUMN_SELECT });
  return toZoneColumnView(updated);
}

/**
 * Delete a 栏目. Its posts move to `moveToColumnId` (must live in the same zone)
 * or fall back to 未归栏 (the FK is SetNull); both columns' counts are recomputed.
 */
export async function deleteZoneColumn(
  zoneId: string,
  columnId: string,
  opts: { moveToColumnId?: string | null } = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.zoneColumn.findFirst({ where: { id: columnId, zoneId }, select: { id: true } });
    if (!row) throw new ZoneError('column_not_found', 404);

    let moveTo: string | null = null;
    const target = (opts.moveToColumnId ?? '').trim();
    if (target) {
      if (target === columnId) throw new ZoneError('column_invalid_target', 400);
      const dest = await tx.zoneColumn.findFirst({ where: { id: target, zoneId }, select: { id: true } });
      if (!dest) throw new ZoneError('column_not_found', 404);
      moveTo = dest.id;
    }

    await tx.zonePost.updateMany({ where: { zoneId, columnId }, data: { columnId: moveTo } });
    await tx.zoneColumn.delete({ where: { id: columnId } });
    if (moveTo) await recountZoneColumns(zoneId, tx, [moveTo]);
  });
}

/** 版块设置 drag order: the listed ids get 10, 20, 30…; unknown ids are ignored. */
export async function reorderZoneColumns(zoneId: string, orderedIds: string[]): Promise<void> {
  const ids = [...new Set((orderedIds ?? []).map((s) => (s ?? '').trim()).filter(Boolean))].slice(0, MAX_COLUMN_ROWS);
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.zoneColumn.findMany({ where: { zoneId, id: { in: ids } }, select: { id: true } });
    const valid = new Set(rows.map((r) => r.id));
    let order = OFFICIAL_SORT_STEP;
    for (const id of ids) {
      if (!valid.has(id)) continue;
      await tx.zoneColumn.update({ where: { id }, data: { sortOrder: order } });
      order += OFFICIAL_SORT_STEP;
    }
  });
}

/**
 * `postCount` = published & not-deleted posts per column. Pass `columnIds` to
 * recount only the columns a write actually touched (the post layer does), and
 * `tx` to keep it inside that write's transaction.
 */
export async function recountZoneColumns(
  zoneId: string,
  tx?: Prisma.TransactionClient,
  columnIds?: readonly (string | null | undefined)[],
): Promise<void> {
  const db: Db = tx ?? prisma;
  const only = columnIds ? [...new Set(columnIds.filter((id): id is string => !!id))] : null;
  if (only && only.length === 0) return;

  const columns = await db.zoneColumn.findMany({
    where: { zoneId, ...(only ? { id: { in: only } } : {}) },
    take: MAX_COLUMN_ROWS,
    select: { id: true },
  });
  if (columns.length === 0) return;

  const grouped = await db.zonePost.groupBy({
    by: ['columnId'],
    where: { zoneId, status: 'published', deletedAt: null, columnId: { in: columns.map((c) => c.id) } },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const g of grouped) if (g.columnId) counts.set(g.columnId, g._count._all);

  // One statement per distinct count (usually 1–3), and only for rows that
  // actually differ — a recount on an unchanged column writes nothing.
  const byCount = new Map<number, string[]>();
  for (const c of columns) {
    const n = counts.get(c.id) ?? 0;
    const list = byCount.get(n);
    if (list) list.push(c.id);
    else byCount.set(n, [c.id]);
  }
  for (const [n, ids] of byCount) {
    await db.zoneColumn.updateMany({ where: { id: { in: ids }, postCount: { not: n } }, data: { postCount: n } });
  }
}
