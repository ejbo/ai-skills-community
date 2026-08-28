import { describe, expect, it } from 'vitest';
import {
  MANAGE_SECTIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  SUPER_ADMIN_ROLE_KEY,
  WILDCARD_PERMISSION,
  canAny,
  domainViewer,
  hasPermission,
  isPermissionKey,
  isStaff,
  publicRoleBadge,
  isSuperAdmin,
  manageSectionsFor,
  normalizePermissions,
} from '@/lib/permissions';

const superAdmin = { roleKey: SUPER_ADMIN_ROLE_KEY, permissions: [WILDCARD_PERMISSION] };
const videosOnly = { roleKey: 'video_mod', permissions: ['videos', 'shorts'] };
const member = { roleKey: 'member', permissions: [] as string[] };

describe('permission catalog', () => {
  it('has unique keys and every manage section points under /manage', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const s of MANAGE_SECTIONS) expect(s.href.startsWith('/manage')).toBe(true);
    expect(new Set(MANAGE_SECTIONS.map((s) => s.href)).size).toBe(MANAGE_SECTIONS.length);
  });

  it('every entry has a label and description', () => {
    for (const p of PERMISSIONS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it('isPermissionKey rejects the wildcard and unknown strings', () => {
    expect(isPermissionKey('videos')).toBe(true);
    expect(isPermissionKey('*')).toBe(false);
    expect(isPermissionKey('root')).toBe(false);
  });
});

describe('hasPermission', () => {
  it('is null-safe', () => {
    expect(hasPermission(null, 'videos')).toBe(false);
    expect(hasPermission(undefined, 'identity')).toBe(false);
  });

  it('super admin is decided by ROLE KEY, not by the list', () => {
    expect(hasPermission({ roleKey: SUPER_ADMIN_ROLE_KEY, permissions: [] }, 'logs')).toBe(true);
    expect(hasPermission(superAdmin, 'identity')).toBe(true);
  });

  it('honours the wildcard and exact keys only', () => {
    expect(hasPermission({ permissions: ['*'] }, 'users')).toBe(true);
    expect(hasPermission(videosOnly, 'videos')).toBe(true);
    expect(hasPermission(videosOnly, 'identity')).toBe(false);
    expect(hasPermission(member, 'videos')).toBe(false);
  });

  it('canAny is an OR', () => {
    expect(canAny(videosOnly, 'users', 'shorts')).toBe(true);
    expect(canAny(videosOnly, 'users', 'logs')).toBe(false);
  });
});

describe('isStaff / isSuperAdmin', () => {
  it('any known permission makes staff; unknown strings do not', () => {
    expect(isStaff(member)).toBe(false);
    expect(isStaff({ permissions: ['identity'] })).toBe(true);
    expect(isStaff({ permissions: ['bogus'] })).toBe(false);
    expect(isStaff(superAdmin)).toBe(true);
    expect(isStaff(null)).toBe(false);
  });

  it('isSuperAdmin needs the key', () => {
    expect(isSuperAdmin(superAdmin)).toBe(true);
    expect(isSuperAdmin({ permissions: ['*'] })).toBe(false);
  });
});

describe('normalizePermissions', () => {
  it('drops unknown keys and the wildcard, dedupes, restores catalog order', () => {
    expect(normalizePermissions(['shorts', '*', 'videos', 'nope', 'videos'])).toEqual(['videos', 'shorts']);
    expect(normalizePermissions(null)).toEqual([]);
  });
});

describe('manageSectionsFor / domainViewer', () => {
  it('super admin sees every section, a narrow role only its own', () => {
    expect(manageSectionsFor(superAdmin).length).toBe(MANAGE_SECTIONS.length);
    expect(manageSectionsFor(videosOnly).map((s) => s.href)).toEqual(['/manage/videos', '/manage/shorts']);
    expect(manageSectionsFor(member)).toEqual([]);
  });

  it('domainViewer keeps manage and identity orthogonal', () => {
    expect(domainViewer(null, 'votes')).toEqual({ id: null, canManage: false, canSeeIdentity: false });
    const v = domainViewer({ id: 'u1', roleKey: 'x', permissions: ['votes'] }, 'votes');
    expect(v).toEqual({ id: 'u1', canManage: true, canSeeIdentity: false });
    const w = domainViewer({ id: 'u2', roleKey: 'x', permissions: ['identity'] }, 'votes');
    expect(w).toEqual({ id: 'u2', canManage: false, canSeeIdentity: true });
  });
});

describe('publicRoleBadge', () => {
  it('hides every administrative role from member-facing surfaces', () => {
    expect(
      publicRoleBadge({ key: SUPER_ADMIN_ROLE_KEY, name: '超级管理员', permissions: [WILDCARD_PERMISSION] }),
    ).toBeNull();
    expect(publicRoleBadge({ key: 'admin', name: '管理员', permissions: ['users'] })).toBeNull();
    // A custom role is administrative as soon as it carries ONE permission.
    expect(publicRoleBadge({ key: 'moderator', name: '版务', permissions: ['discussion'] })).toBeNull();
  });

  it('keeps honorific roles — a 专家 with no permissions is a label, not power', () => {
    expect(publicRoleBadge({ key: 'expert', name: '专家', permissions: [] })).toEqual({
      key: 'expert',
      name: '专家',
    });
  });

  it('never badges 普通成员 or a role-less account', () => {
    expect(publicRoleBadge({ key: 'member', name: '普通成员', permissions: [] })).toBeNull();
    expect(publicRoleBadge(null)).toBeNull();
    expect(publicRoleBadge(undefined)).toBeNull();
  });

  it('treats a missing permission list as honorific, not as staff', () => {
    expect(publicRoleBadge({ key: 'guest_speaker', name: '特邀讲者' })).toEqual({
      key: 'guest_speaker',
      name: '特邀讲者',
    });
  });
});
