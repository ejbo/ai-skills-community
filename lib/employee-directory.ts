// 员工名单 → 用户 同步（参照 ai4news core/employee_sync.py 重做）。
//
// Match rule: a directory entry's 工号 (accountNumber) matches a user whose
// `huaweiW3Id` denotes the same employee under `accountMatchKey` — i.e. the two
// agree on their DIGIT RUN. The roster is usually exported with the W3 ACCOUNT
// (`z84412632`: surname initial + employee number, sometimes upper-cased) while
// the SSO `uid` we store in `huaweiW3Id` is the bare employee number
// (`84412632`), so a literal comparison never matched anyone. Digits are compared
// as a STRING (leading zeros significant: `00412632` ≠ `412632`) and a digit-less
// value keys on its lowercased text, so nothing that used to match stops matching.
// SECURITY: deliberately NOT matched against `handle` — for password accounts the
// handle derives from the UNVERIFIED email local part (open registration), so an
// outsider registering `<工号>@any.tld` would inherit + publicly display that
// employee's 部门/研究所 and could harvest the (admin-only) roster. huaweiW3Id is
// only ever set through a completed W3 SSO login, i.e. verified identity — the
// digit key does not weaken that: it is still only ever compared against a
// W3-verified uid.
// Push is one-way overwrite INCLUDING clearing: empty directory department/lab
// clears the user's values. Deleting a directory entry never touches users.
// 停用 (isActive=false) entries are excluded from every sync path.
//
// Triggered from: admin create (always), import (every row), update (only when
// 工号/部门/研究所 changed), the manual 全量同步 button — and, unlike ai4news,
// at login (`syncDirectoryToUserAtLogin`), so a user who registers AFTER the
// roster was imported still gets their department without admin action.
//
// DB contract: Prisma cannot express "digits of column = key", so every lookup
// is a `contains`/`equals` PRE-FILTER (over-approximation) followed by an exact
// `accountMatchKey` re-check in app code. Never trust the prefilter alone.

import type { EmployeeDirectory } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface SyncableEntry {
  accountNumber: string | null;
  department: string;
  lab: string;
  isActive: boolean;
}

/**
 * Canonical TEXT form of a 工号 as stored / typed: NFKC-folded (fullwidth
 * `ｚ８４４１２６３２` from old Excel exports → `z84412632`), whitespace removed,
 * lowercased. `normalizeAccountNumber` (lib/employee-admin.ts) persists exactly
 * this, which is what lets the `contains` prefilter below assume the stored digit
 * run is ASCII and contiguous.
 */
export function canonicalAccountText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/**
 * Canonical matching key for a 工号 / W3 uid: the digit run when the value has
 * any digit (`z84412632`, `Z84412632`, `84412632` → `84412632`), otherwise the
 * canonical text. `null` for blank input. Compare keys with `===` — never
 * numerically (leading zeros are part of the employee number).
 */
export function accountMatchKey(value: string | null | undefined): string | null {
  const text = canonicalAccountText(value);
  if (!text) return null;
  const digits = text.replace(/\D+/g, '');
  return digits || text;
}

/** True when two 工号 spellings denote the same employee under `accountMatchKey`. */
export function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = accountMatchKey(a);
  return ka !== null && ka === accountMatchKey(b);
}

/**
 * Prisma pre-filter that over-approximates `accountMatchKey(column) === key`.
 * A digit key uses `contains` (`z84412632` ⊇ `84412632`); a text key is an
 * insensitive equality. Callers MUST re-check every row with `accountMatchKey`.
 * Known limit: a stored 工号 whose digit run is split by a NON-space separator
 * (`8441-2632`) has the right key but is invisible to the prefilter — Huawei
 * numbering never does that, and whitespace/fullwidth are folded at write time.
 */
function keyPrefilter(key: string): { contains: string } | { equals: string; mode: 'insensitive' } {
  return /^\d+$/.test(key) ? { contains: key } : { equals: key, mode: 'insensitive' };
}

/**
 * Directory rows whose 工号 matches `account`, MOST RECENTLY UPDATED first. That
 * is the one precedence rule for legacy duplicates (`84412632` + `z84412632`
 * imported before digit matching existed): login-time sync takes `[0]`, and
 * `syncAllEntriesToUsers` writes oldest→newest so the same row wins there too —
 * never let the two paths disagree or a user's department flip-flops.
 */
export async function findDirectoryEntries(
  account: string | null | undefined,
  opts: { activeOnly?: boolean } = {},
): Promise<EmployeeDirectory[]> {
  const key = accountMatchKey(account);
  if (!key) return [];
  const rows = await prisma.employeeDirectory.findMany({
    where: { accountNumber: keyPrefilter(key), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  });
  return rows.filter((r) => accountMatchKey(r.accountNumber) === key);
}

/** Registered users (ids) whose W3-verified uid matches `key`. */
async function userIdsForKey(key: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { huaweiW3Id: keyPrefilter(key) },
    select: { id: true, huaweiW3Id: true },
  });
  return users.filter((u) => accountMatchKey(u.huaweiW3Id) === key).map((u) => u.id);
}

/** `accountMatchKey(huaweiW3Id)` → user ids, for bulk paths (import / 全量同步). */
export type UserAccountIndex = Map<string, string[]>;

export async function buildUserAccountIndex(): Promise<UserAccountIndex> {
  const users = await prisma.user.findMany({
    where: { huaweiW3Id: { not: null } },
    select: { id: true, huaweiW3Id: true },
  });
  const index: UserAccountIndex = new Map();
  for (const u of users) {
    const key = accountMatchKey(u.huaweiW3Id);
    if (!key) continue;
    const ids = index.get(key);
    if (ids) ids.push(u.id);
    else index.set(key, [u.id]);
  }
  return index;
}

/**
 * Which of `accounts` (工号 spellings) have a registered user. Returns the set of
 * MATCH KEYS (`accountMatchKey`) that are linked — test membership with the key
 * of each row, not its raw spelling.
 */
export async function linkedAccountKeys(accounts: Array<string | null | undefined>): Promise<Set<string>> {
  const keys = Array.from(new Set(accounts.map(accountMatchKey).filter((k): k is string => k !== null)));
  const linked = new Set<string>();
  if (!keys.length) return linked;
  const users = await prisma.user.findMany({
    where: { OR: keys.map((k) => ({ huaweiW3Id: keyPrefilter(k) })) },
    select: { huaweiW3Id: true },
  });
  const wanted = new Set(keys);
  for (const u of users) {
    const key = accountMatchKey(u.huaweiW3Id);
    if (key && wanted.has(key)) linked.add(key);
  }
  return linked;
}

/**
 * Push one entry's 部门/研究所 onto matching users. Returns rows updated.
 * Pass a prebuilt `index` on bulk paths so an entry with no registered user
 * (the common case for a full roster) costs no query at all.
 */
export async function syncEntryToUsers(entry: SyncableEntry, index?: UserAccountIndex): Promise<number> {
  const key = accountMatchKey(entry.accountNumber);
  if (!key || !entry.isActive) return 0;
  const ids = index ? (index.get(key) ?? []) : await userIdsForKey(key);
  if (!ids.length) return 0;
  const res = await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { department: entry.department || null, lab: entry.lab || null },
  });
  return res.count;
}

/**
 * Full sweep of every active entry with a 工号. Entries are applied oldest-updated
 * first so, when legacy duplicates share a key, the most recently updated row
 * writes last and wins — the mirror image of `findDirectoryEntries`' order.
 */
export async function syncAllEntriesToUsers(): Promise<{ entriesWithAccount: number; usersUpdated: number }> {
  const [entries, index] = await Promise.all([
    prisma.employeeDirectory.findMany({
      where: { isActive: true, accountNumber: { not: null } },
      select: { accountNumber: true, department: true, lab: true, isActive: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'desc' }],
    }),
    buildUserAccountIndex(),
  ]);
  let usersUpdated = 0;
  for (const entry of entries) {
    usersUpdated += await syncEntryToUsers(entry, index);
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
    for (const candidate of candidates) {
      const [entry] = await findDirectoryEntries(candidate, { activeOnly: true });
      if (entry) {
        await syncEntryToUsers(entry);
        return;
      }
    }
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
