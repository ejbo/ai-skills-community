import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PERMISSION_KEYS, SUPER_ADMIN_ROLE_KEY, MEMBER_ROLE_KEY, ADMIN_ROLE_KEY } from '@/lib/permissions';
import { SYSTEM_ROLES, computeIsAdmin, effectiveRole } from '@/lib/roles';

const row = (key: string, permissions: string[], extra: Partial<{ id: string; name: string }> = {}) => ({
  id: extra.id ?? `role_${key}`,
  key,
  name: extra.name ?? key,
  description: null,
  isSystem: false,
  permissions,
  sortOrder: 100,
});

describe('effectiveRole', () => {
  it('null ⇒ 普通成员 with nothing', () => {
    const r = effectiveRole(null);
    expect(r.roleKey).toBe(MEMBER_ROLE_KEY);
    expect(r.isStaff).toBe(false);
    expect(r.isSuperAdmin).toBe(false);
    expect(r.permissions).toEqual([]);
  });

  it('super admin by key is staff + super regardless of its list', () => {
    const r = effectiveRole(row(SUPER_ADMIN_ROLE_KEY, []));
    expect(r.isSuperAdmin).toBe(true);
    expect(r.isStaff).toBe(true);
  });

  it('isAdmin cache = "has any permission"', () => {
    expect(computeIsAdmin(row('x', ['videos']))).toBe(true);
    expect(computeIsAdmin(row('x', []))).toBe(false);
    expect(computeIsAdmin(row('x', ['bogus']))).toBe(false);
    expect(computeIsAdmin(null)).toBe(false);
  });
});

describe('system role seeds stay in sync with the catalog', () => {
  it('lib/roles.ts admin role carries every catalog key', () => {
    const admin = SYSTEM_ROLES.find((r) => r.key === ADMIN_ROLE_KEY)!;
    expect([...admin.permissions].sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(SYSTEM_ROLES.find((r) => r.key === SUPER_ADMIN_ROLE_KEY)!.permissions).toEqual(['*']);
    expect(SYSTEM_ROLES.find((r) => r.key === MEMBER_ROLE_KEY)!.permissions).toEqual([]);
  });

  it('scripts/seed.ts mirrors the admin permission list (it cannot import lib/)', () => {
    const src = readFileSync(resolve(__dirname, '..', 'scripts', 'seed.ts'), 'utf8');
    const m = src.match(/key: 'admin'[\s\S]*?permissions: \[([^\]]*)\]/);
    expect(m, 'admin role block in scripts/seed.ts').toBeTruthy();
    const keys = m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect(keys.sort()).toEqual([...PERMISSION_KEYS].sort());
  });
});
