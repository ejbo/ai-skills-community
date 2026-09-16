// 插入引用 as a content browser (lib/zones/embeds.ts#searchEmbedCandidates,
// GET /api/zones/embed/search, components/zones/embeds/embed-picker-helpers.ts).
//
// The search runs for real against an in-memory prisma that EVALUATES the
// where / orderBy / skip / take it is handed (a small Prisma-where interpreter
// below), so what is pinned is the query the code actually builds: the gate is
// ANDed into every phase (a 书架 doc that went private, a bookmarked post that
// was deleted never comes back through 我的收藏), 全部 is 自己的在前 with no
// duplicates and no gaps across pages, and the favourite flags cost one query
// per page. EVERY gate is the REAL one (importOriginal): the library / skill
// constants, and `readableZoneWhere` / `zonePostVisibilityWhere` from
// lib/zones/post-queries — the circular import back into this module resolves
// fine under a partial mock, and a copy of those two helpers had already
// drifted (it was missing the 版主 branch).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const OPS = new Set(['not', 'in', 'notIn', 'contains', 'mode', 'equals', 'some', 'none', 'every', 'is', 'isNot', 'has', 'gt', 'gte', 'lt', 'lte']);

  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

  // SQL three-valued logic, as far as these queries need it: a comparison
  // against NULL is UNKNOWN (not FALSE), and `NOT UNKNOWN` is UNKNOWN — the row
  // is filtered OUT rather than admitted. Plain boolean evaluation would report
  // `NOT x` as the exact complement of `x`, which Postgres does not, and that is
  // precisely how a past all-day event with no `endAt` fell out of BOTH halves
  // of the 活动 最新 split on the real database.
  let nullCompare = false;

  function fieldMatches(value: unknown, cond: unknown): boolean {
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return same(value, cond);
    const c = cond as Record<string, unknown>;
    const keys = Object.keys(c);
    if (keys.length > 0 && keys.every((k) => OPS.has(k))) {
      return keys.every((k) => {
        const arg = c[k];
        switch (k) {
          case 'not':
            return arg !== null && typeof arg === 'object' && !(arg instanceof Date) ? !fieldMatches(value, arg) : !same(value, arg);
          case 'equals':
            return same(value, arg);
          case 'in':
            return (arg as unknown[]).some((v) => same(v, value));
          case 'notIn':
            return !(arg as unknown[]).some((v) => same(v, value));
          case 'contains':
            return typeof value === 'string' && value.toLowerCase().includes(String(arg).toLowerCase());
          case 'mode':
            return true;
          case 'some':
            return Array.isArray(value) && value.some((v) => matches(v as Row, arg as Where));
          case 'none':
            return Array.isArray(value) && !value.some((v) => matches(v as Row, arg as Where));
          case 'every':
            return Array.isArray(value) && value.every((v) => matches(v as Row, arg as Where));
          case 'is':
            return value != null && matches(value as Row, arg as Where);
          case 'isNot':
            return value == null || !matches(value as Row, arg as Where);
          case 'has':
            return Array.isArray(value) && value.includes(arg);
          // ANY comparison against NULL is UNKNOWN, so the row does not match
          // and the surrounding NOT (if any) cannot flip it to a match. Raw JS
          // would coerce `null < someDate` to true and hide these bugs.
          case 'gt':
          case 'gte':
          case 'lt':
          case 'lte': {
            if (value == null) {
              nullCompare = true;
              return false;
            }
            const a = value as number;
            const b = arg as number;
            return k === 'gt' ? a > b : k === 'gte' ? a >= b : k === 'lt' ? a < b : a <= b;
          }
          default:
            throw new Error(`unsupported operator ${k}`);
        }
      });
    }
    // A to-one relation filter (`zone: { deletedAt: null, OR: [...] }`).
    return value != null && typeof value === 'object' && matches(value as Row, c);
  }

  function matches(row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'AND') {
        const list = (Array.isArray(cond) ? cond : [cond]) as Where[];
        if (!list.every((w) => matches(row, w))) return false;
      } else if (key === 'OR') {
        if (!(cond as Where[]).some((w) => matches(row, w))) return false;
      } else if (key === 'NOT') {
        const list = (Array.isArray(cond) ? cond : [cond]) as Where[];
        const outer = nullCompare;
        nullCompare = false;
        const hit = list.some((w) => matches(row, w));
        const unknown = nullCompare;
        nullCompare = outer;
        // `NOT TRUE` = FALSE, `NOT UNKNOWN` = UNKNOWN — neither admits the row.
        if (hit || unknown) return false;
      } else if (!fieldMatches(row[key], cond)) {
        return false;
      }
    }
    return true;
  }

  interface SortSpec {
    path: string[];
    dir: 'asc' | 'desc';
    nulls: 'first' | 'last';
  }

  function specsOf(entry: Record<string, unknown>, prefix: string[] = []): SortSpec[] {
    return Object.entries(entry).flatMap(([k, v]) => {
      if (v === 'asc' || v === 'desc') return [{ path: [...prefix, k], dir: v, nulls: v === 'desc' ? 'first' : 'last' } as SortSpec];
      const o = v as Record<string, unknown>;
      if (o.sort === 'asc' || o.sort === 'desc') {
        // Postgres default: NULLS FIRST for DESC, NULLS LAST for ASC.
        const nulls = (o.nulls as 'first' | 'last' | undefined) ?? (o.sort === 'desc' ? 'first' : 'last');
        return [{ path: [...prefix, k], dir: o.sort, nulls } as SortSpec];
      }
      return specsOf(o, [...prefix, k]);
    });
  }

  const at = (row: Row, path: string[]) => path.reduce<unknown>((v, k) => (v == null ? v : (v as Row)[k]), row);
  const num = (v: unknown) => (v instanceof Date ? v.getTime() : v);

  function sortRows(rows: Row[], orderBy: unknown): Row[] {
    const specs = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((e) => specsOf(e as Record<string, unknown>));
    return rows.slice().sort((a, b) => {
      for (const s of specs) {
        const av = num(at(a, s.path));
        const bv = num(at(b, s.path));
        if (av == null && bv == null) continue;
        if (av == null) return s.nulls === 'first' ? -1 : 1;
        if (bv == null) return s.nulls === 'first' ? 1 : -1;
        if (av === bv) continue;
        const lt = (av as number | string) < (bv as number | string);
        return (lt ? -1 : 1) * (s.dir === 'asc' ? 1 : -1);
      }
      return 0;
    });
  }

  const tables: Record<string, Row[]> = {};
  const calls: { model: string; args: { where?: Where; orderBy?: unknown; skip?: number; take?: number } }[] = [];
  const failing = { model: '' };

  function model(name: string) {
    return {
      findMany: async (args: { where?: Where; orderBy?: unknown; skip?: number; take?: number } = {}) => {
        calls.push({ model: name, args });
        if (failing.model === name) throw new Error('db down');
        const hits = sortRows((tables[name] ?? []).filter((r) => matches(r, args.where)), args.orderBy);
        const skip = args.skip ?? 0;
        return hits.slice(skip, args.take === undefined ? undefined : skip + args.take);
      },
    };
  }

  const prisma = Object.fromEntries(
    ['libraryDoc', 'libraryShelfItem', 'video', 'videoFavorite', 'skill', 'favorite', 'skillPack', 'event', 'eventAttendee', 'zonePost', 'zonePostBookmark'].map(
      (n) => [n, model(n)],
    ),
  );

  return { tables, calls, failing, prisma, matches, sortRows };
});

const state = vi.hoisted(() => ({ session: { user: { id: 'me' } } as { user: { id: string } } | null }));

vi.mock('@/lib/db', () => ({ prisma: fake.prisma }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => state.session) }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'zh-CN') }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: 0 })) }));
vi.mock('@/lib/library-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/library-queries')>()),
}));
vi.mock('@/lib/skill-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/skill-queries')>()),
}));
vi.mock('@/lib/zones/access', () => ({
  ZONE_ACCESS_SELECT: {},
  resolveZoneAccess: vi.fn(),
  zoneSiteViewer: (user: { id: string } | null) => ({ id: user?.id ?? null, siteAdmin: false, canSeeIdentity: false }),
}));
// The zone gates are the REAL ones: a hand-copied `zonePostVisibilityWhere`
// had already lost the 版主 branch, so the picker's post gate was pinned
// against a rule that no longer existed. Only the three members this suite
// never calls are stubbed (they would pull in the office-preview pipeline).
vi.mock('@/lib/zones/post-queries', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/zones/post-queries')>();
  return {
    ZONE_POST_ACCESS_SELECT: {},
    canSeeZonePost: vi.fn(),
    toAttachmentView: vi.fn(),
    readableZoneWhere: real.readableZoneWhere,
    zonePostVisibilityWhere: real.zonePostVisibilityWhere,
  };
});
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
// The REAL upcomingWhere() — 活动 under 最新 splits on it, and a hand-written
// copy here would let the two drift (it is the /events 即将举行 boundary).
vi.mock('@/lib/event-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/event-queries')>()),
  eventViewerFromSession: vi.fn(),
  getEventDetail: vi.fn(),
}));
vi.mock('@/lib/pack-queries', () => ({ INSTALLABLE_SKILL_WHERE: {} }));
vi.mock('@/lib/video/access', () => ({ canViewVideo: vi.fn(), videoActorFrom: vi.fn() }));
vi.mock('@/lib/video/queries', () => ({ VIDEO_DETAIL_INCLUDE: {} }));
vi.mock('@/lib/video/shorts-queries', () => ({ SHORT_FEED_SELECT: {}, annotateShortsViewer: vi.fn(), toShortView: vi.fn() }));
vi.mock('@/lib/zones/link-preview', () => ({ getLinkPreview: vi.fn(), linkPreviewHash: vi.fn() }));

import { GET } from '@/app/api/zones/embed/search/route';
import {
  EMBED_SEARCH_MAX_OFFSET,
  EMBED_SEARCH_PAGE_SIZE,
  decodeEmbedSearchCursor,
  encodeEmbedSearchCursor,
  firstNonBlank,
  pagingForSort,
  paginateEmbedPhases,
  parseEmbedSearchScope,
  parseEmbedSearchSort,
  phaseGroup,
  phaseSlice,
  phasesFor,
  scopesForKind,
  type EmbedPhasePosition,
  type EmbedSearchCursor,
  type EmbedSearchPhase,
  type EmbedSearchScope,
  type EmbedSearchSort,
  type SearchableEmbedKind,
} from '@/lib/zones/embed-search-shared';
import { searchEmbedCandidates, type EmbedContext } from '@/lib/zones/embeds';
import { BROWSABLE_DOC_WHERE } from '@/lib/library-queries';
import { DISCOVERABLE_SKILL_WHERE } from '@/lib/skill-queries';
import type { EmbedCandidate } from '@/lib/zones/types';
import {
  INITIAL_PICKER_LIST,
  KEYBOARD_PREFETCH_ROWS,
  appendCandidates,
  canAutoLoadMore,
  effectiveScope,
  embedSearchUrl,
  favBadgeLabelKey,
  favScopeLabelKey,
  isPickerListCapped,
  isPickerListEnd,
  parseEmbedSearchPage,
  pickerListReducer,
  scopeLabelKey,
  searchResultsArePending,
  shouldPrefetchForActive,
  type PickerListState,
} from '@/components/zones/embeds/embed-picker-helpers';

const ME = 'me';
const d = (iso: string) => new Date(`${iso}T08:00:00.000Z`);
const ctx = (id: string | null = ME): EmbedContext => ({ viewer: { id, siteAdmin: false, canSeeIdentity: false }, session: null, locale: 'zh-CN' });

// ── fixtures ─────────────────────────────────────────────────────────────────

function doc(id: string, over: Row & { shelvedBy?: string[] }): Row {
  const { shelvedBy = [], ...rest } = over;
  return {
    id,
    slug: `slug-${id}`,
    title: `Doc ${id}`,
    author: null,
    summary: '',
    summaryEn: '',
    coverUrl: null,
    status: 'ready',
    deletedAt: null,
    visibility: 'public',
    uploaderId: 'other',
    uploader: { displayName: 'Uploader' },
    viewCount: 0,
    shelfCount: 0,
    likeCount: 0,
    createdAt: d('2026-09-01'),
    shelfItems: shelvedBy.map((userId) => ({ userId, docId: id })),
    ...rest,
  };
}

function seedLibrary() {
  fake.tables.libraryDoc = [
    doc('d1', { uploaderId: ME, createdAt: d('2026-09-10'), viewCount: 5 }),
    doc('d2', { uploaderId: ME, createdAt: d('2026-09-12'), viewCount: 50, visibility: 'restricted' }),
    doc('d3', { uploaderId: ME, createdAt: d('2026-09-13'), visibility: 'private' }),
    doc('d4', { createdAt: d('2026-09-14'), viewCount: 1, shelvedBy: [ME] }),
    doc('d5', { createdAt: d('2026-09-02'), viewCount: 100, title: '', summary: '一句话摘要' }),
    doc('d6', { createdAt: d('2026-09-15'), deletedAt: d('2026-09-15'), shelvedBy: [ME] }),
    doc('d7', { createdAt: d('2026-09-15'), status: 'pending', shelvedBy: [ME] }),
    doc('d8', { createdAt: d('2026-09-15'), visibility: 'private', shelvedBy: [ME] }),
  ];
  fake.tables.libraryShelfItem = fake.tables.libraryDoc.flatMap((r) => r.shelfItems as Row[]);
}

const zones = {
  pub: { id: 'z1', name: '边缘推理', visibility: 'public', ownerId: 'owner', deletedAt: null, members: [] },
  locked: { id: 'z2', name: '闭门版块', visibility: 'members', ownerId: 'owner', deletedAt: null, members: [] },
  joined: { id: 'z3', name: '我加入的', visibility: 'members', ownerId: 'owner', deletedAt: null, members: [{ userId: ME, status: 'active' }] },
  gone: { id: 'z4', name: '已删除', visibility: 'public', ownerId: 'owner', deletedAt: d('2026-09-01'), members: [] },
  // The viewer is 版主 here — a role carrying `moderate`, which is the branch a
  // hand-copied gate had lost.
  modded: {
    id: 'z5',
    name: '我当版主',
    visibility: 'public',
    ownerId: 'owner',
    deletedAt: null,
    members: [{ userId: ME, status: 'active', role: { permissions: ['moderate'] } }],
  },
};

function post(id: string, over: Row & { bookmarkedBy?: string[] }): Row {
  const { bookmarkedBy = [], ...rest } = over;
  return {
    id,
    title: `Post ${id}`,
    summary: '',
    coverUrl: null,
    authorId: 'other',
    author: { displayName: 'Someone' },
    status: 'published',
    deletedAt: null,
    visibility: 'zone',
    publishedAt: d('2026-09-01'),
    editedAt: null,
    createdAt: d('2026-09-01'),
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    coauthors: [],
    viewers: [],
    zone: zones.pub,
    bookmarks: bookmarkedBy.map((userId) => ({ userId, postId: id })),
    ...rest,
  };
}

function seedPosts() {
  fake.tables.zonePost = [
    post('p1', { authorId: ME, publishedAt: d('2026-09-03'), likeCount: 1 }),
    post('p2', { coauthors: [{ userId: ME }], publishedAt: d('2026-09-05'), editedAt: d('2026-09-14') }),
    post('p3', { zone: zones.locked, bookmarkedBy: [ME], publishedAt: d('2026-09-10') }),
    post('p4', { zone: zones.joined, visibility: 'members', publishedAt: d('2026-09-08'), likeCount: 9 }),
    post('p5', { deletedAt: d('2026-09-12'), bookmarkedBy: [ME], publishedAt: d('2026-09-11') }),
    post('p6', { visibility: 'restricted', bookmarkedBy: [ME], publishedAt: d('2026-09-12') }),
    post('p7', { status: 'draft', publishedAt: null, bookmarkedBy: [ME] }),
    post('p8', { bookmarkedBy: [ME], publishedAt: d('2026-09-09'), likeCount: 3 }),
    post('p9', { zone: zones.gone, bookmarkedBy: [ME], publishedAt: d('2026-09-13') }),
  ];
  fake.tables.zonePostBookmark = fake.tables.zonePost.flatMap((r) => r.bookmarks as Row[]);
}

async function walk(kind: SearchableEmbedKind, scope: EmbedSearchScope, sort: EmbedSearchSort, pageSize: number, q = '') {
  const pages: EmbedCandidate[][] = [];
  let cursor: EmbedSearchCursor | null = null;
  for (let i = 0; i < 50; i++) {
    const page = await searchEmbedCandidates(kind, { q, scope, sort, cursor, pageSize }, ctx());
    pages.push(page.items);
    if (!page.nextCursor) return pages;
    cursor = decodeEmbedSearchCursor(page.nextCursor, phasesFor(kind, scope, sort), pagingForSort(sort));
    expect(cursor, page.nextCursor).not.toBeNull();
  }
  throw new Error('pager never ended');
}

const refs = (items: EmbedCandidate[]) => items.map((c) => c.ref);

beforeEach(() => {
  for (const k of Object.keys(fake.tables)) delete fake.tables[k];
  fake.calls.length = 0;
  fake.failing.model = '';
  state.session = { user: { id: ME } };
});

// ── contract ─────────────────────────────────────────────────────────────────

describe('scopes, sorts and phases', () => {
  it('offers 我发布的 / 我的收藏 for every kind with a publisher and a save, and only 全部 for packs', () => {
    for (const k of ['library', 'short', 'video', 'skill', 'event', 'post'] as const) expect(scopesForKind(k)).toEqual(['all', 'mine', 'fav']);
    expect(scopesForKind('pack')).toEqual(['all']);
  });

  it('parses scope and sort with defaults, rejecting values a kind does not offer', () => {
    expect(parseEmbedSearchScope('library', null)).toBe('all');
    expect(parseEmbedSearchScope('library', 'fav')).toBe('fav');
    expect(parseEmbedSearchScope('pack', 'mine')).toBeNull();
    expect(parseEmbedSearchScope('pack', 'fav')).toBeNull();
    expect(parseEmbedSearchScope('post', 'everything')).toBeNull();
    expect(parseEmbedSearchSort(null)).toBe('new');
    expect(parseEmbedSearchSort('hot')).toBe('hot');
    expect(parseEmbedSearchSort('top')).toBeNull();
  });

  it('maps 全部 to mine → rest, and to a single un-split phase for packs', () => {
    expect(phasesFor('post', 'all')).toEqual(['mine', 'rest']);
    expect(phasesFor('post', 'mine')).toEqual(['mine']);
    expect(phasesFor('post', 'fav')).toEqual(['fav']);
    expect(phasesFor('pack', 'all')).toEqual(['all']);
    expect(phasesFor('pack', 'mine')).toEqual([]);
  });

  it('splits 活动 under 最新 into 即将举行 then 已结束, inside每个 publisher group — and nowhere else', () => {
    expect(phasesFor('event', 'all', 'new')).toEqual(['mine:up', 'mine:past', 'rest:up', 'rest:past']);
    expect(phasesFor('event', 'fav', 'new')).toEqual(['fav:up', 'fav:past']);
    // 最热 ranks by attendeeCount across the whole set — no time split.
    expect(phasesFor('event', 'all', 'hot')).toEqual(['mine', 'rest']);
    // No other kind slices.
    expect(phasesFor('post', 'all', 'new')).toEqual(['mine', 'rest']);
    expect(phaseGroup('rest:past')).toBe('rest');
    expect(phaseSlice('rest:past')).toBe('past');
    expect(phaseGroup('rest')).toBe('rest');
    expect(phaseSlice('rest')).toBeNull();
  });

  it('firstNonBlank falls through blank strings and nullish values', () => {
    expect(firstNonBlank('  ', null, undefined, ' 摘要 ', 'x')).toBe('摘要');
    expect(firstNonBlank('', null)).toBe('');
  });
});

describe('cursor codec', () => {
  const phases: readonly EmbedSearchPhase[] = ['mine', 'rest'];
  const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('round-trips an offset cursor (最热) and stays URL-safe', () => {
    for (const c of [{ phase: 'mine', offset: 0 }, { phase: 'rest', offset: 40 }, { phase: 'rest', offset: EMBED_SEARCH_MAX_OFFSET }] as EmbedSearchCursor[]) {
      const raw = encodeEmbedSearchCursor(c);
      expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeEmbedSearchCursor(raw, phases, 'offset')).toEqual(c);
    }
  });

  it('round-trips a keyset cursor (最新), including a NULL key and the start of a phase', () => {
    const cursors: EmbedSearchCursor[] = [
      { phase: 'mine', after: { at: d('2026-09-12'), id: 'cmtbw9tnq0019xz8mzjnhnfna' } },
      { phase: 'rest', after: { at: null, id: 'p7' } },
      { phase: 'rest', after: null },
    ];
    for (const c of cursors) {
      const raw = encodeEmbedSearchCursor(c);
      expect(raw.length).toBeLessThanOrEqual(200);
      expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeEmbedSearchCursor(raw, phases, 'keyset')).toEqual(c);
    }
  });

  it('never reinterprets a cursor minted for the other sort', () => {
    const offset = encodeEmbedSearchCursor({ phase: 'rest', offset: 20 });
    const keyset = encodeEmbedSearchCursor({ phase: 'rest', after: { at: d('2026-09-12'), id: 'x1' } });
    expect(decodeEmbedSearchCursor(offset, phases, 'keyset')).toBeNull();
    expect(decodeEmbedSearchCursor(keyset, phases, 'offset')).toBeNull();
  });

  it('rejects garbage', () => {
    const bad = [
      '',
      'not base64!',
      'a'.repeat(300),
      btoa('hello world'),
      enc([1, 2]),
      enc({ v: 1, p: 'mine', o: 0 }), // the v1 (pre-keyset) shape
      enc({ v: 3, p: 'mine', o: 0 }),
      enc({ v: 2, p: 'fav', o: 0 }), // a 我的收藏 cursor replayed against 全部
      enc({ v: 2, p: 'mine', o: -1 }),
      enc({ v: 2, p: 'mine', o: 1.5 }),
      enc({ v: 2, p: 'mine', o: '20' }),
      enc({ v: 2, p: 'mine', o: EMBED_SEARCH_MAX_OFFSET + 1 }),
      enc({ v: 2, p: 'toString', o: 0 }),
    ];
    for (const raw of bad) expect(decodeEmbedSearchCursor(raw, phases, 'offset'), raw).toBeNull();

    const badKeys = [
      enc({ v: 2, p: 'mine' }),
      enc({ v: 2, p: 'mine', k: 'no-separator' }),
      enc({ v: 2, p: 'mine', k: '2026-09-12T00:00:00.000Z|' }),
      enc({ v: 2, p: 'mine', k: '2026-09-12T00:00:00.000Z|../../etc' }),
      enc({ v: 2, p: 'mine', k: 'not-a-date|abc' }),
      enc({ v: 2, p: 'mine', k: 42 }),
      enc({ v: 2, p: 'toString', k: null }),
    ];
    for (const raw of badKeys) expect(decodeEmbedSearchCursor(raw, phases, 'keyset'), raw).toBeNull();
  });
});

describe('paginateEmbedPhases', () => {
  const source = (sizes: Partial<Record<EmbedSearchPhase, number>>) => {
    const probes: string[] = [];
    const fetch = async (phase: EmbedSearchPhase, position: EmbedPhasePosition, take: number) => {
      const skip = 'after' in position ? 0 : position.offset;
      probes.push(`${phase}:${skip}:${take}`);
      const all = Array.from({ length: sizes[phase] ?? 0 }, (_, i) => `${phase}-${i}`);
      return all.slice(skip, skip + take);
    };
    return { fetch, probes };
  };

  async function drain(phases: EmbedSearchPhase[], sizes: Partial<Record<EmbedSearchPhase, number>>, pageSize: number) {
    const { fetch } = source(sizes);
    const pages: string[][] = [];
    let cursor: EmbedSearchCursor | null = null;
    for (let i = 0; i < 100; i++) {
      const { rows, next } = await paginateEmbedPhases(phases, cursor, pageSize, fetch);
      pages.push(rows);
      if (!next) return pages;
      // Every cursor survives the wire.
      cursor = decodeEmbedSearchCursor(encodeEmbedSearchCursor(next), phases, 'offset');
    }
    throw new Error('never ended');
  }

  it('lists every mine row before every rest row, with no duplicates and no gaps', async () => {
    for (const [mine, rest, size] of [
      [25, 33, 20],
      [20, 7, 20],
      [0, 45, 20],
      [3, 0, 20],
      [7, 5, 3],
      [40, 40, 20],
    ] as const) {
      const pages = await drain(['mine', 'rest'], { mine, rest }, size);
      const flat = pages.flat();
      const expected = [...Array.from({ length: mine }, (_, i) => `mine-${i}`), ...Array.from({ length: rest }, (_, i) => `rest-${i}`)];
      expect(flat, `${mine}/${rest}/${size}`).toEqual(expected);
      expect(new Set(flat).size).toBe(flat.length);
      // Every page but the last is full, and the last is never empty unless everything is.
      for (const p of pages.slice(0, -1)) expect(p).toHaveLength(size);
      if (expected.length > 0) expect(pages.at(-1)!.length).toBeGreaterThan(0);
    }
  });

  it('probes the next phase with take 1 when a page fills exactly at a boundary', async () => {
    const empty = source({ mine: 20, rest: 0 });
    const first = await paginateEmbedPhases(['mine', 'rest'], null, 20, empty.fetch);
    expect(first.rows).toHaveLength(20);
    expect(first.next).toBeNull(); // no cursor to an empty page
    expect(first.truncated).toBe(false);
    expect(empty.probes).toEqual(['mine:0:21', 'rest:0:1']);

    const more = source({ mine: 20, rest: 2 });
    const page = await paginateEmbedPhases(['mine', 'rest'], null, 20, more.fetch);
    expect(page.next).toEqual({ phase: 'rest', offset: 0 });
  });

  it('continues from the cursor phase and offset', async () => {
    const s = source({ mine: 5, rest: 50 });
    const { rows, next } = await paginateEmbedPhases(['mine', 'rest'], { phase: 'rest', offset: 20 }, 20, s.fetch);
    expect(rows[0]).toBe('rest-20');
    expect(next).toEqual({ phase: 'rest', offset: 40 });
    expect(s.probes).toEqual(['rest:20:21']);
  });

  it('says TRUNCATED when the offset cap — not the data — ends the stream', async () => {
    // Rows remain past the cap, so `next: null` alone would be a lie: the dialog
    // would render 已经到底了 over a list that is missing everything after 2000.
    const deep = source({ rest: EMBED_SEARCH_MAX_OFFSET + 500 });
    const atCap = await paginateEmbedPhases(['rest'], { phase: 'rest', offset: EMBED_SEARCH_MAX_OFFSET }, 20, deep.fetch);
    expect(atCap.rows).toHaveLength(20);
    expect(atCap.next).toBeNull();
    expect(atCap.truncated).toBe(true);
    // The real end of the data is NOT a truncation.
    const exact = source({ rest: EMBED_SEARCH_MAX_OFFSET + 10 });
    const last = await paginateEmbedPhases(['rest'], { phase: 'rest', offset: EMBED_SEARCH_MAX_OFFSET - 10 }, 20, exact.fetch);
    expect(last.next).toBeNull();
    expect(last.truncated).toBe(false);
  });

  it('keyset paging carries the last row of the page, never an offset', async () => {
    // Newest first, exactly as `[<key> desc, id desc]` would serve them.
    const desc = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, at: d(`2026-09-0${i + 1}`) })).reverse();
    const seen: EmbedPhasePosition[] = [];
    const fetch = async (_phase: EmbedSearchPhase, position: EmbedPhasePosition, take: number) => {
      seen.push(position);
      const after = 'after' in position ? position.after : null;
      const rest = after ? desc.filter((r) => r.at < after.at! || (r.at.getTime() === after.at!.getTime() && r.id < after.id)) : desc;
      return rest.slice(0, take);
    };
    const keyOf = (r: { id: string; at: Date }) => ({ at: r.at, id: r.id });
    const first = await paginateEmbedPhases(['all'], null, 3, fetch, { paging: 'keyset', keyOf });
    expect(first.rows.map((r) => r.id)).toEqual(['r6', 'r5', 'r4']);
    expect(first.next).toEqual({ phase: 'all', after: { at: d('2026-09-05'), id: 'r4' } });
    expect(first.truncated).toBe(false);
    expect(seen[0]).toEqual({ after: null });

    const second = await paginateEmbedPhases(['all'], first.next, 3, fetch, { paging: 'keyset', keyOf });
    expect(second.rows.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });
});

// ── server search ────────────────────────────────────────────────────────────

describe('searchEmbedCandidates — library', () => {
  it('全部 lists own docs first, then everyone else, each part in the chosen sort', async () => {
    seedLibrary();
    const newest = await searchEmbedCandidates('library', { scope: 'all', sort: 'new' }, ctx());
    expect(refs(newest.items)).toEqual(['slug-d2', 'slug-d1', 'slug-d4', 'slug-d5']);
    expect(newest.nextCursor).toBeNull();
    const hot = await searchEmbedCandidates('library', { scope: 'all', sort: 'hot' }, ctx());
    expect(refs(hot.items)).toEqual(['slug-d2', 'slug-d1', 'slug-d5', 'slug-d4']);
  });

  it('never lists a private, deleted or unready doc — not even through 我的收藏', async () => {
    seedLibrary();
    const everything = [
      ...(await searchEmbedCandidates('library', { scope: 'all' }, ctx())).items,
      ...(await searchEmbedCandidates('library', { scope: 'mine' }, ctx())).items,
      ...(await searchEmbedCandidates('library', { scope: 'fav' }, ctx())).items,
    ];
    for (const gone of ['slug-d3', 'slug-d6', 'slug-d7', 'slug-d8']) expect(refs(everything)).not.toContain(gone);
    expect(refs((await searchEmbedCandidates('library', { scope: 'fav' }, ctx())).items)).toEqual(['slug-d4']);
    expect(refs((await searchEmbedCandidates('library', { scope: 'mine' }, ctx())).items)).toEqual(['slug-d2', 'slug-d1']);
    // The gate is the REAL discoverability constant, ANDed first into every query.
    const docQueries = fake.calls.filter((c) => c.model === 'libraryDoc');
    expect(docQueries.length).toBeGreaterThan(0);
    for (const c of docQueries) expect((c.args.where!.AND as unknown[])[0]).toBe(BROWSABLE_DOC_WHERE);
  });

  it('pages mine-first across page boundaries with no duplicates and no gaps', async () => {
    seedLibrary();
    const pages = await walk('library', 'all', 'new', 1);
    expect(pages.map(refs)).toEqual([['slug-d2'], ['slug-d1'], ['slug-d4'], ['slug-d5']]);
    const odd = await walk('library', 'all', 'hot', 3);
    expect(odd.map(refs)).toEqual([['slug-d2', 'slug-d1', 'slug-d5'], ['slug-d4']]);
  });

  it('flags mine / favorited, falls the title back to the summary and never exposes the ref as text', async () => {
    seedLibrary();
    const { items } = await searchEmbedCandidates('library', { scope: 'all' }, ctx());
    const byRef = Object.fromEntries(items.map((c) => [c.ref, c]));
    expect(byRef['slug-d1']).toMatchObject({ mine: true, favorited: false, updatedAt: d('2026-09-10').toISOString() });
    expect(byRef['slug-d4']).toMatchObject({ mine: false, favorited: true });
    expect(byRef['slug-d5'].title).toBe('一句话摘要');
    for (const c of items) expect(c.title).not.toBe(c.ref);
  });

  it('reads the favourite flags in ONE query per page, and none for 我的收藏', async () => {
    seedLibrary();
    await searchEmbedCandidates('library', { scope: 'all', pageSize: 3 }, ctx());
    expect(fake.calls.filter((c) => c.model === 'libraryShelfItem')).toHaveLength(1);
    fake.calls.length = 0;
    const fav = await searchEmbedCandidates('library', { scope: 'fav' }, ctx());
    expect(fav.items.every((c) => c.favorited)).toBe(true);
    expect(fake.calls.filter((c) => c.model === 'libraryShelfItem')).toHaveLength(0);
  });

  it('applies the keyword to every phase', async () => {
    seedLibrary();
    const { items } = await searchEmbedCandidates('library', { q: 'd4' }, ctx());
    expect(refs(items)).toEqual(['slug-d4']);
  });

  it('answers an id-less viewer with the un-split rest only', async () => {
    seedLibrary();
    const all = await searchEmbedCandidates('library', { scope: 'all' }, ctx(null));
    expect(refs(all.items)).toEqual(['slug-d4', 'slug-d2', 'slug-d1', 'slug-d5']);
    expect(all.items.every((c) => !c.mine && !c.favorited)).toBe(true);
    expect((await searchEmbedCandidates('library', { scope: 'fav' }, ctx(null))).items).toEqual([]);
  });

  it('最新 pages by keyset, so a row deleted between two pages cannot hide an unseen one', async () => {
    fake.tables.libraryDoc = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => doc(k, { createdAt: d(`2026-09-0${6 - i}`) }));
    fake.tables.libraryShelfItem = [];
    const first = await searchEmbedCandidates('library', { scope: 'all', sort: 'new', pageSize: 2 }, ctx());
    expect(refs(first.items)).toEqual(['slug-a', 'slug-b']);
    // 'a' is deleted after page 1 was drawn. Under `skip: 2` the second page
    // would start at 'd' and NOBODY would ever be offered 'c' — the dedupe in
    // appendCandidates hides repeats, but a gap is invisible.
    fake.tables.libraryDoc = fake.tables.libraryDoc.filter((r) => r.id !== 'a');
    const cursor = decodeEmbedSearchCursor(first.nextCursor!, phasesFor('library', 'all', 'new'), 'keyset');
    const second = await searchEmbedCandidates('library', { scope: 'all', sort: 'new', pageSize: 2, cursor }, ctx());
    expect(refs(second.items)).toEqual(['slug-c', 'slug-d']);
    // No `skip` is ever sent under 最新 — the cursor IS the position.
    for (const c of fake.calls.filter((x) => x.model === 'libraryDoc')) expect(c.args.skip).toBeUndefined();
  });

  it('the keyset clause only names a NULL key on a NULLABLE column', async () => {
    // Prisma REJECTS `{ createdAt: null }` on a required column at runtime
    // ("Argument `createdAt` is missing") — a 500 on every second page, which an
    // in-memory fixture cannot see. The nullable half needs the branch just as
    // badly, or every null-key row would be stranded past the first page.
    // The pager also PROBES the next phase at its start (no keyset clause at
    // all), so scan every query of the model rather than only the last one.
    const keysetOr = (model: string, field: string) => {
      for (const call of fake.calls.filter((c) => c.model === model)) {
        const clause = (call.args.where!.AND as Where[]).find(
          (w) => Array.isArray(w.OR) && (w.OR as Where[]).length > 0 && (w.OR as Where[]).every((b) => field in b),
        );
        if (clause) return clause.OR as Where[];
      }
      return [];
    };

    fake.tables.libraryDoc = ['a', 'b', 'c'].map((k, i) => doc(k, { createdAt: d(`2026-09-0${3 - i}`) }));
    fake.tables.libraryShelfItem = [];
    const lib = await searchEmbedCandidates('library', { scope: 'all', sort: 'new', pageSize: 1 }, ctx());
    fake.calls.length = 0;
    await searchEmbedCandidates(
      'library',
      { scope: 'all', sort: 'new', pageSize: 1, cursor: decodeEmbedSearchCursor(lib.nextCursor!, phasesFor('library', 'all', 'new'), 'keyset') },
      ctx(),
    );
    // LibraryDoc.createdAt is NOT NULL → two branches, no null filter.
    expect(keysetOr('libraryDoc', 'createdAt')).toHaveLength(2);
    expect(JSON.stringify(keysetOr('libraryDoc', 'createdAt'))).not.toContain('null');

    seedPosts();
    const posts = await searchEmbedCandidates('post', { scope: 'all', sort: 'new', pageSize: 1 }, ctx());
    fake.calls.length = 0;
    await searchEmbedCandidates(
      'post',
      { scope: 'all', sort: 'new', pageSize: 1, cursor: decodeEmbedSearchCursor(posts.nextCursor!, phasesFor('post', 'all', 'new'), 'keyset') },
      ctx(),
    );
    // ZonePost.publishedAt IS nullable → the trailing null group needs its branch.
    const postOr = keysetOr('zonePost', 'publishedAt');
    expect(postOr).toHaveLength(3);
    expect(postOr).toContainEqual({ publishedAt: null });
  });

  it('keyset keeps working across the mine → rest boundary', async () => {
    fake.tables.libraryDoc = [
      doc('m1', { uploaderId: ME, createdAt: d('2026-09-09') }),
      doc('m2', { uploaderId: ME, createdAt: d('2026-09-08') }),
      doc('r1', { createdAt: d('2026-09-07') }),
      doc('r2', { createdAt: d('2026-09-06') }),
    ];
    fake.tables.libraryShelfItem = [];
    expect((await walk('library', 'all', 'new', 1)).map(refs)).toEqual([['slug-m1'], ['slug-m2'], ['slug-r1'], ['slug-r2']]);
    expect((await walk('library', 'all', 'new', 2)).map(refs)).toEqual([['slug-m1', 'slug-m2'], ['slug-r1', 'slug-r2']]);
  });

  it('throws on a database failure instead of answering an empty (已经到底了) page', async () => {
    seedLibrary();
    fake.failing.model = 'libraryDoc';
    await expect(searchEmbedCandidates('library', {}, ctx())).rejects.toThrow('db down');
  });
});

describe('searchEmbedCandidates — 技术专区 posts', () => {
  it('counts co-authored posts as 我发布的 and lists them once', async () => {
    seedPosts();
    const { items } = await searchEmbedCandidates('post', { scope: 'all', sort: 'new' }, ctx());
    expect(refs(items)).toEqual(['p2', 'p1', 'p8', 'p4']);
    expect(items.filter((c) => c.mine).map((c) => c.ref)).toEqual(['p2', 'p1']);
    expect(refs((await searchEmbedCandidates('post', { scope: 'mine' }, ctx())).items)).toEqual(['p2', 'p1']);
    const hot = await searchEmbedCandidates('post', { scope: 'all', sort: 'hot' }, ctx());
    expect(refs(hot.items)).toEqual(['p1', 'p2', 'p4', 'p8']);
  });

  it('respects readable zones and post visibility, including through bookmarks', async () => {
    seedPosts();
    const fav = await searchEmbedCandidates('post', { scope: 'fav' }, ctx());
    // p3 locked zone, p5 deleted, p6 restricted, p7 draft, p9 deleted zone — all bookmarked, none listed.
    expect(refs(fav.items)).toEqual(['p8']);
    const pages = await walk('post', 'all', 'new', 2);
    const flat = pages.flat();
    expect(refs(flat)).toEqual(['p2', 'p1', 'p8', 'p4']);
    expect(new Set(refs(flat)).size).toBe(flat.length);
    for (const c of fake.calls.filter((x) => x.model === 'zonePost')) {
      const and = c.args.where!.AND as Where[];
      expect(and[0]).toMatchObject({ status: 'published', deletedAt: null });
      expect(and[0].zone).toBeDefined();
      expect(and[1]).toHaveProperty('OR');
    }
  });

  it('a 版主 of the zone sees every post in it, including a restricted one', async () => {
    // The 版主 branch of `zonePostVisibilityWhere` ({ zone: viewerZoneModeratorWhere })
    // is why this suite loads the REAL helper instead of a copy: a copy without
    // it lists nothing here, and the suite could not tell.
    fake.tables.zonePost = [
      post('m1', { zone: zones.modded, visibility: 'restricted', publishedAt: d('2026-09-06') }),
      post('m2', { zone: zones.modded, visibility: 'members', publishedAt: d('2026-09-05') }),
      // Same visibility, a zone this viewer only READS: still hidden.
      post('m3', { visibility: 'restricted', publishedAt: d('2026-09-04') }),
    ];
    fake.tables.zonePostBookmark = [];
    const { items } = await searchEmbedCandidates('post', { scope: 'all', sort: 'new' }, ctx());
    expect(refs(items)).toEqual(['m1', 'm2']);
  });

  it('shows the PUBLISH time (what 最新 sorts by) with an 已编辑 badge, and names the zone in the subtitle', async () => {
    seedPosts();
    const { items } = await searchEmbedCandidates('post', { scope: 'mine' }, ctx());
    const p2 = items.find((c) => c.ref === 'p2')!;
    // p2 was published 09-05 and edited 09-14. 最新 orders by publishedAt, so
    // showing editedAt printed 「14 天前」 on a row sitting BELOW 「19 天前」 rows.
    expect(p2.updatedAt).toBe(d('2026-09-05').toISOString());
    expect(p2.edited).toBe(true);
    expect(p2.subtitle).toBe('边缘推理 · Someone');
    const p1 = items.find((c) => c.ref === 'p1')!;
    expect(p1.updatedAt).toBe(d('2026-09-03').toISOString());
    expect(p1.edited).toBe(false);
  });

  it('never prints a date out of order under 最新 — every group reads newest → oldest', async () => {
    seedPosts();
    const { items } = await searchEmbedCandidates('post', { scope: 'all', sort: 'new' }, ctx());
    for (const group of [items.filter((c) => c.mine), items.filter((c) => !c.mine)]) {
      const dates = group.map((c) => c.updatedAt);
      expect(dates, JSON.stringify(dates)).toEqual([...dates].sort().reverse());
    }
  });
});

describe('searchEmbedCandidates — skills, videos, shorts, events, packs', () => {
  it('skills: owner first, newest by release, private / draft favourites never listed', async () => {
    const skill = (id: string, over: Row & { favBy?: string[] }): Row => {
      const { favBy = [], ...rest } = over;
      return {
        id,
        slug: `skill-${id}`,
        name: `Skill ${id}`,
        summary: 'does things',
        authorId: 'other',
        author: { displayName: 'Author' },
        status: 'published',
        deletedAt: null,
        visibility: 'public',
        trendingScore: 0,
        downloadCount: 0,
        createdAt: d('2026-01-01'),
        currentVersionId: `ver-${id}`,
        currentVersion: { createdAt: d('2026-09-01') },
        favorites: favBy.map((userId) => ({ userId, skillId: id })),
        ...rest,
      };
    };
    fake.tables.skill = [
      skill('s1', { authorId: ME, trendingScore: 1 }),
      skill('s2', { visibility: 'private', favBy: [ME] }),
      skill('s3', { favBy: [ME], currentVersion: { createdAt: d('2026-09-13') }, trendingScore: 2 }),
      skill('s4', { status: 'draft', favBy: [ME] }),
      skill('s5', { deletedAt: d('2026-09-02'), favBy: [ME] }),
      skill('s6', { createdAt: d('2026-09-12'), currentVersion: { createdAt: d('2026-09-02') }, trendingScore: 9 }),
      // Its only version was yanked: still `published`, nothing to install, and
      // ORDER BY a nullable relation column DESC is NULLS FIRST in Postgres —
      // it used to head the 最新 list showing 「更新于 6 年前」.
      skill('s7', { authorId: ME, currentVersionId: null, currentVersion: null, createdAt: d('2020-01-01'), trendingScore: 99, favBy: [ME] }),
    ];
    fake.tables.favorite = fake.tables.skill.flatMap((r) => r.favorites as Row[]);
    const all = await searchEmbedCandidates('skill', { scope: 'all', sort: 'new' }, ctx());
    expect(refs(all.items)).toEqual(['skill-s1', 'skill-s3', 'skill-s6']);
    // Not through any scope, and not through 最热 either.
    for (const opts of [{ scope: 'mine' }, { scope: 'fav' }, { scope: 'all', sort: 'hot' }] as const) {
      expect(refs((await searchEmbedCandidates('skill', opts, ctx())).items)).not.toContain('skill-s7');
    }
    expect(all.items[1]).toMatchObject({ favorited: true, updatedAt: d('2026-09-13').toISOString(), subtitle: 'Author · does things' });
    expect(refs((await searchEmbedCandidates('skill', { scope: 'all', sort: 'hot' }, ctx())).items)).toEqual(['skill-s1', 'skill-s6', 'skill-s3']);
    expect(refs((await searchEmbedCandidates('skill', { scope: 'fav' }, ctx())).items)).toEqual(['skill-s3']);
    for (const c of fake.calls.filter((x) => x.model === 'skill')) expect((c.args.where!.AND as unknown[])[0]).toBe(DISCOVERABLE_SKILL_WHERE);
  });

  it('a skill whose only version was yanked is never offered, under either sort', async () => {
    // `status: 'published'` with a null `currentVersionId`: nothing to install,
    // and ORDER BY a nullable relation column is NULLS FIRST in Postgres, so it
    // used to head 最新 wearing its original createdAt.
    const row = (id: string, over: Row = {}): Row => ({
      id,
      slug: `skill-${id}`,
      name: `Skill ${id}`,
      summary: 'does things',
      authorId: 'other',
      author: { displayName: 'Author' },
      status: 'published',
      deletedAt: null,
      visibility: 'public',
      trendingScore: 0,
      downloadCount: 0,
      createdAt: d('2026-01-01'),
      currentVersionId: `ver-${id}`,
      currentVersion: { createdAt: d('2026-09-01') },
      favorites: [],
      ...over,
    });
    fake.tables.skill = [
      row('s1'),
      row('s2', { currentVersionId: null, currentVersion: null, createdAt: d('2026-09-14') }),
    ];
    fake.tables.favorite = [];
    for (const sort of ['new', 'hot'] as const) {
      expect(refs((await searchEmbedCandidates('skill', { scope: 'all', sort }, ctx())).items)).toEqual(['skill-s1']);
    }
  });

  it('videos and shorts: 稍后看 is the favourite, only published public rows of the right kind', async () => {
    const video = (id: string, over: Row & { favBy?: string[] }): Row => {
      const { favBy = [], ...rest } = over;
      return {
        id,
        slug: `video-${id}`,
        title: `Video ${id}`,
        summary: '',
        posterUrl: null,
        uploaderId: 'other',
        uploader: { displayName: 'Uploader' },
        isShort: false,
        status: 'published',
        visibility: 'public',
        deletedAt: null,
        viewCount: 0,
        likeCount: 0,
        publishedAt: d('2026-09-01'),
        createdAt: d('2026-09-01'),
        favorites: favBy.map((userId) => ({ userId, videoId: id })),
        ...rest,
      };
    };
    fake.tables.video = [
      video('v1', { uploaderId: ME }),
      video('v2', { visibility: 'unlisted', favBy: [ME] }),
      video('v3', { favBy: [ME], publishedAt: d('2026-09-05') }),
      video('v4', { isShort: true, favBy: [ME], title: '', summary: '短视频文案' }),
      video('v5', { status: 'draft', favBy: [ME] }),
      video('v6', { isShort: true, deletedAt: d('2026-09-03'), favBy: [ME] }),
    ];
    fake.tables.videoFavorite = fake.tables.video.flatMap((r) => r.favorites as Row[]);
    expect(refs((await searchEmbedCandidates('video', { scope: 'all' }, ctx())).items)).toEqual(['video-v1', 'video-v3']);
    expect(refs((await searchEmbedCandidates('video', { scope: 'fav' }, ctx())).items)).toEqual(['video-v3']);
    const shorts = await searchEmbedCandidates('short', { scope: 'fav' }, ctx());
    // shorts are referenced by id, and a caption stands in for a missing title
    expect(shorts.items).toEqual([expect.objectContaining({ kind: 'short', ref: 'v4', title: '短视频文案', favorited: true })]);
  });

  // 活动 fixtures are relative to NOW: the 即将举行 / 已结束 split runs the REAL
  // per-zone boundary (upcomingWhere), so a fixed date would rot.
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** A UTC instant `days` from now at `hour` UTC. */
  const shift = (days: number, hour = 12) => {
    const t = new Date(Date.now() + days * DAY_MS);
    t.setUTCHours(hour, 0, 0, 0);
    return t;
  };
  const event = (id: string, over: Row & { attending?: string[] }): Row => {
    const { attending = [], ...rest } = over;
    return {
      id,
      title: `Event ${id}`,
      summary: '',
      startAt: shift(7),
      endAt: null,
      allDay: false,
      timezone: 'Asia/Shanghai',
      city: '温哥华',
      venue: null,
      coverUrl: null,
      authorId: 'other',
      deletedAt: null,
      attendeeCount: 0,
      createdAt: d('2026-09-01'),
      attendees: attending.map((userId) => ({ userId, eventId: id })),
      ...rest,
    };
  };

  function seedEvents() {
    fake.tables.event = [
      event('e1', { authorId: ME, startAt: shift(7), attendeeCount: 1, createdAt: d('2026-08-01') }),
      event('e2', { authorId: ME, startAt: shift(-5), createdAt: d('2026-09-14') }),
      event('e3', { startAt: shift(3), attending: [ME], attendeeCount: 7, createdAt: d('2026-09-10') }),
      event('e4', { startAt: shift(9), createdAt: d('2026-09-13') }),
      event('e5', { startAt: shift(-4), attending: [ME], createdAt: d('2026-09-12') }),
      event('e6', { startAt: shift(5), deletedAt: d('2026-09-06'), attending: [ME] }),
    ];
    fake.tables.eventAttendee = fake.tables.event.flatMap((r) => r.attendees as Row[]);
  }

  it('events: 我参加的 is the favourite, deleted events never listed', async () => {
    seedEvents();
    const all = await searchEmbedCandidates('event', { scope: 'all' }, ctx());
    expect(refs(all.items)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(all.items.find((c) => c.ref === 'e3')).toMatchObject({ favorited: true });
    expect(refs((await searchEmbedCandidates('event', { scope: 'fav' }, ctx())).items)).toEqual(['e3', 'e5']);
  });

  it('活动 最新 lists 即将举行 first (soonest first), then 已结束 — inside each publisher group', async () => {
    seedEvents();
    // 我发布的: e1 (+7) then e2 (-5); everyone else: e3 (+3), e4 (+9), then e5 (-4).
    // Ordering by `createdAt` buried next week's event (e1, listed a month ago)
    // under listings typed up yesterday for events that already happened.
    const all = await searchEmbedCandidates('event', { scope: 'all', sort: 'new' }, ctx());
    expect(refs(all.items)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    // The same order survives paging one row at a time — the up/past split is a
    // phase, so every cursor lands back in the right half.
    expect((await walk('event', 'all', 'new', 1)).flat().map((c) => c.ref)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(refs((await searchEmbedCandidates('event', { scope: 'fav', sort: 'new' }, ctx())).items)).toEqual(['e3', 'e5']);
    // 最热 ranks by attendeeCount across the whole set — no time split there.
    expect(refs((await searchEmbedCandidates('event', { scope: 'all', sort: 'hot' }, ctx())).items)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(refs((await searchEmbedCandidates('event', { scope: 'fav', sort: 'hot' }, ctx())).items)).toEqual(['e3', 'e5']);
  });

  it('活动 最新 loses NOTHING to the up/past split — not an end-less all-day row, not a stray timezone', async () => {
    // `{ NOT: upcomingWhere() }` is NOT the complement: `(endAt ?? startAt)` is
    // an OR over a nullable column, so for `endAt IS NULL` the upcoming
    // expression is NULL and `NOT NULL` is NULL — a finished all-day event with
    // no end date matched NEITHER half and vanished from 插入引用 (seen on the
    // real database). A timezone outside the closed set matches no per-zone
    // branch of either helper and needs the same sweep.
    fake.tables.event = [
      event('ok-up', { startAt: shift(6) }),
      event('ok-past', { startAt: shift(-6) }),
      event('allday-past', { startAt: shift(-3, 0), endAt: null, allDay: true, timezone: null }),
      event('allday-up', { startAt: shift(3, 0), endAt: null, allDay: true, timezone: null }),
      event('stray-tz', { startAt: shift(-8), timezone: 'Europe/Berlin' }),
      event('gone', { startAt: shift(2), deletedAt: d('2026-09-06') }),
    ];
    fake.tables.eventAttendee = [];
    const listed = refs((await searchEmbedCandidates('event', { scope: 'all', sort: 'new' }, ctx())).items);
    // 最热 does not split at all, so it is the ground truth for「what is visible」.
    const everything = refs((await searchEmbedCandidates('event', { scope: 'all', sort: 'hot' }, ctx())).items);
    expect(everything).toHaveLength(5);
    expect([...listed].sort()).toEqual([...everything].sort());
    expect(new Set(listed).size).toBe(listed.length); // and nothing counted twice
    expect(listed).not.toContain('gone');
  });

  it('活动 rows carry the event date in its OWN zone, not the UTC slice of the instant', async () => {
    // 21:00Z in Asia/Shanghai (UTC+8, no DST) is 05:00 the NEXT day — the UTC
    // slice printed the previous day on every evening-UTC 北京 event.
    const evening = shift(6, 21);
    const utcDay = evening.toISOString().slice(0, 10);
    const shanghaiDay = new Date(evening.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(shanghaiDay).not.toBe(utcDay);
    const allDayAt = shift(4, 0);
    fake.tables.event = [
      event('e-tz', { startAt: evening }),
      event('e-allday', { startAt: allDayAt, allDay: true, timezone: null, city: null, venue: '会议室' }),
    ];
    fake.tables.eventAttendee = [];
    const { items } = await searchEmbedCandidates('event', { scope: 'all' }, ctx());
    const byRef = Object.fromEntries(items.map((c) => [c.ref, c]));
    expect(byRef['e-tz'].subtitle).toBe(`${shanghaiDay} · 温哥华`);
    // All-day rows are date-only UTC midnights and are never converted.
    expect(byRef['e-allday'].subtitle).toBe(`${allDayAt.toISOString().slice(0, 10)} · 会议室`);
  });

  it('packs: published only, no publisher split, no favourites', async () => {
    fake.tables.skillPack = [
      { id: 'k1', slug: 'pack-a', name: 'A', summary: 'first', icon: '📦', isPublished: true, installCount: 1, sortOrder: 0, createdAt: d('2026-09-02') },
      { id: 'k2', slug: 'pack-b', name: 'B', summary: '', icon: '/icons/b.png', isPublished: true, installCount: 5, sortOrder: 0, createdAt: d('2026-09-01') },
      { id: 'k3', slug: 'pack-c', name: 'C', summary: '', icon: '', isPublished: false, installCount: 9, sortOrder: 0, createdAt: d('2026-09-03') },
    ];
    const newest = await searchEmbedCandidates('pack', { scope: 'all', sort: 'new' }, ctx());
    expect(refs(newest.items)).toEqual(['pack-a', 'pack-b']);
    expect(newest.items[1].imageUrl).toBe('/icons/b.png');
    expect(newest.items[0].imageUrl).toBeNull();
    expect(refs((await searchEmbedCandidates('pack', { sort: 'hot' }, ctx())).items)).toEqual(['pack-b', 'pack-a']);
    expect((await searchEmbedCandidates('pack', { scope: 'mine' }, ctx())).items).toEqual([]);
  });
});

// ── route ────────────────────────────────────────────────────────────────────

describe('GET /api/zones/embed/search', () => {
  const call = (qs: string) => GET(new Request(`http://localhost/api/zones/embed/search?${qs}`));

  it('requires a session', async () => {
    state.session = null;
    expect((await call('kind=library')).status).toBe(401);
  });

  it('400s every malformed parameter', async () => {
    seedLibrary();
    const fav = encodeEmbedSearchCursor({ phase: 'fav', offset: 20 });
    for (const qs of [
      'kind=file',
      'kind=link',
      'kind=nope',
      `kind=library&q=${'x'.repeat(81)}`,
      'kind=pack&scope=mine',
      'kind=library&scope=everything',
      'kind=library&sort=top',
      'kind=library&cursor=%%%',
      'kind=library&cursor=abc',
      `kind=library&scope=all&cursor=${fav}`,
      // 最新 pages by keyset; a 最热 offset cursor replayed there is garbage,
      // not something to reinterpret as row 20 of a different ordering.
      `kind=library&scope=all&sort=new&cursor=${encodeEmbedSearchCursor({ phase: 'rest', offset: 20 })}`,
      `kind=library&scope=all&sort=hot&cursor=${encodeEmbedSearchCursor({ phase: 'rest', after: { at: d('2026-09-01'), id: 'x' } })}`,
    ]) {
      expect((await call(qs)).status, qs).toBe(400);
    }
  });

  it('answers { items, nextCursor } and continues from the cursor', async () => {
    fake.tables.libraryDoc = Array.from({ length: EMBED_SEARCH_PAGE_SIZE + 5 }, (_, i) =>
      doc(`n${String(i).padStart(2, '0')}`, { createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)), uploaderId: i < 3 ? ME : 'other' }),
    );
    fake.tables.libraryShelfItem = [];
    const first = (await (await call('kind=library&scope=all&sort=new')).json()) as { items: EmbedCandidate[]; nextCursor: string | null };
    expect(first.items).toHaveLength(EMBED_SEARCH_PAGE_SIZE);
    expect(first.items.slice(0, 3).every((c) => c.mine)).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (await call(`kind=library&scope=all&sort=new&cursor=${first.nextCursor}`)).json()) as typeof first;
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((c) => c.ref);
    expect(new Set(all).size).toBe(EMBED_SEARCH_PAGE_SIZE + 5);
  });

  it('turns a database failure into a 500, not an empty page', async () => {
    fake.failing.model = 'zonePost';
    expect((await call('kind=post')).status).toBe(500);
  });
});

// ── dialog helpers ───────────────────────────────────────────────────────────

const cand = (ref: string, over: Partial<EmbedCandidate> = {}): EmbedCandidate => ({
  kind: 'post',
  ref,
  title: `T ${ref}`,
  subtitle: '',
  imageUrl: null,
  updatedAt: '2026-09-01T00:00:00.000Z',
  mine: false,
  favorited: false,
  ...over,
});

describe('embed picker helpers', () => {
  it('builds the search URL, omitting an empty keyword and cursor', () => {
    expect(embedSearchUrl({ kind: 'library', q: '  ', scope: 'all', sort: 'new', cursor: null })).toBe('/api/zones/embed/search?kind=library&scope=all&sort=new');
    expect(embedSearchUrl({ kind: 'post', q: '推理 & RAG', scope: 'fav', sort: 'hot', cursor: 'eyJ2Ijox' })).toBe(
      '/api/zones/embed/search?kind=post&scope=fav&sort=hot&q=%E6%8E%A8%E7%90%86+%26+RAG&cursor=eyJ2Ijox',
    );
  });

  it('validates a page body and drops malformed rows', () => {
    expect(parseEmbedSearchPage(null)).toBeNull();
    expect(parseEmbedSearchPage({ error: 'rate_limited' })).toBeNull();
    expect(parseEmbedSearchPage({ items: [], nextCursor: 3 })).toBeNull();
    const page = parseEmbedSearchPage({ items: [cand('a'), { kind: 'post', ref: 'b' }], nextCursor: null });
    // A body without `truncated` (an old cache, a v1 deploy) means "the data ended".
    expect(page).toEqual({ items: [cand('a')], nextCursor: null, truncated: false });
    expect(parseEmbedSearchPage({ items: [], nextCursor: null, truncated: true })?.truncated).toBe(true);
    expect(parseEmbedSearchPage({ items: [], nextCursor: null, truncated: 'yes' })?.truncated).toBe(false);
  });

  it('appends pages without duplicating a row', () => {
    const out = appendCandidates([cand('a'), cand('b')], [cand('b'), cand('c'), cand('c')]);
    expect(refs(out)).toEqual(['a', 'b', 'c']);
    const same = [cand('a')];
    expect(appendCandidates(same, [])).toBe(same);
  });

  it('ignores a stale page after a reset (race-safe) and keeps load-more single-flight', () => {
    let s: PickerListState = pickerListReducer(INITIAL_PICKER_LIST, { type: 'reset', reqId: 1 });
    s = pickerListReducer(s, { type: 'reset', reqId: 2 }); // the keyword changed mid-flight
    const stale = pickerListReducer(s, { type: 'page', reqId: 1, items: [cand('old')], nextCursor: 'x' });
    expect(stale).toBe(s);
    s = pickerListReducer(s, { type: 'page', reqId: 2, items: [cand('a'), cand('b')], nextCursor: 'c1' });
    expect(s).toMatchObject({ status: 'ready', loaded: true, nextCursor: 'c1' });
    expect(canAutoLoadMore(s)).toBe(true);

    s = pickerListReducer(s, { type: 'more', reqId: 3 });
    expect(s.status).toBe('loading');
    expect(pickerListReducer(s, { type: 'more', reqId: 4 })).toBe(s); // already loading
    // A duplicate answer for the first page can no longer land.
    expect(pickerListReducer(s, { type: 'page', reqId: 2, items: [cand('z')], nextCursor: null })).toBe(s);
    s = pickerListReducer(s, { type: 'page', reqId: 3, items: [cand('b'), cand('c')], nextCursor: null });
    expect(refs(s.items)).toEqual(['a', 'b', 'c']);
    expect(isPickerListEnd(s)).toBe(true);
    expect(canAutoLoadMore(s)).toBe(false);
    expect(pickerListReducer(s, { type: 'more', reqId: 5 })).toBe(s); // nothing after the end
  });

  it('keeps rows and cursor on a failed page, never auto-retries, but allows a manual retry', () => {
    let s = pickerListReducer(INITIAL_PICKER_LIST, { type: 'reset', reqId: 1 });
    s = pickerListReducer(s, { type: 'page', reqId: 1, items: [cand('a')], nextCursor: 'c1' });
    s = pickerListReducer(s, { type: 'more', reqId: 2 });
    s = pickerListReducer(s, { type: 'error', reqId: 2 });
    expect(s).toMatchObject({ status: 'error', nextCursor: 'c1' });
    expect(refs(s.items)).toEqual(['a']);
    expect(canAutoLoadMore(s)).toBe(false);
    expect(isPickerListEnd(s)).toBe(false);
    s = pickerListReducer(s, { type: 'more', reqId: 3 });
    expect(s).toMatchObject({ status: 'loading', reqId: 3 });
    // An error for a request nobody waits for changes nothing.
    expect(pickerListReducer(s, { type: 'error', reqId: 2 })).toBe(s);
  });

  it('an empty result is not 已经到底了', () => {
    let s = pickerListReducer(INITIAL_PICKER_LIST, { type: 'reset', reqId: 1 });
    s = pickerListReducer(s, { type: 'page', reqId: 1, items: [], nextCursor: null });
    expect(isPickerListEnd(s)).toBe(false);
    expect(isPickerListCapped(s)).toBe(false);
    expect(s.loaded).toBe(true);
  });

  it('a stream the offset cap cut short is NOT 已经到底了', () => {
    let s = pickerListReducer(INITIAL_PICKER_LIST, { type: 'reset', reqId: 1 });
    s = pickerListReducer(s, { type: 'page', reqId: 1, items: [cand('a')], nextCursor: null, truncated: true });
    // Rows the viewer can never scroll to remain, so the footer must ask for a
    // keyword instead of claiming the list is complete.
    expect(isPickerListEnd(s)).toBe(false);
    expect(isPickerListCapped(s)).toBe(true);
    expect(canAutoLoadMore(s)).toBe(false);
    // A later reset clears the flag.
    expect(pickerListReducer(s, { type: 'reset', reqId: 2 }).truncated).toBe(false);
  });

  it('Enter is inert until the list answers the search box', () => {
    const ready: PickerListState = { reqId: 1, items: [cand('old')], nextCursor: null, status: 'ready', loaded: true, truncated: false };
    // The debounce has not fired: the rows on screen are the PREVIOUS keyword's,
    // so Enter would insert something the typist never saw offered.
    expect(searchResultsArePending('探针帖 07', '', ready)).toBe(true);
    // Debounce fired, first page still in flight — still nothing trustworthy.
    expect(searchResultsArePending('探针帖 07', '探针帖 07', { ...ready, items: [], status: 'loading' })).toBe(true);
    // The page arrived: Enter picks.
    expect(searchResultsArePending('探针帖 07', '探针帖 07', ready)).toBe(false);
    // Trailing whitespace is not a pending keyword.
    expect(searchResultsArePending('  rag  ', 'rag', ready)).toBe(false);
    // A load-more page keeps the visible rows valid, so Enter stays live.
    expect(searchResultsArePending('rag', 'rag', { ...ready, status: 'loading' })).toBe(false);
  });

  it('prefetches when keyboard navigation nears the end', () => {
    expect(shouldPrefetchForActive(0, 20)).toBe(false);
    expect(shouldPrefetchForActive(20 - KEYBOARD_PREFETCH_ROWS, 20)).toBe(true);
    expect(shouldPrefetchForActive(19, 20)).toBe(true);
    expect(shouldPrefetchForActive(0, 0)).toBe(false);
  });

  it('falls back to 全部 for a scope the kind lacks', () => {
    expect(effectiveScope(scopesForKind('pack'), 'fav')).toBe('all');
    expect(effectiveScope(scopesForKind('library'), 'fav')).toBe('fav');
  });

  it('names 我的收藏 after the destination’s own save action', () => {
    expect(favScopeLabelKey('library')).toBe('embed_scope_fav_library');
    expect(favScopeLabelKey('short')).toBe('embed_scope_fav_video');
    expect(favScopeLabelKey('event')).toBe('embed_scope_fav_event');
    expect(favScopeLabelKey('post')).toBe('embed_scope_fav');
    expect(favBadgeLabelKey('video')).toBe('embed_badge_fav_video');
    expect(favBadgeLabelKey('skill')).toBe('embed_badge_fav');
    expect(scopeLabelKey('library', 'mine')).toBe('embed_scope_mine');
    expect(scopeLabelKey('library', 'all')).toBe('embed_scope_all');
  });
});

// ── i18n ─────────────────────────────────────────────────────────────────────

describe('picker copy', () => {
  const locales = ['zh-CN', 'en', 'fr'] as const;
  const zones = Object.fromEntries(
    locales.map((l) => [l, (JSON.parse(readFileSync(resolve(__dirname, `../messages/${l}.json`), 'utf8')) as { zones: Record<string, string> }).zones]),
  ) as Record<(typeof locales)[number], Record<string, string>>;

  it('tells an empty 我发布的 that only content OTHERS can see is listed', () => {
    // Every phase ANDs the discoverability gate, so the viewer's own private /
    // unlisted / draft rows are not offered either — 「你还没有发布过X」 told
    // members who HAD published that they had not.
    for (const l of locales) {
      const msg = zones[l].embed_empty_mine;
      expect(msg, l).toBeTruthy();
      expect(msg, l).toContain('{kind}');
      expect(msg.toLowerCase(), l).not.toMatch(/haven|n’avez encore rien|还没有发布过/);
    }
  });

  it('has the capped-list and 已编辑 strings in all three locales', () => {
    for (const key of ['embed_list_capped', 'embed_badge_edited'] as const) {
      for (const l of locales) expect(zones[l][key], `${l}.${key}`).toBeTruthy();
    }
  });
});
