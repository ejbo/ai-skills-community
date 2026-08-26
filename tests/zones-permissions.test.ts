import { describe, expect, it } from 'vitest';
import {
  ZONE_AUTHOR_ROLE_KEY,
  ZONE_MEMBER_ROLE_KEY,
  ZONE_MODERATOR_ROLE_KEY,
  ZONE_OWNER_ROLE_KEY,
  ZONE_PERMISSION_KEYS,
  ZONE_ROLE_KEY_RE,
  ZONE_SYSTEM_ROLES,
  buildZoneAccess,
  canAssignZoneRole,
  isZonePermissionKey,
  normalizeZonePermissions,
  zoneCan,
  type ZoneAccessInput,
  type ZonePermissionKey,
} from '@/lib/zones/permissions';

const OWNER = 'owner-1';
const VIEWER = 'user-2';

const systemRole = (key: string) => {
  const r = ZONE_SYSTEM_ROLES.find((x) => x.key === key)!;
  return { key: r.key, name: r.name, permissions: r.permissions };
};
const memberRole = systemRole(ZONE_MEMBER_ROLE_KEY);

function zone(over: Partial<ZoneAccessInput['zone']> = {}): ZoneAccessInput['zone'] {
  return { id: 'z1', ownerId: OWNER, visibility: 'public', joinPolicy: 'open', allowGuestComments: true, ...over };
}

function access(over: Partial<ZoneAccessInput> = {}) {
  return buildZoneAccess({
    zone: zone(),
    viewerId: VIEWER,
    membership: null,
    memberRole,
    siteAdmin: false,
    canSeeIdentity: false,
    ...over,
  });
}

const NONE: ZonePermissionKey[] = [];

describe('catalog + normalizeZonePermissions', () => {
  it('has unique keys and every system role only references catalog keys', () => {
    expect(new Set(ZONE_PERMISSION_KEYS).size).toBe(ZONE_PERMISSION_KEYS.length);
    expect(new Set(ZONE_SYSTEM_ROLES.map((r) => r.key)).size).toBe(ZONE_SYSTEM_ROLES.length);
    for (const r of ZONE_SYSTEM_ROLES) {
      expect(ZONE_ROLE_KEY_RE.test(r.key)).toBe(true);
      for (const p of r.permissions) expect(isZonePermissionKey(p)).toBe(true);
    }
    expect(systemRole(ZONE_MEMBER_ROLE_KEY).permissions).toEqual(['comment']);
    expect(systemRole(ZONE_MODERATOR_ROLE_KEY).permissions).not.toContain('roles');
  });

  it('drops unknown keys, dedupes and restores catalog order', () => {
    expect(normalizeZonePermissions(['comment', 'bogus', 'post', 'comment', '*', 'manage'])).toEqual([
      'manage',
      'post',
      'comment',
    ]);
    expect(normalizeZonePermissions(null)).toEqual([]);
    expect(normalizeZonePermissions(undefined)).toEqual([]);
  });

  it('role keys are lowercase snake, 2–32 chars', () => {
    expect(ZONE_ROLE_KEY_RE.test('reviewer')).toBe(true);
    expect(ZONE_ROLE_KEY_RE.test('lead_2')).toBe(true);
    expect(ZONE_ROLE_KEY_RE.test('R')).toBe(false);
    expect(ZONE_ROLE_KEY_RE.test('Reviewer')).toBe(false);
    expect(ZONE_ROLE_KEY_RE.test('1abc')).toBe(false);
    expect(ZONE_ROLE_KEY_RE.test('a'.repeat(33))).toBe(false);
  });
});

describe('buildZoneAccess matrix', () => {
  it('anonymous: nothing at all, even on a public zone', () => {
    const a = access({ viewerId: null });
    expect(a.canRead).toBe(false);
    expect(a.canJoin).toBe(false);
    expect(a.canComment).toBe(false);
    expect(a.canPost).toBe(false);
    expect(a.isMember).toBe(false);
    expect(a.permissions).toEqual(NONE);
    expect(a.roleKey).toBeNull();
    expect(a.membershipStatus).toBeNull();
  });

  it('guest on a public zone: reads, may join, comments only when guests are allowed', () => {
    const a = access();
    expect(a.canRead).toBe(true);
    expect(a.canJoin).toBe(true);
    expect(a.canLeave).toBe(false);
    expect(a.canComment).toBe(true);
    expect(a.canPost).toBe(false);
    expect(a.canWiki).toBe(false);
    expect(a.permissions).toEqual(NONE);
    expect(a.roleKey).toBeNull();
    const noGuests = access({ zone: zone({ allowGuestComments: false }) });
    expect(noGuests.canRead).toBe(true);
    expect(noGuests.canComment).toBe(false);
  });

  it('guest on a members-only zone: card only — no read, no comment, may apply', () => {
    const a = access({ zone: zone({ visibility: 'members', joinPolicy: 'approval' }) });
    expect(a.canRead).toBe(false);
    expect(a.canComment).toBe(false);
    expect(a.canJoin).toBe(true);
    const invite = access({ zone: zone({ visibility: 'members', joinPolicy: 'invite' }) });
    expect(invite.canJoin).toBe(false);
  });

  it('pending applicant: no member rights yet, cannot re-apply', () => {
    const a = access({
      zone: zone({ visibility: 'members', joinPolicy: 'approval' }),
      membership: { status: 'pending', role: null },
    });
    expect(a.membershipStatus).toBe('pending');
    expect(a.isMember).toBe(false);
    expect(a.canRead).toBe(false);
    expect(a.canJoin).toBe(false);
    expect(a.canLeave).toBe(false);
    expect(a.permissions).toEqual(NONE);
    // on a public zone a pending applicant is still just a guest for reading/commenting
    const pub = access({ membership: { status: 'pending', role: null } });
    expect(pub.canRead).toBe(true);
    expect(pub.canComment).toBe(true);
  });

  it('member with the implicit default role: reads members-only content, comments, cannot post', () => {
    const a = access({
      zone: zone({ visibility: 'members', joinPolicy: 'approval', allowGuestComments: false }),
      membership: { status: 'active', role: null },
    });
    expect(a.isMember).toBe(true);
    expect(a.membershipStatus).toBe('active');
    expect(a.roleKey).toBe(ZONE_MEMBER_ROLE_KEY);
    expect(a.roleName).toBe(memberRole.name);
    expect(a.permissions).toEqual(['comment']);
    expect(a.canRead).toBe(true);
    expect(a.canComment).toBe(true);
    expect(a.canPost).toBe(false);
    expect(a.canLeave).toBe(true);
    expect(a.canJoin).toBe(false);
    expect(a.canManage).toBe(false);
    expect(a.canManageRoles).toBe(false);
  });

  it('member whose implicit role was widened (member role granted `post`) can post', () => {
    const a = access({
      membership: { status: 'active', role: null },
      memberRole: { ...memberRole, permissions: ['comment', 'post'] },
    });
    expect(a.canPost).toBe(true);
    expect(a.permissions).toEqual(['post', 'comment']);
  });

  it('member with no member role row at all still reads, but holds no permissions', () => {
    const a = access({ membership: { status: 'active', role: null }, memberRole: null });
    expect(a.isMember).toBe(true);
    expect(a.canRead).toBe(true);
    expect(a.permissions).toEqual(NONE);
    expect(a.canComment).toBe(false);
    expect(a.roleKey).toBeNull();
  });

  it('author: post + wiki + comment, no moderation or management', () => {
    const a = access({ membership: { status: 'active', role: systemRole(ZONE_AUTHOR_ROLE_KEY) } });
    expect(a.roleKey).toBe(ZONE_AUTHOR_ROLE_KEY);
    expect(a.canPost).toBe(true);
    expect(a.canWiki).toBe(true);
    expect(a.canComment).toBe(true);
    expect(a.canModerate).toBe(false);
    expect(a.canManage).toBe(false);
    expect(a.canManageMembers).toBe(false);
    expect(a.canManageRoles).toBe(false);
  });

  it('moderator: manage / members / moderate / wiki / post, but never roles', () => {
    const a = access({ membership: { status: 'active', role: systemRole(ZONE_MODERATOR_ROLE_KEY) } });
    expect(a.roleKey).toBe(ZONE_MODERATOR_ROLE_KEY);
    expect(a.canManage).toBe(true);
    expect(a.canManageMembers).toBe(true);
    expect(a.canModerate).toBe(true);
    expect(a.canWiki).toBe(true);
    expect(a.canPost).toBe(true);
    expect(a.canManageRoles).toBe(false);
    expect(zoneCan(a, 'roles')).toBe(false);
    expect(zoneCan(a, 'moderate')).toBe(true);
  });

  it('unknown permission strings on a stored role are ignored', () => {
    const a = access({
      membership: { status: 'active', role: { key: 'custom', name: '自定义', permissions: ['post', 'root', '*'] } },
    });
    expect(a.permissions).toEqual(['post']);
    expect(a.canManage).toBe(false);
  });

  it('owner: every key, pseudo role `owner`, cannot leave or join; membership row is irrelevant', () => {
    const a = access({ viewerId: OWNER, membership: null });
    expect(a.isOwner).toBe(true);
    expect(a.isMember).toBe(true);
    expect(a.membershipStatus).toBe('active');
    expect(a.roleKey).toBe(ZONE_OWNER_ROLE_KEY);
    expect(a.permissions).toEqual([...ZONE_PERMISSION_KEYS]);
    expect(a.canRead).toBe(true);
    expect(a.canManageRoles).toBe(true);
    expect(a.canModerate).toBe(true);
    expect(a.canLeave).toBe(false);
    expect(a.canJoin).toBe(false);
    // even on a members/invite zone
    const strict = access({ viewerId: OWNER, zone: zone({ visibility: 'members', joinPolicy: 'invite' }) });
    expect(strict.canRead).toBe(true);
    expect(strict.canComment).toBe(true);
  });

  it('site admin (non-member): bypasses visibility and holds every zone key, yet is not a member', () => {
    const a = access({
      siteAdmin: true,
      canSeeIdentity: true,
      zone: zone({ visibility: 'members', joinPolicy: 'approval', allowGuestComments: false }),
    });
    expect(a.siteAdmin).toBe(true);
    expect(a.canSeeIdentity).toBe(true);
    expect(a.isOwner).toBe(false);
    expect(a.isMember).toBe(false);
    expect(a.roleKey).toBeNull();
    expect(a.canRead).toBe(true);
    expect(a.canComment).toBe(true);
    expect(a.permissions).toEqual([...ZONE_PERMISSION_KEYS]);
    expect(a.canModerate).toBe(true);
    expect(a.canManageRoles).toBe(true);
    expect(a.canJoin).toBe(true); // may still join as a regular member
    expect(a.canLeave).toBe(false);
  });

  it('site admin who is also a plain member keeps full power and may leave', () => {
    const a = access({ siteAdmin: true, membership: { status: 'active', role: null } });
    expect(a.isMember).toBe(true);
    expect(a.roleKey).toBe(ZONE_MEMBER_ROLE_KEY);
    expect(a.permissions).toEqual([...ZONE_PERMISSION_KEYS]);
    expect(a.canLeave).toBe(true);
  });

  it('canSeeIdentity is orthogonal to zone power', () => {
    expect(access({ canSeeIdentity: true }).canSeeIdentity).toBe(true);
    expect(access({ viewerId: OWNER }).canSeeIdentity).toBe(false);
  });
});

describe('canAssignZoneRole', () => {
  const plain = { key: 'author', permissions: ['post', 'wiki', 'comment'] };
  const withRoles = { key: 'admin_like', permissions: ['members', 'roles'] };

  it('requires the members permission at all', () => {
    const author = access({ membership: { status: 'active', role: systemRole(ZONE_AUTHOR_ROLE_KEY) } });
    expect(canAssignZoneRole(author, plain)).toBe(false);
  });

  it('a members-manager without `roles` may hand out plain roles but not role-bearing ones', () => {
    const mod = access({ membership: { status: 'active', role: systemRole(ZONE_MODERATOR_ROLE_KEY) } });
    expect(canAssignZoneRole(mod, plain)).toBe(true);
    expect(canAssignZoneRole(mod, withRoles)).toBe(false);
  });

  it('owner and site admin may assign anything', () => {
    expect(canAssignZoneRole(access({ viewerId: OWNER }), withRoles)).toBe(true);
    expect(canAssignZoneRole(access({ siteAdmin: true }), withRoles)).toBe(true);
  });

  it('a custom role carrying both members and roles may assign role-bearing roles', () => {
    const lead = access({
      membership: { status: 'active', role: { key: 'lead', name: 'Lead', permissions: ['members', 'roles'] } },
    });
    expect(lead.canManageRoles).toBe(true);
    expect(canAssignZoneRole(lead, withRoles)).toBe(true);
  });
});
