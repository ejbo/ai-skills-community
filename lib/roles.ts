// 角色与权限 — server-side role service. SERVER-ONLY (Prisma).
//
// The catalog and the pure checks live in lib/permissions.ts (client-safe);
// this module owns the `Role` table, the effective-role resolution used by the
// session/JWT and the manage gates, and the ONLY writes to `User.isAdmin`
// (a derived "staff" cache — see the schema comment).

import { cache as reactCache } from 'react';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  ADMIN_ROLE_KEY,
  MEMBER_ROLE_KEY,
  PERMISSION_KEYS,
  ROLE_KEY_RE,
  SUPER_ADMIN_ROLE_KEY,
  SYSTEM_ROLE_KEYS,
  WILDCARD_PERMISSION,
  isStaff,
  isSuperAdmin,
  normalizePermissions,
  type PermissionHolder,
} from '@/lib/permissions';

// React's request-scoped `cache` exists only in the server (RSC) build; under
// vitest / plain node it is undefined, so fall back to the bare function.
const memo: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === 'function' ? reactCache : (fn) => fn;

export const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: true,
  sortOrder: true,
} as const;

export type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

/** Fixed ids so the migration backfill and this seed agree; lookups use `key`. */
export const SYSTEM_ROLES: ReadonlyArray<{
  id: string;
  key: (typeof SYSTEM_ROLE_KEYS)[number];
  name: string;
  description: string;
  permissions: string[];
  sortOrder: number;
}> = [
  {
    id: 'role_super_admin',
    key: SUPER_ADMIN_ROLE_KEY,
    name: '超级管理员',
    description: '拥有全部权限；唯一可以配置角色与权限、指派角色的角色。',
    permissions: [WILDCARD_PERMISSION],
    sortOrder: 0,
  },
  {
    id: 'role_admin',
    key: ADMIN_ROLE_KEY,
    name: '管理员',
    description: '默认管理员：拥有全部后台与站内治理权限，但不能配置角色。',
    permissions: [...PERMISSION_KEYS],
    sortOrder: 10,
  },
  {
    id: 'role_member',
    key: MEMBER_ROLE_KEY,
    name: '普通成员',
    description: '默认角色：没有任何后台或治理权限。',
    permissions: [],
    sortOrder: 1000,
  },
];

export class RoleError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number = 400,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'RoleError';
  }
}

export interface EffectiveRole extends PermissionHolder {
  roleId: string | null;
  roleKey: string;
  roleName: string;
  permissions: string[];
  isStaff: boolean;
  isSuperAdmin: boolean;
}

const MEMBER_FALLBACK: EffectiveRole = Object.freeze({
  roleId: null,
  roleKey: MEMBER_ROLE_KEY,
  roleName: '普通成员',
  permissions: [],
  isStaff: false,
  isSuperAdmin: false,
});

/** null role (no assignment) ⇒ 普通成员. */
export function effectiveRole(role: RoleRow | null | undefined): EffectiveRole {
  if (!role) return MEMBER_FALLBACK;
  const holder = { roleKey: role.key, permissions: role.permissions };
  return {
    roleId: role.id,
    roleKey: role.key,
    roleName: role.name,
    permissions: [...role.permissions],
    isStaff: isStaff(holder),
    isSuperAdmin: isSuperAdmin(holder),
  };
}

/** The value `User.isAdmin` must cache for a user holding `role`. */
export function computeIsAdmin(role: RoleRow | null | undefined): boolean {
  return effectiveRole(role).isStaff;
}

const LEGACY_SUPER: EffectiveRole = Object.freeze({
  roleId: null,
  roleKey: SUPER_ADMIN_ROLE_KEY,
  roleName: '超级管理员（旧版管理员，未指派角色）',
  permissions: [WILDCARD_PERMISSION],
  isStaff: true,
  isSuperAdmin: true,
});

/**
 * Role for a user ROW. Transitional safety net: an account with `isAdmin=true`
 * but NO role is a pre-RBAC admin whose row was never backfilled (a `prisma db
 * push` deploy that skipped the migration's UPDATE, or a DB restored from an
 * old dump). The migration promotes exactly those users to super_admin, so we
 * resolve them the same way instead of locking every admin out of 管理后台.
 * Assigning any role (or running scripts/sync-roles.ts) makes it explicit.
 */
export function roleForUserRow(row: { role: RoleRow | null | undefined; isAdmin: boolean }): EffectiveRole {
  if (!row.role && row.isAdmin) return LEGACY_SUPER;
  return effectiveRole(row.role);
}

/**
 * Authoritative (DB-backed) role for a user — what the manage gates read, so a
 * revoked role locks the panel on the very next request regardless of the JWT
 * copy. Returns null for a missing OR DISABLED account. Per-request memoized.
 */
export const getEffectiveRoleForUser = memo(async (userId: string): Promise<EffectiveRole | null> => {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, isAdmin: true, role: { select: ROLE_SELECT } },
  });
  if (!u || !u.isActive) return null;
  return roleForUserRow(u);
});

/** Idempotent: creates missing system roles; re-locks super_admin's wildcard. Never touches `admin`'s edited permissions. */
export async function ensureSystemRoles(db: Prisma.TransactionClient | typeof prisma = prisma) {
  for (const r of SYSTEM_ROLES) {
    await db.role.upsert({
      where: { key: r.key },
      create: { ...r, isSystem: true },
      update:
        r.key === SUPER_ADMIN_ROLE_KEY
          ? { isSystem: true, permissions: [WILDCARD_PERMISSION] }
          : r.key === MEMBER_ROLE_KEY
            ? { isSystem: true, permissions: [] }
            : { isSystem: true },
    });
  }
}

export async function getRoleByKey(key: string): Promise<RoleRow | null> {
  return prisma.role.findUnique({ where: { key }, select: ROLE_SELECT });
}

export async function listRoles(): Promise<RoleRow[]> {
  return prisma.role.findMany({ select: ROLE_SELECT, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
}

export async function listRolesWithCounts(): Promise<Array<RoleRow & { userCount: number }>> {
  const [rows, unassigned] = await Promise.all([
    prisma.role.findMany({
      select: { ...ROLE_SELECT, _count: { select: { users: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    // Accounts created after the migration have roleId NULL until assigned — they ARE members.
    prisma.user.count({ where: { roleId: null, isAdmin: false } }),
  ]);
  return rows.map(({ _count, ...r }) => ({
    ...r,
    userCount: _count.users + (r.key === MEMBER_ROLE_KEY ? unassigned : 0),
  }));
}

export interface RoleInput {
  key: string;
  name: string;
  description?: string | null;
  permissions: string[];
  sortOrder?: number;
}

function validateName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 40) throw new RoleError('invalid_name');
  return n;
}

function validateKey(key: string): string {
  const k = key.trim().toLowerCase();
  if (!ROLE_KEY_RE.test(k)) throw new RoleError('invalid_key');
  if ((SYSTEM_ROLE_KEYS as readonly string[]).includes(k)) throw new RoleError('reserved_key');
  return k;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export async function createRole(input: RoleInput): Promise<RoleRow> {
  const key = validateKey(input.key);
  const name = validateName(input.name);
  const permissions = normalizePermissions(input.permissions);
  try {
    return await prisma.role.create({
      data: {
        key,
        name,
        description: input.description?.trim() || null,
        permissions,
        sortOrder: input.sortOrder ?? 100,
        isSystem: false,
      },
      select: ROLE_SELECT,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new RoleError('key_taken', 409);
    }
    throw e;
  }
}

/**
 * Edit a role. Locks: a system role keeps its key; super_admin keeps the
 * wildcard and member keeps the empty list (only `admin` among the system
 * roles is permission-editable). A permission change re-syncs the isAdmin
 * cache of every holder in the same transaction.
 */
export async function updateRole(id: string, patch: Partial<RoleInput>): Promise<RoleRow> {
  const current = await prisma.role.findUnique({ where: { id }, select: ROLE_SELECT });
  if (!current) throw new RoleError('not_found', 404);

  const data: Prisma.RoleUpdateInput = {};
  if (patch.name !== undefined) data.name = validateName(patch.name);
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.key !== undefined && patch.key.trim().toLowerCase() !== current.key) {
    if (current.isSystem) throw new RoleError('system_key_locked');
    data.key = validateKey(patch.key);
  }

  let permissionsChanged = false;
  // super_admin (always ['*']) and member (always []) ignore the field entirely —
  // their lists are not data, so an echo or an attempted change is a no-op, never an error.
  const permissionsLocked = current.key === SUPER_ADMIN_ROLE_KEY || current.key === MEMBER_ROLE_KEY;
  if (patch.permissions !== undefined && !permissionsLocked) {
    const next = normalizePermissions(patch.permissions);
    if (!sameSet(next, current.permissions)) {
      data.permissions = next;
      permissionsChanged = true;
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({ where: { id }, data, select: ROLE_SELECT });
      if (permissionsChanged) {
        await tx.user.updateMany({ where: { roleId: id }, data: { isAdmin: computeIsAdmin(updated) } });
      }
      return updated;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new RoleError('key_taken', 409);
    }
    throw e;
  }
}

/** Delete a custom role. Refused while anyone holds it (the FK would silently demote them). */
export async function deleteRole(id: string): Promise<RoleRow> {
  return prisma.$transaction(
    async (tx) => {
      const current = await tx.role.findUnique({ where: { id }, select: ROLE_SELECT });
      if (!current) throw new RoleError('not_found', 404);
      if (current.isSystem) throw new RoleError('system_role');
      const holders = await tx.user.count({ where: { roleId: id } });
      if (holders > 0) throw new RoleError('role_in_use', 409);
      await tx.role.delete({ where: { id } });
      return current;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Assign a role to a user. Super admin only; never your own account (no
 * self-lockout, no self-promotion path); the last active super admin cannot
 * be demoted. `roleId: null` ⇒ the member role.
 */
export async function assignRole(opts: {
  actor: { id: string } & PermissionHolder;
  targetUserId: string;
  roleId: string | null;
}): Promise<{ before: RoleRow | null; after: RoleRow | null }> {
  if (!isSuperAdmin(opts.actor)) throw new RoleError('forbidden', 403);
  if (opts.actor.id === opts.targetUserId) throw new RoleError('self_change', 400);

  return prisma.$transaction(
    async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: opts.targetUserId },
        select: { id: true, isAdmin: true, role: { select: ROLE_SELECT } },
      });
      if (!target) throw new RoleError('not_found', 404);

      const next = opts.roleId
        ? await tx.role.findUnique({ where: { id: opts.roleId }, select: ROLE_SELECT })
        : await tx.role.findUnique({ where: { key: MEMBER_ROLE_KEY }, select: ROLE_SELECT });
      if (opts.roleId && !next) throw new RoleError('unknown_role', 400);

      // Legacy-aware: a role-less isAdmin row counts as a super admin (roleForUserRow).
      if (roleForUserRow(target).isSuperAdmin && next?.key !== SUPER_ADMIN_ROLE_KEY) {
        const remaining = await countActiveSuperAdmins(tx, target.id);
        if (remaining === 0) throw new RoleError('last_super_admin', 409);
      }

      await tx.user.update({
        where: { id: target.id },
        data: { roleId: next?.id ?? null, isAdmin: computeIsAdmin(next) },
      });
      return { before: target.role, after: next };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** Active super admins other than `excludeUserId` — by role OR legacy (role-less isAdmin). */
async function countActiveSuperAdmins(db: Prisma.TransactionClient | typeof prisma, excludeUserId: string) {
  return db.user.count({
    where: {
      isActive: true,
      id: { not: excludeUserId },
      OR: [{ role: { key: SUPER_ADMIN_ROLE_KEY } }, { roleId: null, isAdmin: true }],
    },
  });
}

/**
 * Would disabling `userId` leave the site without an active super admin?
 * Used by the isActive toggle so 账号启用 can never lock everyone out. Pass the
 * transaction client to make the check-then-act atomic.
 */
export async function isLastActiveSuperAdmin(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, isAdmin: true, role: { select: ROLE_SELECT } },
  });
  if (!u || !u.isActive || !roleForUserRow(u).isSuperAdmin) return false;
  return (await countActiveSuperAdmins(db, userId)) === 0;
}

/** Prisma's serialization-failure code — a retry-or-409 signal, never a 500. */
export function isSerializationFailure(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
}

/**
 * Maintenance (scripts/sync-roles.ts): make legacy admins explicit super admins,
 * give role-less members the member row, then recompute every isAdmin cache.
 */
export async function resyncIsAdminCache(): Promise<{ legacyPromoted: number; membersFilled: number; staff: number; members: number }> {
  await ensureSystemRoles();
  const superRole = await prisma.role.findUniqueOrThrow({ where: { key: SUPER_ADMIN_ROLE_KEY }, select: { id: true } });
  const memberRole = await prisma.role.findUniqueOrThrow({ where: { key: MEMBER_ROLE_KEY }, select: { id: true } });
  const legacy = await prisma.user.updateMany({ where: { roleId: null, isAdmin: true }, data: { roleId: superRole.id } });
  const filled = await prisma.user.updateMany({ where: { roleId: null }, data: { roleId: memberRole.id } });
  const roles = await listRoles();
  const staffRoleIds = roles.filter((r) => computeIsAdmin(r)).map((r) => r.id);
  const [staff, members] = await prisma.$transaction([
    prisma.user.updateMany({ where: { roleId: { in: staffRoleIds } }, data: { isAdmin: true } }),
    prisma.user.updateMany({
      where: { OR: [{ roleId: null }, { roleId: { notIn: staffRoleIds } }] },
      data: { isAdmin: false },
    }),
  ]);
  return { legacyPromoted: legacy.count, membersFilled: filled.count, staff: staff.count, members: members.count };
}
