// 工作台 (lib/profile/workspace.ts) — the pure helpers, and the owner-scoping
// of the attention count that drives the dot on the 工作台 tab.
//
// The count is exercised against a recording fake Prisma: what matters is not
// the arithmetic alone but that EVERY read is keyed on the owner's own id and
// skips soft-deleted parents — a count that forgot `deletedAt` would promise
// work on a deleted skill that the panel can never show.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { model: string; op: string; args: Record<string, unknown> };
const calls: Call[] = [];
const results: Record<string, unknown> = {};

function model(name: string) {
  const handler = (op: string) => async (args: Record<string, unknown>) => {
    calls.push({ model: name, op, args });
    const r = results[`${name}.${op}`];
    // A function result answers per call (one model read several ways in one pass).
    if (typeof r === 'function') return (r as (a: Record<string, unknown>) => unknown)(args);
    return r ?? (op === 'count' ? 0 : []);
  };
  return { findMany: handler('findMany'), groupBy: handler('groupBy'), count: handler('count') };
}

vi.mock('@/lib/db', () => ({
  prisma: {
    subscription: model('subscription'),
    skillAccessRequest: model('skillAccessRequest'),
    libraryAccessRequest: model('libraryAccessRequest'),
    voteEntry: model('voteEntry'),
    skill: model('skill'),
    libraryDoc: model('libraryDoc'),
    voteActivity: model('voteActivity'),
    favorite: model('favorite'),
    zonePost: model('zonePost'),
  },
}));
// Server query modules the loader composes; not under test here (and vote-queries validates env at import).
vi.mock('@/lib/vote-queries', () => ({ listVoteActivities: vi.fn(async () => ({ items: [], total: 0 })) }));
vi.mock('@/lib/event-queries', () => ({
  listEvents: vi.fn(async () => ({ items: [], total: 0 })),
  eventViewerFromSession: vi.fn(() => ({ id: null, canManage: false, canSeeIdentity: false })),
}));
vi.mock('@/lib/library-queries', () => ({ getCommentsOnMyDocs: vi.fn(async () => []) }));

const ws = await import('@/lib/profile/workspace');

describe('hasSubscriptionUpdate', () => {
  it('flags only when both versions are known and differ', () => {
    expect(ws.hasSubscriptionUpdate({ installedVersionId: 'a', currentVersionId: 'b' })).toBe(true);
    expect(ws.hasSubscriptionUpdate({ installedVersionId: 'a', currentVersionId: 'a' })).toBe(false);
  });

  it('never nags about a subscription with an unknown side', () => {
    expect(ws.hasSubscriptionUpdate({ installedVersionId: null, currentVersionId: 'b' })).toBe(false);
    expect(ws.hasSubscriptionUpdate({ installedVersionId: 'a', currentVersionId: null })).toBe(false);
    expect(ws.hasSubscriptionUpdate({ installedVersionId: null, currentVersionId: null })).toBe(false);
  });
});

describe('voteRowState', () => {
  const base = { status: 'published' as const, over: false, started: true, startAt: null };
  it('draft wins over every time state', () => {
    expect(ws.voteRowState({ ...base, status: 'draft', over: true })).toBe('draft');
  });
  it('ended before not-started', () => {
    expect(ws.voteRowState({ ...base, over: true, started: false, startAt: '2026-01-01T00:00:00Z' })).toBe('over');
  });
  it('a future startAt is 未开始; no startAt is live', () => {
    expect(ws.voteRowState({ ...base, started: false, startAt: '2099-01-01T00:00:00Z' })).toBe('soon');
    expect(ws.voteRowState({ ...base, started: false, startAt: null })).toBe('live');
    expect(ws.voteRowState(base)).toBe('live');
  });
});

describe('foldList', () => {
  it('splits at the visible count', () => {
    expect(ws.foldList([1, 2, 3, 4], 3)).toEqual({ shown: [1, 2, 3], rest: [4] });
    expect(ws.foldList([1, 2], 6)).toEqual({ shown: [1, 2], rest: [] });
  });
  it('treats negative / fractional counts sanely', () => {
    expect(ws.foldList([1, 2], -1)).toEqual({ shown: [], rest: [1, 2] });
    expect(ws.foldList([1, 2, 3], 1.9)).toEqual({ shown: [1], rest: [2, 3] });
  });
});

describe('sortSubscriptions', () => {
  it('puts updates first and keeps the original order within each group', () => {
    const rows = [
      { id: 'a', hasUpdate: false },
      { id: 'b', hasUpdate: true },
      { id: 'c', hasUpdate: false },
      { id: 'd', hasUpdate: true },
    ];
    expect(ws.sortSubscriptions(rows).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']); // input untouched
  });
});

describe('mergeDrafts', () => {
  it('interleaves every kind newest-first, ties in input order', () => {
    const d = (id: string, t: number) => ({ id, updatedAt: new Date(t) });
    const merged = ws.mergeDrafts([d('skill-1', 10), d('skill-2', 30)], [d('zone-1', 20)], [d('vote-1', 30)]);
    expect(merged.map((r) => r.id)).toEqual(['skill-2', 'vote-1', 'zone-1', 'skill-1']);
  });
  it('handles empty groups', () => {
    expect(ws.mergeDrafts([], [])).toEqual([]);
  });
});

describe('unionSubscriptionRows', () => {
  it('appends the outdated rows the cap left out, once each, after the capped rows', () => {
    const capped = [{ skillId: 'new-1' }, { skillId: 'new-2' }];
    const outdated = [{ skillId: 'old-9' }, { skillId: 'new-2' }, { skillId: 'old-9' }];
    expect(ws.unionSubscriptionRows(capped, outdated).map((r) => r.skillId)).toEqual(['new-1', 'new-2', 'old-9']);
  });
});

describe('tallyByStatus', () => {
  it('sums every status group into per-status counts and a total', () => {
    const t = ws.tallyByStatus([
      { status: 'published' as const, _count: { _all: 150 } },
      { status: 'draft' as const, _count: { _all: 60 } },
    ]);
    expect(t.total).toBe(210);
    expect(t.by.published).toBe(150);
    expect(t.by.draft).toBe(60);
    expect(t.by).not.toHaveProperty('archived');
  });
});

describe('loadWorkspaceData — figures are totals, updates are always listed', () => {
  beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(results)) delete results[k];
  });

  const subRow = (skillId: string, installed: string, current: string) => ({
    skillId,
    installedVersionId: installed,
    installedVersion: { version: installed },
    skill: {
      slug: skillId,
      name: skillId,
      sourceType: 'internal',
      currentVersionId: current,
      currentVersion: { version: current },
      author: { displayName: 'A' },
    },
  });

  it('merges an outdated subscription older than the 100-row cap and reports real totals', async () => {
    results['subscription.findMany'] = (args: { select: Record<string, unknown>; take?: number; where: { skillId?: unknown } }) => {
      if (!('installedVersion' in args.select)) {
        // loadAttention: every subscription, versions only
        return [{ skillId: 'old-outdated', installedVersionId: 'v1', skill: { currentVersionId: 'v2' } }];
      }
      if (args.where.skillId) return [subRow('old-outdated', 'v1', 'v2')]; // the follow-up for missing ids
      return Array.from({ length: args.take ?? 0 }, (_, i) => subRow(`recent-${i}`, 'x', 'x'));
    };
    results['subscription.count'] = 140;
    results['skill.groupBy'] = [
      { status: 'published', _count: { _all: 230 } },
      { status: 'draft', _count: { _all: 12 } },
    ];
    results['libraryDoc.groupBy'] = [
      { status: 'ready', _count: { _all: 120 } },
      { status: 'processing', _count: { _all: 2 } },
      { status: 'pending', _count: { _all: 1 } },
    ];
    results['zonePost.count'] = 70;
    results['voteActivity.count'] = 3;

    const data = await ws.loadWorkspaceData('u1', { id: 'u1', roleKey: 'member', permissions: [] });

    expect(data.attention.subscriptionUpdates).toBe(1);
    expect(data.subscriptions).toHaveLength(101);
    expect(data.subscriptions[0]).toMatchObject({ skillId: 'old-outdated', hasUpdate: true });
    expect(data.attention).not.toHaveProperty('outdatedSkillIds');

    expect(data.totals).toEqual({
      skills: 242,
      skillsPublished: 230,
      docs: 123,
      docsReady: 120,
      docsProcessing: 3,
      subscriptions: 140,
      drafts: 12 + 70 + 3,
    });
    expect(data.draftCounts).toEqual({ skill: 12, zonePost: 70, vote: 3 });

    // The follow-up read stays owner-scoped and skips deleted skills.
    const followUp = calls.find(
      (c) => c.model === 'subscription' && c.op === 'findMany' && (c.args.where as { skillId?: unknown }).skillId,
    )!;
    expect(followUp.args.where).toMatchObject({ userId: 'u1', skill: { deletedAt: null }, skillId: { in: ['old-outdated'] } });
  });

  it('skips the follow-up read when every outdated subscription is already listed', async () => {
    results['subscription.findMany'] = (args: { select: Record<string, unknown> }) =>
      'installedVersion' in args.select
        ? [subRow('s1', 'v1', 'v2')]
        : [{ skillId: 's1', installedVersionId: 'v1', skill: { currentVersionId: 'v2' } }];
    await ws.loadWorkspaceData('u1', { id: 'u1', roleKey: 'member', permissions: [] });
    expect(calls.filter((c) => c.model === 'subscription' && c.op === 'findMany')).toHaveLength(2);
  });
});

describe('loadWorkspaceAttentionCount', () => {
  beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(results)) delete results[k];
  });

  it('sums subscription updates, both kinds of access request and open vote submissions', async () => {
    results['subscription.findMany'] = [
      { installedVersionId: 'v1', skill: { currentVersionId: 'v2' } },
      { installedVersionId: 'v3', skill: { currentVersionId: 'v3' } },
      { installedVersionId: 'v4', skill: { currentVersionId: 'v9' } },
    ];
    results['skillAccessRequest.groupBy'] = [
      { skillId: 's1', _count: { _all: 2 } },
      { skillId: 's2', _count: { _all: 1 } },
    ];
    results['libraryAccessRequest.groupBy'] = [{ docId: 'd1', _count: { _all: 4 } }];
    results['voteEntry.groupBy'] = [{ activityId: 'a1', _count: { _all: 3 } }];
    results['skill.findMany'] = [
      { id: 's1', slug: 'one', name: 'One' },
      { id: 's2', slug: 'two', name: 'Two' },
    ];
    results['libraryDoc.findMany'] = [{ id: 'd1', slug: 'doc', title: 'Doc' }];
    results['voteActivity.findMany'] = [{ id: 'a1', title: 'Vote' }];

    // 2 outdated subscriptions + 3 skill requests + 4 doc requests + 3 submissions
    expect(await ws.loadWorkspaceAttentionCount('u1')).toBe(12);
  });

  it('keys every read on the owner and skips soft-deleted parents', async () => {
    await ws.loadWorkspaceAttentionCount('owner-1');
    const byModel = Object.fromEntries(calls.map((c) => [`${c.model}.${c.op}`, c.args]));

    const sub = byModel['subscription.findMany'] as { where: Record<string, unknown> };
    expect(sub.where).toMatchObject({ userId: 'owner-1', skill: { deletedAt: null } });

    const skillReq = byModel['skillAccessRequest.groupBy'] as { where: Record<string, unknown> };
    expect(skillReq.where).toMatchObject({ status: 'pending', skill: { authorId: 'owner-1', deletedAt: null } });

    const docReq = byModel['libraryAccessRequest.groupBy'] as { where: Record<string, unknown> };
    expect(docReq.where).toMatchObject({ status: 'pending', doc: { uploaderId: 'owner-1', deletedAt: null } });

    const subs = byModel['voteEntry.groupBy'] as { where: { activity: Record<string, unknown> } };
    expect(subs.where).toMatchObject({ status: 'pending' });
    expect(subs.where.activity).toMatchObject({ creatorId: 'owner-1', deletedAt: null, closedAt: null });
  });

  it('only counts grouped rows that still resolve to one of the owner’s items', async () => {
    results['skillAccessRequest.groupBy'] = [{ skillId: 'gone', _count: { _all: 5 } }];
    results['skill.findMany'] = []; // the title lookup (scoped to authorId) found nothing
    expect(await ws.loadWorkspaceAttentionCount('u1')).toBe(0);
    const lookup = calls.find((c) => c.model === 'skill' && c.op === 'findMany')!;
    expect(lookup.args.where).toMatchObject({ authorId: 'u1' });
  });

  it('fails closed to 0 instead of throwing into the profile page', async () => {
    results['subscription.findMany'] = Promise.reject(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await ws.loadWorkspaceAttentionCount('u1')).toBe(0);
    spy.mockRestore();
  });

  it('returns 0 without querying for an empty id', async () => {
    expect(await ws.loadWorkspaceAttentionCount('')).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
