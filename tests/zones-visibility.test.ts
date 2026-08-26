import { describe, expect, it } from 'vitest';
import { buildZoneAccess, type ZoneAccess } from '@/lib/zones/permissions';
import {
  decideZonePostAccess,
  isZonePostAuthor,
  isZonePostDiscoverable,
  isZonePostReadable,
  zonePostAccessContext,
  type ZonePostAccessContext,
  type ZonePostAccessRow,
} from '@/lib/zones/post-access';

const OWNER = 'u-owner';
const AUTHOR = 'u-author';
const COAUTHOR = 'u-coauthor';
const MEMBER = 'u-member';
const OUTSIDER = 'u-outsider';

function post(over: Partial<ZonePostAccessRow> = {}): ZonePostAccessRow {
  return {
    authorId: AUTHOR,
    coauthorIds: [COAUTHOR],
    status: 'published',
    deletedAt: null,
    visibility: 'zone',
    ...over,
  };
}

/** Real `buildZoneAccess` output — the decision function must consume the same booleans the UI does. */
function accessFor(opts: {
  viewerId: string | null;
  zoneVisibility?: 'public' | 'members';
  membership?: 'active' | 'pending' | null;
  permissions?: string[];
  siteAdmin?: boolean;
}): ZoneAccess {
  return buildZoneAccess({
    zone: {
      id: 'z1',
      ownerId: OWNER,
      visibility: opts.zoneVisibility ?? 'public',
      joinPolicy: 'approval',
      allowGuestComments: true,
      deletedAt: null,
    },
    viewerId: opts.viewerId,
    membership: opts.membership
      ? { status: opts.membership, role: { key: 'r', name: '角色', permissions: opts.permissions ?? ['comment'] } }
      : null,
    memberRole: { key: 'member', name: '成员', permissions: ['comment'] },
    siteAdmin: !!opts.siteAdmin,
    canSeeIdentity: false,
  });
}

function ctx(opts: Parameters<typeof accessFor>[0] & { granted?: boolean }): ZonePostAccessContext {
  return zonePostAccessContext(accessFor(opts), opts.granted ?? false);
}

describe('decideZonePostAccess — privileged viewers', () => {
  it('lets the author, a co-author, a 版主 and site staff see a DRAFT', () => {
    const draft = post({ status: 'draft' });
    expect(decideZonePostAccess(draft, ctx({ viewerId: AUTHOR, membership: 'active' }))).toBe('privileged');
    expect(decideZonePostAccess(draft, ctx({ viewerId: COAUTHOR, membership: 'active' }))).toBe('privileged');
    expect(
      decideZonePostAccess(draft, ctx({ viewerId: MEMBER, membership: 'active', permissions: ['moderate'] })),
    ).toBe('privileged');
    expect(decideZonePostAccess(draft, ctx({ viewerId: 'u-staff', siteAdmin: true }))).toBe('privileged');
  });

  it('keeps the author privileged even after they lose access to the zone', () => {
    // Membership revoked in a members-only zone ⇒ canRead false, but the author
    // must still reach their own row (to see it, edit it or delete it).
    const access = accessFor({ viewerId: AUTHOR, zoneVisibility: 'members', membership: null });
    expect(access.canRead).toBe(false);
    expect(decideZonePostAccess(post(), zonePostAccessContext(access))).toBe('privileged');
  });

  it('does not treat an unrelated member as an author', () => {
    expect(isZonePostAuthor(post(), MEMBER)).toBe(false);
    expect(isZonePostAuthor(post(), null)).toBe(false);
    expect(isZonePostAuthor(post(), COAUTHOR)).toBe(true);
  });
});

describe('decideZonePostAccess — the zone gate comes first', () => {
  it('hides a `zone`-visibility post from a non-member of a members-only 版块', () => {
    const outsider = ctx({ viewerId: OUTSIDER, zoneVisibility: 'members', membership: null });
    expect(decideZonePostAccess(post({ visibility: 'zone' }), outsider)).toBe('hidden');
    // …and post visibility can never widen it: `restricted` + a grant is still hidden.
    expect(
      decideZonePostAccess(post({ visibility: 'restricted' }), { ...outsider, granted: true }),
    ).toBe('hidden');
  });

  it('shows a `zone`-visibility post to any logged-in viewer of a public 版块', () => {
    expect(decideZonePostAccess(post(), ctx({ viewerId: OUTSIDER }))).toBe('visible');
  });

  it('hides everything from an anonymous viewer (the /zones tree is login-walled)', () => {
    const anon = ctx({ viewerId: null });
    expect(anon.canRead).toBe(false);
    expect(decideZonePostAccess(post(), anon)).toBe('hidden');
  });

  it('hides drafts and soft-deleted rows from everyone else', () => {
    const reader = ctx({ viewerId: OUTSIDER });
    expect(decideZonePostAccess(post({ status: 'draft' }), reader)).toBe('hidden');
    expect(decideZonePostAccess(post({ deletedAt: new Date() }), reader)).toBe('hidden');
  });
});

describe('decideZonePostAccess — per-post visibility', () => {
  it('仅成员可见: members only, hidden from a non-member and from a pending applicant', () => {
    const members = post({ visibility: 'members' });
    expect(decideZonePostAccess(members, ctx({ viewerId: MEMBER, membership: 'active' }))).toBe('visible');
    expect(decideZonePostAccess(members, ctx({ viewerId: OUTSIDER }))).toBe('hidden');
    expect(decideZonePostAccess(members, ctx({ viewerId: OUTSIDER, membership: 'pending' }))).toBe('hidden');
  });

  it('指定成员可见: locked without a grant, visible with one', () => {
    const restricted = post({ visibility: 'restricted' });
    expect(decideZonePostAccess(restricted, ctx({ viewerId: MEMBER, membership: 'active' }))).toBe('locked');
    expect(
      decideZonePostAccess(restricted, ctx({ viewerId: MEMBER, membership: 'active', granted: true })),
    ).toBe('visible');
    // A grant is what the redeemed 访问密码 writes, so a non-member of a PUBLIC
    // zone (who may read the zone) gets in the same way.
    expect(decideZonePostAccess(restricted, ctx({ viewerId: OUTSIDER, granted: true }))).toBe('visible');
  });

  it('never locks the post out of its own author / 版主', () => {
    const restricted = post({ visibility: 'restricted' });
    expect(decideZonePostAccess(restricted, ctx({ viewerId: AUTHOR, membership: 'active' }))).toBe('privileged');
    expect(
      decideZonePostAccess(restricted, ctx({ viewerId: MEMBER, membership: 'active', permissions: ['moderate'] })),
    ).toBe('privileged');
  });

  it('treats an unknown visibility value as hidden (fail closed)', () => {
    const weird = post({ visibility: 'secret' as never });
    expect(decideZonePostAccess(weird, ctx({ viewerId: OUTSIDER }))).toBe('hidden');
  });
});

describe('decision helpers', () => {
  it('readable = privileged | visible; discoverable also covers the locked stub', () => {
    expect(isZonePostReadable('privileged')).toBe(true);
    expect(isZonePostReadable('visible')).toBe(true);
    expect(isZonePostReadable('locked')).toBe(false);
    expect(isZonePostReadable('hidden')).toBe(false);

    expect(isZonePostDiscoverable('locked')).toBe(true);
    expect(isZonePostDiscoverable('hidden')).toBe(false);
  });

  it('zonePostAccessContext carries the pre-decided ZoneAccess booleans through unchanged', () => {
    const access = accessFor({ viewerId: MEMBER, membership: 'active', permissions: ['moderate', 'comment'] });
    expect(zonePostAccessContext(access, true)).toEqual({
      viewerId: MEMBER,
      canRead: true,
      isMember: true,
      canModerate: true,
      siteAdmin: false,
      granted: true,
    });
    expect(zonePostAccessContext(access).granted).toBe(false);
  });
});
