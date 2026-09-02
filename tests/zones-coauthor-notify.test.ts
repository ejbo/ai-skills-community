// 合著者是全站的，通知只在「发布」时发 — the two owner asks of 2026-09-02
// (「添加合著者我希望是可以整个平台的人都可以添加。添加后如果发表，我希望这个
// 人能收到通知。」) plus the @人 hook on the same surface.
//
// Three things are pinned here, each of which is a rule someone could
// "simplify" away:
//   1. `validateCoauthors` no longer asks for zone membership — but it still
//      caps, dedupes, drops the author themselves and drops ids that are not
//      an ACTIVE account (an unknown id would otherwise reach `coauthors.create`
//      as a raw P2003).
//   2. A draft notifies NOBODY. A publish notifies the whole byline; an edit of
//      an already-published post notifies only the people it ADDED.
//   3. A mention only pings someone who could actually open the post — a
//      仅成员可见 版块 or a 指定成员可见 帖子 must not ping an outsider.
// The write path itself (transaction, counters, attachments) is covered by
// tests/zones-post-attachments.test.ts; here everything but the notification
// decision is stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZONE_LIMITS } from '@/lib/zones/shared';

interface UserRow {
  id: string;
  handle: string;
  displayName: string;
  isActive: boolean;
  /** `roleForUserRow` (lib/roles) reads these off the candidate row. */
  isAdmin: boolean;
  role: { id: string; key: string; name: string; description: string; isSystem: boolean; permissions: string[] } | null;
}
interface MemberRow {
  zoneId: string;
  userId: string;
  status: string;
  /** null ⇒ the zone's `member` system role (the ZoneMember contract). */
  permissions: string[] | null;
}

const db = vi.hoisted(() => {
  const state = {
    users: [] as UserRow[],
    members: [] as MemberRow[],
    grants: [] as { postId: string; userId: string }[],
    existing: null as Record<string, unknown> | null,
    /** `updateMany` (the guarded publish flip) reports this many rows moved. */
    flipCount: 1,
  };
  const tx = {
    zonePost: {
      create: vi.fn(async (_args: { data: { coauthors?: { create?: { userId: string }[] } } }) => ({ id: 'new-post', attachments: [] as { id: string; previewStatus: string }[] })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: state.flipCount })),
    },
    zonePostAuthor: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    zonePostViewer: { createMany: vi.fn(async () => ({ count: 0 })), deleteMany: vi.fn(async () => ({ count: 0 })) },
    zonePostAttachment: { deleteMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    zone: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    user: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; handle?: { in: string[] }; isActive?: boolean } }) =>
        state.users
          .filter((u) => where.isActive === undefined || u.isActive === where.isActive)
          .filter((u) => (where.id ? where.id.in.includes(u.id) : where.handle ? where.handle.in.includes(u.handle) : false)),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.users.find((u) => u.id === where.id) ?? null),
    },
    zoneMember: {
      findMany: vi.fn(async ({ where }: { where: { zoneId: string; status: string; userId: { in: string[] } } }) =>
        state.members
          .filter((m) => m.zoneId === where.zoneId && m.status === where.status && where.userId.in.includes(m.userId))
          .map((m) => ({ userId: m.userId, role: m.permissions ? { permissions: m.permissions } : null })),
      ),
    },
    zoneRole: {
      // The zone's `member` system role — what a ZoneMember with roleId null gets.
      findUnique: vi.fn(async () => ({ permissions: ['comment'] })),
    },
    zonePostViewer: {
      findMany: vi.fn(async ({ where }: { where: { postId: string; userId: { in: string[] } } }) =>
        state.grants.filter((g) => g.postId === where.postId && where.userId.in.includes(g.userId)).map((g) => ({ userId: g.userId })),
      ),
    },
    zonePost: { findUnique: vi.fn(async () => state.existing) },
    zonePostAttachment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { state, tx, prisma };
});

// `notifyMentions` (lib/mention-notify) is exercised FOR REAL — its zone gate is
// the thing worth testing — and lands on this stubbed `notifyMention`.
const notify = vi.hoisted(() => ({
  notifyCoauthor: vi.fn(async (_o: { recipientIds: readonly string[]; actorId: string; actorName: string; title: string; link: string }) => undefined),
  notifyMention: vi.fn(async (_o: { recipientIds: readonly string[]; actorId: string; actorName: string; site: unknown; bodyMd: string }) => undefined),
}));

vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/lib/notifications', () => notify);
// lib/mention-notify → lib/video/access → lib/auth, which validates the whole env.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/zones/columns', () => ({ getOrCreateColumn: vi.fn(), recountZoneColumns: vi.fn() }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn() }));
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
vi.mock('@/lib/zones/queries', () => ({ readableZoneWhere: vi.fn(() => ({})), zoneOrgTree: vi.fn() }));
vi.mock('@/lib/zones/storage', () => ({
  statZoneMediaAsync: vi.fn(async () => null),
  isValidZoneMediaKey: () => false,
  zoneMediaPublicUrl: (key: string) => `/api/zones/media/${key}`,
  zoneMediaKeyFromUrl: () => null,
  deleteZoneMediaFile: vi.fn(),
}));

import { canEditZonePostContent, createZonePost, updateZonePost, type ZonePostInput } from '@/lib/zones/post-queries';

const ZONE = {
  id: 'z1',
  slug: 'edge-inference',
  name: '边缘推理',
  ownerId: 'owner',
  visibility: 'public' as const,
  joinPolicy: 'open' as const,
  allowGuestComments: true,
  deletedAt: null,
};

function input(over: Partial<ZonePostInput> = {}): ZonePostInput {
  return {
    type: 'article',
    title: '推理时延优化',
    summary: '',
    bodyMd: '',
    coverKey: null,
    linkUrl: null,
    tags: [],
    coauthorIds: [],
    attachments: [],
    status: 'published',
    columnId: null,
    columnName: null,
    visibility: 'zone',
    designatedUserIds: [],
    regenerateAccessCode: false,
    ...over,
  };
}

function existingPost(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    zoneId: ZONE.id,
    authorId: 'author',
    type: 'article',
    title: '推理时延优化',
    summary: '',
    bodyMd: '',
    coverKey: null,
    linkUrl: null,
    columnId: null,
    visibility: 'zone',
    accessCode: null,
    status: 'published',
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    deletedAt: null,
    coauthors: [] as { userId: string }[],
    zone: { ...ZONE },
    attachments: [] as unknown[],
    ...over,
  };
}

/** The co-author ids the create path actually wrote onto the row. */
function createdCoauthorIds(): string[] {
  const call = db.tx.zonePost.create.mock.calls[0]?.[0] as
    | { data?: { coauthors?: { create?: { userId: string }[] } } }
    | undefined;
  return (call?.data?.coauthors?.create ?? []).map((c) => c.userId);
}

const mention = (name: string, handle: string) => `[@${name}](/users/${handle})`;

beforeEach(() => {
  const person = (id: string, displayName: string, isActive = true): UserRow => ({
    id,
    handle: id,
    displayName,
    isActive,
    isAdmin: false,
    role: null,
  });
  db.state.users = [
    person('author', '张三'),
    person('alice', 'Alice'),
    person('bob', 'Bob'),
    person('mallory', 'Mallory'),
    person('gone', '离职', false),
  ];
  db.state.members = [
    // roleId null ⇒ the zone's `member` role (exercises the fallback lookup).
    { zoneId: ZONE.id, userId: 'alice', status: 'active', permissions: null },
    { zoneId: ZONE.id, userId: 'bob', status: 'active', permissions: ['moderate'] },
  ];
  db.state.grants = [];
  db.state.existing = null;
  db.state.flipCount = 1;
  vi.clearAllMocks();
});

describe('canEditZonePostContent — a site-wide byline is not a write grant', () => {
  const base = { authorId: 'author', coauthorIds: ['alice'], canRead: true, canModerate: false };

  it('lets a co-author edit while the zone gate lets them read', () => {
    expect(canEditZonePostContent({ ...base, viewerId: 'alice' })).toBe(true);
  });

  it('refuses a co-author who cannot read the 版块 — they keep the byline, not the pen', () => {
    expect(canEditZonePostContent({ ...base, viewerId: 'alice', canRead: false })).toBe(false);
  });

  it('keeps the 主作者 and any moderator', () => {
    expect(canEditZonePostContent({ ...base, viewerId: 'author', canRead: false })).toBe(true);
    expect(canEditZonePostContent({ ...base, viewerId: 'stranger', canRead: false, canModerate: true })).toBe(true);
  });

  it('refuses a stranger and an anonymous viewer', () => {
    expect(canEditZonePostContent({ ...base, viewerId: 'stranger' })).toBe(false);
    expect(canEditZonePostContent({ ...base, viewerId: null, canModerate: false })).toBe(false);
  });
});

describe('合著者 = 站内任何人 (createZonePost)', () => {
  it('accepts someone who is not a member of the zone', async () => {
    await createZonePost(ZONE, 'author', input({ coauthorIds: ['mallory'] }));
    expect(createdCoauthorIds()).toEqual(['mallory']);
    // …and never asks the membership table about it.
    expect(db.prisma.zoneMember.findMany).not.toHaveBeenCalled();
  });

  it('drops a disabled or unknown account instead of failing the save', async () => {
    await createZonePost(ZONE, 'author', input({ coauthorIds: ['alice', 'gone', 'nobody'] }));
    expect(createdCoauthorIds()).toEqual(['alice']);
  });

  it('still dedupes, drops the author and keeps the picker order', async () => {
    await createZonePost(ZONE, 'author', input({ coauthorIds: ['bob', 'author', 'alice', 'bob'] }));
    expect(createdCoauthorIds()).toEqual(['bob', 'alice']);
  });

  it('still caps at maxCoauthors', async () => {
    const many = Array.from({ length: ZONE_LIMITS.maxCoauthors + 5 }, (_, i) => `u${i}`);
    db.state.users.push(...many.map((id) => ({ id, handle: id, displayName: id, isActive: true, isAdmin: false, role: null })));
    await createZonePost(ZONE, 'author', input({ coauthorIds: many }));
    expect(createdCoauthorIds()).toHaveLength(ZONE_LIMITS.maxCoauthors);
  });
});

describe('通知只在发布时发出', () => {
  it('a draft tells nobody — not the co-authors, not the people it @s', async () => {
    await createZonePost(ZONE, 'author', input({ status: 'draft', coauthorIds: ['alice'], bodyMd: mention('Bob', 'bob') }));
    expect(notify.notifyCoauthor).not.toHaveBeenCalled();
    expect(notify.notifyMention).not.toHaveBeenCalled();
  });

  it('a published create pings the whole byline and everyone it @s', async () => {
    await createZonePost(ZONE, 'author', input({ coauthorIds: ['alice'], bodyMd: `hi ${mention('Bob', 'bob')}` }));
    expect(notify.notifyCoauthor).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ['alice'], actorId: 'author', actorName: '张三', link: '/zones/edge-inference/posts/new-post' }),
    );
    expect(notify.notifyMention).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ['bob'], site: expect.objectContaining({ link: '/zones/edge-inference/posts/new-post' }) }),
    );
  });

  it('a mention that is also a new co-author gets ONE notification, not two', async () => {
    await createZonePost(ZONE, 'author', input({ coauthorIds: ['alice'], bodyMd: mention('Alice', 'alice') }));
    expect(notify.notifyCoauthor).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['alice'] }));
    expect(notify.notifyMention).not.toHaveBeenCalled();
  });

  it('does not ping the author themselves for their own byline', async () => {
    await createZonePost(ZONE, 'author', input({ coauthorIds: [] }));
    expect(notify.notifyCoauthor).not.toHaveBeenCalled();
  });

  it('a mention inside a code fence is documentation, not a ping', async () => {
    await createZonePost(ZONE, 'author', input({ bodyMd: '```md\n' + mention('Bob', 'bob') + '\n```' }));
    expect(notify.notifyMention).not.toHaveBeenCalled();
  });
});

describe('@人 只发给真的能打开这篇帖子的人', () => {
  it('a 仅成员可见 版块 does not ping an outsider', async () => {
    const zone = { ...ZONE, visibility: 'members' as const };
    await createZonePost(zone, 'author', input({ bodyMd: `${mention('Alice', 'alice')} ${mention('Mallory', 'mallory')}` }));
    expect(notify.notifyMention).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['alice'] }));
  });

  it('a 仅成员可见 帖子 inside a public 版块 does not ping a non-member', async () => {
    await createZonePost(
      ZONE,
      'author',
      input({ visibility: 'members', bodyMd: `${mention('Alice', 'alice')} ${mention('Mallory', 'mallory')}` }),
    );
    expect(notify.notifyMention).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['alice'] }));
  });

  it('a 指定成员可见 帖子 pings only the granted (and the 版主)', async () => {
    db.state.grants = [{ postId: 'new-post', userId: 'alice' }];
    await createZonePost(
      ZONE,
      'author',
      input({
        visibility: 'restricted',
        designatedUserIds: [],
        bodyMd: `${mention('Alice', 'alice')} ${mention('Bob', 'bob')} ${mention('Mallory', 'mallory')}`,
      }),
    );
    // alice via her grant, bob because he moderates the zone; mallory neither.
    const call = notify.notifyMention.mock.calls[0]?.[0] as unknown as { recipientIds: string[] };
    expect([...call.recipientIds].sort()).toEqual(['alice', 'bob']);
  });

  it('a co-author is always reachable — the byline outranks the zone gate', async () => {
    const zone = { ...ZONE, visibility: 'members' as const };
    await createZonePost(zone, 'author', input({ coauthorIds: ['mallory'], bodyMd: mention('Mallory', 'mallory') }));
    // She is told once, as a co-author (the mention would be the same event).
    expect(notify.notifyCoauthor).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['mallory'] }));
    expect(notify.notifyMention).not.toHaveBeenCalled();
  });
});

describe('编辑已发布的帖子只通知新增的人 (updateZonePost)', () => {
  it('pings only the co-author the edit ADDED', async () => {
    db.state.existing = existingPost({ coauthors: [{ userId: 'alice' }] });
    await updateZonePost('p1', { coauthorIds: ['alice', 'bob'] }, { actorId: 'author' });
    expect(notify.notifyCoauthor).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['bob'] }));
  });

  it('re-saving with the same byline pings nobody', async () => {
    db.state.existing = existingPost({ coauthors: [{ userId: 'alice' }] });
    await updateZonePost('p1', { coauthorIds: ['alice'], title: '新标题' }, { actorId: 'author' });
    expect(notify.notifyCoauthor).not.toHaveBeenCalled();
    expect(notify.notifyMention).not.toHaveBeenCalled();
  });

  it('only the @s the edit ADDED are pinged', async () => {
    db.state.existing = existingPost({ bodyMd: `old ${mention('Alice', 'alice')}` });
    await updateZonePost('p1', { bodyMd: `new ${mention('Alice', 'alice')} ${mention('Bob', 'bob')}` }, { actorId: 'author' });
    expect(notify.notifyMention).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['bob'] }));
  });

  it('draft → published pings the WHOLE byline and every @ in the body', async () => {
    db.state.existing = existingPost({ status: 'draft', publishedAt: null, coauthors: [{ userId: 'alice' }], bodyMd: mention('Bob', 'bob') });
    await updateZonePost('p1', { status: 'published' }, { actorId: 'author' });
    expect(notify.notifyCoauthor).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['alice'] }));
    expect(notify.notifyMention).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ['bob'] }));
  });

  it('a draft save still tells nobody', async () => {
    db.state.existing = existingPost({ status: 'draft', publishedAt: null });
    await updateZonePost('p1', { coauthorIds: ['alice'], bodyMd: mention('Bob', 'bob') }, { actorId: 'author' });
    expect(notify.notifyCoauthor).not.toHaveBeenCalled();
    expect(notify.notifyMention).not.toHaveBeenCalled();
  });

  it('unpublishing tells nobody', async () => {
    db.state.existing = existingPost({ coauthors: [] });
    await updateZonePost('p1', { status: 'draft', coauthorIds: ['alice'] }, { actorId: 'author' });
    expect(notify.notifyCoauthor).not.toHaveBeenCalled();
  });

  it('a publish that LOST the guarded flip notifies nobody — the request that won already did', async () => {
    db.state.flipCount = 0;
    db.state.existing = existingPost({ status: 'draft', publishedAt: null, coauthors: [{ userId: 'alice' }] });
    await updateZonePost('p1', { status: 'published' }, { actorId: 'author' });
    expect(notify.notifyCoauthor).not.toHaveBeenCalled();
  });

  it('a notification failure never fails the save', async () => {
    notify.notifyCoauthor.mockRejectedValueOnce(new Error('inbox down'));
    db.state.existing = existingPost();
    await expect(updateZonePost('p1', { coauthorIds: ['alice'] }, { actorId: 'author' })).resolves.toBeUndefined();
  });
});
