// 帖子版本历史 + 乐观并发（docs/contracts/reports.md §4）。
//
// 钉住的契约：已发布帖子的内容变化 ⇒ 守卫式 `revision += n` + 快照（首次补写 #1 = 保存前的内容）；
// 草稿不写快照；带 baseRevision 的 PATCH 撞上新版本 ⇒ 409 stale_revision，什么都不写；
// 事务里的守卫 count 0 同样 409；不带 baseRevision 的客户端行为不变。
// 路由真跑 PATCH（和 zones-coauthor-edit-gate 同一套内存事务）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { post: null as Record<string, unknown> | null, guardCount: 1 };
  const tx = {
    zonePost: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: state.guardCount })),
    },
    zonePostRevision: { create: vi.fn(async () => ({})) },
    zonePostAuthor: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    zonePostViewer: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    zonePostAttachment: { deleteMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    zone: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    zonePost: { findUnique: vi.fn(async () => state.post), findMany: vi.fn(async () => []) },
    slugAlias: { findMany: vi.fn(async () => []) },
    zonePostAttachment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    user: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { state, tx, prisma };
});

vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'zh-CN') }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'author' } })) }));
vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/lib/api-errors', () => ({ apiReason: vi.fn(async (key: string) => `reason:${key}`) }));
vi.mock('@/lib/audit', () => ({ logAdmin: vi.fn() }));
vi.mock('@/lib/zones/access', () => ({
  zoneContext: vi.fn(async () => ({
    zone: { id: 'z1', slug: 'edge-inference' },
    access: { canRead: true, canModerate: false, canPost: true, isMember: true, siteAdmin: false, canSeeIdentity: false },
    viewer: { id: 'author', siteAdmin: false, canSeeIdentity: false },
  })),
}));
vi.mock('@/lib/zones/queries', async () => ({ ZoneError: (await import('@/lib/zones/errors')).ZoneError }));
vi.mock('@/lib/zones/columns', () => ({ getOrCreateColumn: vi.fn(), recountZoneColumns: vi.fn() }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn() }));
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
vi.mock('@/lib/zones/notify', () => ({ notifyPostPeople: vi.fn(async () => undefined) }));
vi.mock('@/lib/zones/storage', () => ({
  statZoneMediaAsync: vi.fn(async () => null),
  isValidZoneMediaKey: () => false,
  zoneMediaPublicUrl: (key: string) => `/api/zones/media/${key}`,
  zoneMediaKeyFromUrl: () => null,
  deleteZoneMediaFile: vi.fn(),
}));

import { PATCH } from '@/app/api/zones/[slug]/posts/[postId]/route';

function post(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    zoneId: 'z1',
    authorId: 'author',
    type: 'article',
    title: '原标题',
    summary: '',
    bodyMd: 'old body',
    coverKey: null,
    linkUrl: null,
    columnId: null,
    visibility: 'zone',
    accessCode: null,
    status: 'published',
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    pinned: false,
    locked: false,
    deletedAt: null,
    revision: 0,
    editedAt: null,
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    editedBy: null,
    coauthors: [],
    zone: { id: 'z1', slug: 'edge-inference', name: '边缘推理', ownerId: 'owner', visibility: 'public', joinPolicy: 'open', allowGuestComments: true, deletedAt: null },
    attachments: [],
    ...over,
  };
}

async function patch(body: Record<string, unknown>) {
  const req = new Request('http://localhost/api/zones/edge-inference/posts/p1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req, { params: { slug: 'edge-inference', postId: 'p1' } });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  db.state.post = post();
  db.state.guardCount = 1;
  vi.clearAllMocks();
});

describe('版本快照', () => {
  it('first content edit of a published post backfills #1 (the pre-edit content) and writes #2', async () => {
    expect((await patch({ bodyMd: 'new body', baseRevision: 0 })).status).toBe(200);
    expect(db.tx.zonePost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', revision: 0 }, data: { revision: { increment: 2 } } });
    const creates = db.tx.zonePostRevision.create.mock.calls.map((c) => (c as unknown as [{ data: Record<string, unknown> }])[0].data);
    expect(creates).toHaveLength(2);
    expect(creates[0]).toMatchObject({ number: 1, editorId: 'author', bodyMd: 'old body', note: '发布时的版本' });
    expect(creates[1]).toMatchObject({ number: 2, editorId: 'author', bodyMd: 'new body' });
  });

  it('later edits bump by one and snapshot once', async () => {
    db.state.post = post({ revision: 2 });
    expect((await patch({ title: '新标题', baseRevision: 2 })).status).toBe(200);
    expect(db.tx.zonePost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', revision: 2 }, data: { revision: { increment: 1 } } });
    expect(db.tx.zonePostRevision.create).toHaveBeenCalledTimes(1);
    const created = db.tx.zonePostRevision.create.mock.calls.map((c) => (c as unknown as [{ data: { number: number } }])[0].data.number);
    expect(created).toEqual([3]);
  });

  it('a draft edit writes no snapshot and does not bump (same condition as editedAt)', async () => {
    db.state.post = post({ status: 'draft', publishedAt: null });
    expect((await patch({ bodyMd: 'draft body' })).status).toBe(200);
    expect(db.tx.zonePostRevision.create).not.toHaveBeenCalled();
    expect(db.tx.zonePost.updateMany).not.toHaveBeenCalled();
  });

  it('a non-content patch (tags only) of a published post neither bumps nor snapshots', async () => {
    expect((await patch({ tags: ['a'] })).status).toBe(200);
    expect(db.tx.zonePostRevision.create).not.toHaveBeenCalled();
    expect(db.tx.zonePost.updateMany).not.toHaveBeenCalled();
  });
});

describe('乐观并发 (baseRevision)', () => {
  it('answers 409 stale_revision with who/when and writes nothing when the base is behind', async () => {
    db.state.post = post({ revision: 3, editedAt: new Date('2026-09-03T00:00:00Z'), editedBy: { handle: 'bob', displayName: 'Bob', avatarUrl: null, department: null, lab: null, isPrivate: false } });
    const r = await patch({ bodyMd: 'mine', baseRevision: 2 });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: 'stale_revision', revision: 3, editedBy: { handle: 'bob' } });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.tx.zonePost.update).not.toHaveBeenCalled();
  });

  it('answers 409 when the in-transaction guard moves no row (a save slipped in between)', async () => {
    db.state.guardCount = 0;
    const r = await patch({ bodyMd: 'mine', baseRevision: 0 });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: 'stale_revision' });
    expect(db.tx.zonePost.update).not.toHaveBeenCalled();
    expect(db.tx.zonePostRevision.create).not.toHaveBeenCalled();
  });

  it('a client that sends no baseRevision keeps the old behaviour (bump + snapshot, no guard on revision)', async () => {
    expect((await patch({ bodyMd: 'cli body' })).status).toBe(200);
    expect(db.tx.zonePost.updateMany).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { revision: { increment: 2 } } });
    expect(db.tx.zonePost.update).toHaveBeenCalled();
  });

  it('baseRevision alone is not a patch', async () => {
    expect((await patch({ baseRevision: 0 })).status).toBe(400);
  });
});
