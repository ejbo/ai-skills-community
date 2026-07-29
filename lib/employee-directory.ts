// 员工名单 → 用户 同步（参照 ai4news core/employee_sync.py 重做）。
//
// Match rule: a directory entry's 工号 (accountNumber) matches a user whose
// `huaweiW3Id` equals it (case-insensitive — W3 工号 常见大小写混写)。
// SECURITY: deliberately NOT matched against `handle` — for password accounts the
// handle derives from the UNVERIFIED email local part (open registration), so an
// outsider registering `<工号>@any.tld` would inherit + publicly display that
// employee's 部门/研究所 and could harvest the (admin-only) roster. huaweiW3Id is
// only ever set through a completed W3 SSO login, i.e. verified identity.
// Push is one-way overwrite INCLUDING clearing: empty directory department/lab
// clears the user's values. Deleting a directory entry never touches users.
// 停用 (isActive=false) entries are excluded from every sync path.
//
// Triggered from: admin create (always), import (every row), update (only when
// 工号/部门/研究所 changed), the manual 全量同步 button — and, unlike ai4news,
// at login (`syncDirectoryToUserAtLogin`), so a user who registers AFTER the
// roster was imported still gets their department without admin action.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface SyncableEntry {
  accountNumber: string | null;
  department: string;
  lab: string;
  isActive: boolean;
}

function matchUsersWhere(account: string): Prisma.UserWhereInput {
  return { huaweiW3Id: { equals: account, mode: 'insensitive' } };
}

/** Push one entry's 部门/研究所 onto matching users. Returns rows updated. */
export async function syncEntryToUsers(entry: SyncableEntry): Promise<number> {
  const account = (entry.accountNumber ?? '').trim();
  if (!account || !entry.isActive) return 0;
  const res = await prisma.user.updateMany({
    where: matchUsersWhere(account),
    data: { department: entry.department || null, lab: entry.lab || null },
  });
  return res.count;
}

/** Full sweep of every active entry with a 工号. */
export async function syncAllEntriesToUsers(): Promise<{ entriesWithAccount: number; usersUpdated: number }> {
  const entries = await prisma.employeeDirectory.findMany({
    where: { isActive: true, accountNumber: { not: null } },
    select: { accountNumber: true, department: true, lab: true, isActive: true },
  });
  let usersUpdated = 0;
  for (const entry of entries) {
    usersUpdated += await syncEntryToUsers(entry);
  }
  return { entriesWithAccount: entries.length, usersUpdated };
}

/**
 * Login-time enrichment: look the user's verified identity key (huaweiW3Id) up
 * in the roster and pull 部门/研究所. Best-effort — must NEVER block a login.
 */
export async function syncDirectoryToUserAtLogin(
  keys: Array<string | null | undefined>,
): Promise<void> {
  const candidates = Array.from(
    new Set(keys.map((k) => (k ?? '').trim()).filter(Boolean)),
  );
  if (!candidates.length) return;
  try {
    const entry = await prisma.employeeDirectory.findFirst({
      where: {
        isActive: true,
        OR: candidates.map((c) => ({ accountNumber: { equals: c, mode: 'insensitive' as const } })),
      },
      select: { accountNumber: true, department: true, lab: true, isActive: true },
    });
    if (entry) await syncEntryToUsers(entry);
  } catch (err) {
    console.error('[employee-directory] login-time sync failed (ignored)', err);
  }
}

/** Distinct non-empty departments/labs for the admin filter dropdowns. */
export async function distinctDirectoryValues(field: 'department' | 'lab'): Promise<string[]> {
  const rows = await prisma.employeeDirectory.findMany({
    where: { [field]: { not: '' } },
    select: { [field]: true },
    distinct: [field],
    orderBy: { [field]: 'asc' },
  });
  return rows.map((r) => (r as Record<string, string>)[field]);
}
