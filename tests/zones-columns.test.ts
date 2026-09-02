// 技术专区 栏目 service (lib/zones/columns.ts) against an in-memory prisma —
// pins the invariants 版块设置 → 栏目 relies on: delete moves posts + recounts,
// reorder writes 10/20/30 and ignores strangers, and a 版主 typing an existing
// member column PROMOTES it (`created:false`) instead of forking a twin. Also
// the pure list helpers the ColumnsEditor reduces its state with.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ColumnRow {
  id: string;
  zoneId: string;
  slug: string;
  name: string;
  description: string;
  official: boolean;
  sortOrder: number;
  postCount: number;
  createdById: string | null;
}

interface PostRow {
  id: string;
  zoneId: string;
  columnId: string | null;
  status: 'published' | 'draft';
  deletedAt: Date | null;
}

const db = vi.hoisted(() => {
  const state: { columns: ColumnRow[]; posts: PostRow[]; users: Record<string, string>; seq: number } = {
    columns: [],
    posts: [],
    users: {},
    seq: 0,
  };

  /** The subset of Prisma `where` the columns service uses: scalar eq, `in`, `not`, `OR`. */
  function matches(row: object, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === 'OR') {
        if (!(v as Record<string, unknown>[]).some((w) => matches(row, w))) return false;
        continue;
      }
      const actual = (row as Record<string, unknown>)[k];
      if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
        const op = v as { in?: unknown[]; not?: unknown };
        if ('in' in op && !op.in!.includes(actual)) return false;
        if ('not' in op && actual === op.not) return false;
        continue;
      }
      if (actual !== v) return false;
    }
    return true;
  }

  const withRelations = (row: ColumnRow) => ({
    ...row,
    createdBy: row.createdById ? { displayName: state.users[row.createdById] ?? 'someone' } : null,
  });

  const zoneColumn = {
    findMany: vi.fn(async ({ where }: any) => state.columns.filter((r) => matches(r, where)).map(withRelations)),
    findFirst: vi.fn(async ({ where }: any) => {
      const row = state.columns.find((r) => matches(r, where));
      return row ? withRelations(row) : null;
    }),
    findFirstOrThrow: vi.fn(async ({ where }: any) => {
      const row = state.columns.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      return withRelations(row);
    }),
    create: vi.fn(async ({ data }: any) => {
      const row: ColumnRow = {
        id: `c${++state.seq}`,
        description: '',
        postCount: 0,
        createdById: null,
        ...data,
      };
      state.columns.push(row);
      return withRelations(row);
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.columns.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return withRelations(row);
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of state.columns) {
        if (matches(r, where)) {
          Object.assign(r, data);
          count += 1;
        }
      }
      return { count };
    }),
    delete: vi.fn(async ({ where }: any) => {
      const at = state.columns.findIndex((r) => r.id === where.id);
      if (at < 0) throw new Error('not found');
      return state.columns.splice(at, 1)[0];
    }),
  };

  const zonePost = {
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const p of state.posts) {
        if (matches(p, where)) {
          Object.assign(p, data);
          count += 1;
        }
      }
      return { count };
    }),
    groupBy: vi.fn(async ({ where }: any) => {
      const counts = new Map<string | null, number>();
      for (const p of state.posts) {
        if (!matches(p, where)) continue;
        counts.set(p.columnId, (counts.get(p.columnId) ?? 0) + 1);
      }
      return [...counts].map(([columnId, n]) => ({ columnId, _count: { _all: n } }));
    }),
  };

  const client = {
    state,
    zoneColumn,
    zonePost,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return client;
});

vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  createOfficialColumn,
  deleteZoneColumn,
  getOrCreateColumn,
  listZoneColumns,
  reorderZoneColumns,
  updateZoneColumn,
} from '@/lib/zones/columns';
import { ZoneError } from '@/lib/zones/errors';
import { MAX_ZONE_COLUMNS } from '@/lib/zones/shared';
import type { ZoneColumnView } from '@/lib/zones/types';
import {
  moveColumn,
  movesToEnd,
  planOrderFlush,
  planOrderResponse,
  sameOrder,
  splitColumns,
  uncategorizedCount,
  upsertColumn,
  vanishedOnDelete,
} from '@/app/zones/_components/ColumnsEditor';
import { settingsTabsFor } from '@/app/zones/_components/settings-tabs';
import type { ZoneAccess, ZoneDetailView } from '@/lib/zones/types';

const ZONE = 'z1';

function column(partial: Partial<ColumnRow> & { name: string }): ColumnRow {
  const row: ColumnRow = {
    id: `seed${++db.state.seq}`,
    zoneId: ZONE,
    slug: partial.name.toLowerCase().replace(/\s+/g, '-'),
    description: '',
    official: true,
    sortOrder: 10,
    postCount: 0,
    createdById: null,
    ...partial,
  };
  db.state.columns.push(row);
  return row;
}

function post(columnId: string | null, status: PostRow['status'] = 'published', zoneId = ZONE): PostRow {
  const row: PostRow = { id: `p${++db.state.seq}`, zoneId, columnId, status, deletedAt: null };
  db.state.posts.push(row);
  return row;
}

const byId = (id: string) => db.state.columns.find((c) => c.id === id);

beforeEach(() => {
  db.state.columns = [];
  db.state.posts = [];
  db.state.users = { alice: 'Alice Wang' };
  db.state.seq = 0;
  vi.clearAllMocks();
});

describe('deleteZoneColumn', () => {
  it('moves the posts to the target column and recounts it', async () => {
    const a = column({ name: '模型评测', postCount: 2 });
    const b = column({ name: '论文导读', postCount: 1, sortOrder: 20 });
    post(a.id);
    post(a.id);
    post(a.id, 'draft'); // drafts move too, but never count
    post(b.id);

    await deleteZoneColumn(ZONE, a.id, { moveToColumnId: b.id });

    expect(byId(a.id)).toBeUndefined();
    expect(db.state.posts.every((p) => p.columnId === b.id)).toBe(true);
    expect(byId(b.id)?.postCount).toBe(3);
  });

  it('SetNulls the posts (未归栏) when no target is given', async () => {
    const a = column({ name: '模型评测', postCount: 2 });
    post(a.id);
    post(a.id);

    await deleteZoneColumn(ZONE, a.id);

    expect(byId(a.id)).toBeUndefined();
    expect(db.state.posts.map((p) => p.columnId)).toEqual([null, null]);
  });

  it('refuses the column itself and a target from another zone', async () => {
    const a = column({ name: '模型评测' });
    const foreign = column({ name: '别处', zoneId: 'z2' });
    await expect(deleteZoneColumn(ZONE, a.id, { moveToColumnId: a.id })).rejects.toMatchObject({ code: 'column_invalid_target' });
    await expect(deleteZoneColumn(ZONE, a.id, { moveToColumnId: foreign.id })).rejects.toMatchObject({ code: 'column_not_found' });
    expect(byId(a.id)).toBeDefined();
  });
});

describe('reorderZoneColumns', () => {
  it('writes 10 / 20 / 30 in the listed order and ignores unknown ids', async () => {
    const a = column({ name: 'A', sortOrder: 10 });
    const b = column({ name: 'B', sortOrder: 20 });
    const c = column({ name: 'C', sortOrder: 30 });
    const stranger = column({ name: 'X', zoneId: 'z2', sortOrder: 99 });

    await reorderZoneColumns(ZONE, [c.id, 'nope', a.id, stranger.id, b.id, a.id]);

    expect(byId(c.id)?.sortOrder).toBe(10);
    expect(byId(a.id)?.sortOrder).toBe(20);
    expect(byId(b.id)?.sortOrder).toBe(30);
    expect(byId(stranger.id)?.sortOrder).toBe(99);
    const listed = await listZoneColumns(ZONE);
    expect(listed.map((x) => x.name)).toEqual(['C', 'A', 'B']);
  });

  it('is a no-op on an empty list', async () => {
    column({ name: 'A', sortOrder: 40 });
    await reorderZoneColumns(ZONE, []);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('getOrCreateColumn', () => {
  it('promotes a same-named member column when asked for official and reports created:false', async () => {
    const mine = column({ name: '每周论文导读', official: false, sortOrder: 1000, createdById: 'alice' });

    const res = await getOrCreateColumn(ZONE, ' 每周  论文导读 ', { userId: 'mod', official: true, allowCreate: true });

    expect(res).toEqual({ id: mine.id, created: false });
    expect(byId(mine.id)?.official).toBe(true);
    expect(db.state.columns).toHaveLength(1);
  });

  it('creates an official column after the last official sortOrder, member columns at 1000', async () => {
    column({ name: 'A', sortOrder: 10 });
    column({ name: 'B', sortOrder: 20 });

    const official = await getOrCreateColumn(ZONE, '模型评测', { userId: 'mod', official: true, allowCreate: true });
    const member = await getOrCreateColumn(ZONE, 'RAG', { userId: 'alice', allowCreate: true });

    expect(official.created).toBe(true);
    expect(byId(official.id)).toMatchObject({ official: true, sortOrder: 30, slug: expect.any(String) });
    expect(member.created).toBe(true);
    expect(byId(member.id)).toMatchObject({ official: false, sortOrder: 1000, createdById: 'alice' });
  });

  it('refuses creation when the zone is full or the caller may not create', async () => {
    for (let i = 0; i < MAX_ZONE_COLUMNS; i++) column({ name: `col ${i}`, sortOrder: (i + 1) * 10 });
    await expect(getOrCreateColumn(ZONE, '新的', { userId: 'mod', official: true, allowCreate: true })).rejects.toMatchObject({
      code: 'columns_full',
    });
    await expect(getOrCreateColumn(ZONE, '另一个', { userId: 'bob', allowCreate: false })).rejects.toMatchObject({
      code: 'column_create_forbidden',
    });
    // …but picking an existing one is never gated.
    await expect(getOrCreateColumn(ZONE, 'col 3', { userId: 'bob', allowCreate: false })).resolves.toMatchObject({ created: false });
  });
});

describe('createOfficialColumn / updateZoneColumn', () => {
  it('stores the description and keeps the slug across a rename', async () => {
    const created = await createOfficialColumn(ZONE, { name: '模型评测', description: '  各类 benchmark 结果  ' }, 'mod');
    expect(created).toMatchObject({ name: '模型评测', description: '各类 benchmark 结果', official: true, createdBy: null });

    const renamed = await updateZoneColumn(ZONE, created.id, { name: '评测榜单' });
    expect(renamed.name).toBe('评测榜单');
    expect(renamed.slug).toBe(created.slug);
  });

  it('rejects a rename onto another column (409 column_exists) but allows re-casing itself', async () => {
    const a = column({ name: 'Agent 实践' });
    column({ name: 'RAG' });
    await expect(updateZoneColumn(ZONE, a.id, { name: 'rag' })).rejects.toBeInstanceOf(ZoneError);
    await expect(updateZoneColumn(ZONE, a.id, { name: 'rag' })).rejects.toMatchObject({ code: 'column_exists', status: 409 });
    await expect(updateZoneColumn(ZONE, a.id, { name: 'agent实践' })).resolves.toMatchObject({ name: 'agent实践' });
  });

  it('取消官方 keeps the row and lists it after every official column', async () => {
    const a = column({ name: 'A', sortOrder: 10 });
    const b = column({ name: 'B', sortOrder: 20, postCount: 5 });
    await updateZoneColumn(ZONE, a.id, { official: false });
    const listed = await listZoneColumns(ZONE);
    expect(listed.map((x) => [x.name, x.official])).toEqual([
      ['B', true],
      ['A', false],
    ]);
    expect(byId(b.id)?.postCount).toBe(5);
  });
});

// ── ColumnsEditor pure helpers ───────────────────────────────────────────────

const view = (id: string, official: boolean, postCount = 0): ZoneColumnView => ({
  id,
  slug: id,
  name: id,
  description: '',
  official,
  sortOrder: official ? 10 : 1000,
  postCount,
  createdBy: official ? null : 'Alice Wang',
});

describe('ColumnsEditor helpers', () => {
  it('splitColumns keeps each section in display order', () => {
    const list = [view('a', true), view('m1', false), view('b', true), view('m2', false)];
    const { official, member } = splitColumns(list);
    expect(official.map((c) => c.id)).toEqual(['a', 'b']);
    expect(member.map((c) => c.id)).toEqual(['m1', 'm2']);
  });

  it('moveColumn swaps with the neighbour and refuses to fall off either end', () => {
    const list = [view('a', true), view('b', true), view('c', true)];
    expect(moveColumn(list, 2, -1).map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(moveColumn(list, 0, 1).map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(moveColumn(list, 0, -1).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(moveColumn(list, 2, 1).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(sameOrder(moveColumn(list, 2, 1), list)).toBe(true);
    expect(sameOrder(moveColumn(list, 2, -1), list)).toBe(false);
  });

  it('upsertColumn replaces in place or appends', () => {
    const list = [view('a', true), view('b', true)];
    const renamed = { ...view('a', true), name: 'A!' };
    expect(upsertColumn(list, renamed).map((c) => c.name)).toEqual(['A!', 'b']);
    expect(upsertColumn(list, view('c', false)).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('uncategorizedCount is the zone total minus every column, floored at 0', () => {
    expect(uncategorizedCount(10, [view('a', true, 3), view('m', false, 2)])).toBe(5);
    expect(uncategorizedCount(2, [view('a', true, 3)])).toBe(0);
    expect(uncategorizedCount(4, [])).toBe(4);
  });

  it('movesToEnd says when the pressed arrow is about to disable (focus must go to its twin)', () => {
    // row 1 of 3 → top: ↑ disables; → bottom: ↓ disables.
    expect(movesToEnd(1, 3, -1)).toBe(true);
    expect(movesToEnd(1, 3, 1)).toBe(true);
    // row 2 of 5 stays inside either way: both arrows keep working.
    expect(movesToEnd(2, 5, -1)).toBe(false);
    expect(movesToEnd(2, 5, 1)).toBe(false);
    // a two-row list: every move lands at an end.
    expect(movesToEnd(1, 2, -1)).toBe(true);
    expect(movesToEnd(0, 2, 1)).toBe(true);
  });

  it('vanishedOnDelete tells the column apart from its move target after a 404', () => {
    const fresh = [view('a', true), view('b', true)];
    expect(vanishedOnDelete(fresh, 'a')).toBe('target');
    expect(vanishedOnDelete(fresh, 'zzz')).toBe('column');
  });
});

// ── Coalesced ↑/↓ reorder (one PATCH per quiet period, never a stale apply) ─────

describe('reorder session — planOrderFlush / planOrderResponse', () => {
  const a = view('a', true);
  const b = view('b', true);
  const c = view('c', true);

  it('sends only when a session is open and the order left the server order', () => {
    expect(planOrderFlush({ base: null, inFlight: false }, [b, a, c])).toBe('noop');
    expect(planOrderFlush({ base: [a, b, c], inFlight: false }, [a, b, c])).toBe('noop');
    expect(planOrderFlush({ base: [a, b, c], inFlight: false }, [b, a, c])).toBe('send');
  });

  it('defers while a PATCH is in flight — even when the order is back at base', () => {
    expect(planOrderFlush({ base: [a, b, c], inFlight: true }, [b, a, c])).toBe('defer');
    expect(planOrderFlush({ base: [a, b, c], inFlight: true }, [a, b, c])).toBe('defer');
  });

  it('a stale success (presses landed meanwhile) is rescheduled, never applied; a failure always rolls back', () => {
    expect(planOrderResponse(true, false)).toBe('apply');
    expect(planOrderResponse(true, true)).toBe('reschedule');
    expect(planOrderResponse(false, false)).toBe('rollback');
    expect(planOrderResponse(false, true)).toBe('rollback');
  });
});

// ── 版块设置 tab policy ──────────────────────────────────────────────────────

function accessWith(over: Partial<ZoneAccess>): ZoneDetailView {
  const access = {
    siteAdmin: false,
    isOwner: false,
    isMember: true,
    canRead: true,
    canManage: false,
    canModerate: false,
    canManageRoles: false,
    canManageMembers: false,
    ...over,
  } as ZoneAccess;
  return { access } as ZoneDetailView;
}

describe('settingsTabsFor — 栏目 gates on moderate, not manage', () => {
  it('a 版主 with moderate but no manage lands on 栏目 (the first allowed tab)', () => {
    const tabs = settingsTabsFor(accessWith({ canModerate: true }));
    expect(tabs).toEqual(['columns']);
    expect(tabs[0]).toBe('columns');
  });

  it('keeps the reading order basic → access → columns → roles → danger for an owner', () => {
    expect(settingsTabsFor(accessWith({ isOwner: true, canManage: true, canModerate: true, canManageRoles: true }))).toEqual([
      'basic',
      'access',
      'columns',
      'roles',
      'danger',
    ]);
  });

  it('a manager without moderate never sees 栏目', () => {
    expect(settingsTabsFor(accessWith({ canManage: true }))).toEqual(['basic', 'access']);
  });
});
