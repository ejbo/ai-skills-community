// 名片徽章 per viewer — lib/user-tags.ts#syncAndLoadUserTags via
// lib/profile/badges.ts#loadProfileBadges.
//
// Pinned because the public profile page builds the card for LOGGED-OUT
// visitors too: the 版主 auto-badge is derived from login-walled 专区 roles (a
// side door around /zones' login wall), and every anonymous page view used to
// run the reconcile write (tag create / assignment delete).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  zoneMember: { count: vi.fn(async () => 1) },
  userTag: { findUnique: vi.fn(async () => ({ id: 'tag-zm' })), create: vi.fn() },
  userTagAssignment: {
    findMany: vi.fn(async () => [] as unknown[]),
    createMany: vi.fn(async () => ({ count: 1 })),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import { LOGIN_WALLED_TAG_KEYS, ZONE_MODERATOR_TAG_KEY, syncAndLoadUserTags } from '@/lib/user-tags';
import { loadProfileBadges } from '@/lib/profile/badges';

const row = (key: string, kind: 'manual' | 'auto') => ({
  createdAt: new Date('2026-05-02T00:00:00Z'),
  tag: { key, name: key, description: null, color: 'violet', icon: null, kind },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.userTagAssignment.findMany.mockResolvedValue([row('ai_pioneer', 'manual'), row(ZONE_MODERATOR_TAG_KEY, 'auto')]);
});

describe('anonymous viewer', () => {
  it('runs no reconcile query or write at all', async () => {
    await syncAndLoadUserTags('u1', { anonymous: true });
    expect(db.zoneMember.count).not.toHaveBeenCalled();
    expect(db.userTag.findUnique).not.toHaveBeenCalled();
    expect(db.userTag.create).not.toHaveBeenCalled();
    expect(db.userTagAssignment.createMany).not.toHaveBeenCalled();
    expect(db.userTagAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it('excludes login-walled tags in the query itself', async () => {
    expect(LOGIN_WALLED_TAG_KEYS).toContain(ZONE_MODERATOR_TAG_KEY);
    await loadProfileBadges({ id: 'u1', role: null }, { anonymous: true });
    expect(db.userTagAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', hidden: false, tag: { key: { notIn: [ZONE_MODERATOR_TAG_KEY] } } },
      }),
    );
  });
});

describe('signed-in viewer (unchanged)', () => {
  it('reconciles the 版主 tag and returns every visible tag', async () => {
    const badges = await loadProfileBadges({ id: 'u1', role: null });
    expect(db.zoneMember.count).toHaveBeenCalledTimes(1);
    expect(db.userTagAssignment.createMany).toHaveBeenCalledTimes(1);
    expect(db.userTagAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', hidden: false } }),
    );
    expect(badges.map((b) => b.key)).toEqual(['ai_pioneer', ZONE_MODERATOR_TAG_KEY]);
  });
});
