// 合著者可以是站内任何人，但 byline ≠ 写权限.
//
// Making co-authors site-wide (owner ask 2026-09-02) means a person who is NOT
// a member of the 版块 can now sit on a post's byline. Reading their own post is
// the point (`decideZonePostAccess` treats an author as privileged before the
// zone gate). EDITING it is not: PATCH must refuse a co-author the zone gate
// would not even let read, or a member could hand an outsider the pen inside a
// 仅成员可见 版块. The 主作者 keeps their own post and `moderate` still overrides.
//
// The route runs for real against the REAL `canEditZonePostContent` and the real
// `updateZonePost` (writes land on an in-memory transaction), so this pins the
// wiring — that `ctx.access.canRead` is the value fed to the policy — and not a
// stub of the policy itself.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { post: null as Record<string, unknown> | null };
  const tx = {
    zonePost: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    zonePostAuthor: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    zonePostViewer: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    zonePostAttachment: { deleteMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    zone: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    zonePost: { findUnique: vi.fn(async () => state.post) },
    zonePostAttachment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    user: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { state, tx, prisma };
});

const access = vi.hoisted(() => ({
  value: { canRead: true, canModerate: false, canPost: true, isMember: true, siteAdmin: false },
}));
const session = vi.hoisted(() => ({ userId: 'author' }));

vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'zh-CN') }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: session.userId } })) }));
vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/lib/api-errors', () => ({ apiReason: vi.fn(async (key: string) => `reason:${key}`) }));
vi.mock('@/lib/audit', () => ({ logAdmin: vi.fn() }));
vi.mock('@/lib/zones/access', () => ({
  zoneContext: vi.fn(async () => ({
    zone: { id: 'z1', slug: 'edge-inference' },
    access: access.value,
    viewer: { id: session.userId, siteAdmin: false, canSeeIdentity: false },
  })),
}));
vi.mock('@/lib/zones/queries', async () => ({ ZoneError: (await import('@/lib/zones/errors')).ZoneError }));
// post-queries' own neighbours — this path never reaches them.
vi.mock('@/lib/zones/columns', () => ({ getOrCreateColumn: vi.fn(), recountZoneColumns: vi.fn() }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn() }));
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
vi.mock('@/lib/zones/storage', () => ({
  statZoneMediaAsync: vi.fn(async () => null),
  isValidZoneMediaKey: () => false,
  zoneMediaPublicUrl: (key: string) => `/api/zones/media/${key}`,
  zoneMediaKeyFromUrl: () => null,
  deleteZoneMediaFile: vi.fn(),
}));

import { PATCH } from '@/app/api/zones/[slug]/posts/[postId]/route';

/** One row serves both reads: the route's gate select and updateZonePost's own. */
function post() {
  return {
    id: 'p1',
    zoneId: 'z1',
    authorId: 'author',
    type: 'article',
    title: '原标题',
    summary: '',
    bodyMd: '',
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
    coauthors: [{ userId: 'coauthor' }],
    zone: {
      id: 'z1',
      slug: 'edge-inference',
      name: '边缘推理',
      ownerId: 'owner',
      visibility: 'public',
      joinPolicy: 'open',
      allowGuestComments: true,
      deletedAt: null,
    },
    attachments: [],
  };
}

async function patchTitle() {
  const req = new Request('http://localhost/api/zones/edge-inference/posts/p1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '新标题' }),
  });
  const res = await PATCH(req, { params: { slug: 'edge-inference', postId: 'p1' } });
  return res.status;
}

beforeEach(() => {
  db.state.post = post();
  access.value = { canRead: true, canModerate: false, canPost: true, isMember: true, siteAdmin: false };
  session.userId = 'author';
  vi.clearAllMocks();
});

describe('PATCH content — who may hold the pen', () => {
  it('a co-author of a 版块 they can read may edit', async () => {
    session.userId = 'coauthor';
    expect(await patchTitle()).toBe(200);
    expect(db.tx.zonePost.update).toHaveBeenCalled();
  });

  it('a co-author who cannot READ the 版块 is refused — nothing is written', async () => {
    session.userId = 'coauthor';
    access.value = { ...access.value, canRead: false, isMember: false };
    expect(await patchTitle()).toBe(403);
    expect(db.tx.zonePost.update).not.toHaveBeenCalled();
  });

  it('the 主作者 keeps their own post even after losing zone access', async () => {
    access.value = { ...access.value, canRead: false, isMember: false };
    expect(await patchTitle()).toBe(200);
  });

  it('a 版主 still overrides everything', async () => {
    session.userId = 'stranger';
    access.value = { ...access.value, canRead: false, isMember: false, canModerate: true };
    expect(await patchTitle()).toBe(200);
  });

  it('a stranger is refused as before', async () => {
    session.userId = 'stranger';
    expect(await patchTitle()).toBe(403);
    expect(db.tx.zonePost.update).not.toHaveBeenCalled();
  });
});
