// 员工名单导入的「这一行对应哪条已有记录」判定。
//
// WHY THIS EXISTS: the roster was first imported WITHOUT 工号 (name + 部门 only).
// Re-uploading the same people with their 工号 filled in used to match nothing —
// the 工号 lookup missed (old rows have accountNumber = null) and the account-less
// fallback demanded an exact (姓名, 部门, 研究所) triple, which a corrected 部门
// breaks — so every re-upload CREATED a duplicate row instead of updating.
//
// The rule now, in order:
//   1. 工号 (digit key, `accountMatchKey`) — the only identity we trust.
//   2. 姓名 (`canonicalPersonName`) among rows that have NO 工号 — those are the
//      pre-工号 rows, so the import's 工号 is BACKFILLED onto the row it matches.
//      Narrowed by 部门 then 研究所 when several same-name rows compete.
//   3. For an import row that itself carries no 工号: the single row with that
//      name, whatever its 工号 — updated WITHOUT ever touching that 工号.
// Anything still ambiguous is REFUSED (never guessed): a row with a 工号 is
// created as a new person, a row without one is skipped, and both are reported.
//
// A name never steals a 工号 that is already on another row: rule 2 only ever
// looks at account-less rows, so two people sharing a name can't be merged just
// because one of them was imported later.
//
// Pure logic over plain objects (the index is built from an array) so the whole
// decision table is unit-testable without a database — see tests/employee-match.test.ts.

import { accountMatchKey, canonicalPersonName } from '@/lib/employee-directory';

/**
 * The subset of an EmployeeDirectory row the matcher needs. `isActive` is carried
 * for the caller's user-sync decision only — a 停用 row is still a valid match
 * target (re-importing someone must update their row, not duplicate it), and an
 * import deliberately never re-activates them: 停用 is an explicit admin decision,
 * undone with 批量启用.
 */
export interface DirectoryRowLite {
  id: string;
  name: string;
  accountNumber: string | null;
  department: string;
  lab: string;
  avatarUrl: string;
  isActive: boolean;
}

/** The subset of a parsed import row the matcher needs (already trimmed/normalized). */
export interface ImportRowLite {
  name: string;
  accountNumber: string | null;
  department: string;
  lab: string;
}

function pushInto(map: Map<string, DirectoryRowLite[]>, key: string, row: DirectoryRowLite) {
  const bucket = map.get(key);
  if (bucket) bucket.push(row);
  else map.set(key, [row]);
}

function dropFrom(map: Map<string, DirectoryRowLite[]>, key: string, id: string) {
  const bucket = map.get(key);
  if (!bucket) return;
  const at = bucket.findIndex((r) => r.id === id);
  if (at >= 0) bucket.splice(at, 1);
  if (!bucket.length) map.delete(key);
}

/**
 * In-memory 工号/姓名 index over the whole roster. Built ONCE per import: the old
 * per-row `findFirst` made a 20 000-row file 20 000 round trips, and the name
 * fallback would have added a second one. Kept in sync as the import creates,
 * updates and merges rows, so two identical lines in one file update the same row
 * instead of racing each other into duplicates.
 */
export class DirectoryIndex {
  private byKey = new Map<string, DirectoryRowLite[]>();
  private byName = new Map<string, DirectoryRowLite[]>();

  constructor(rows: DirectoryRowLite[] = []) {
    for (const row of rows) this.add(row);
  }

  add(row: DirectoryRowLite): void {
    const key = accountMatchKey(row.accountNumber);
    if (key) pushInto(this.byKey, key, row);
    const name = canonicalPersonName(row.name);
    if (name) pushInto(this.byName, name, row);
  }

  remove(row: DirectoryRowLite): void {
    const key = accountMatchKey(row.accountNumber);
    if (key) dropFrom(this.byKey, key, row.id);
    const name = canonicalPersonName(row.name);
    if (name) dropFrom(this.byName, name, row.id);
  }

  /** Re-key a row after an update changed its 工号 or 姓名. */
  replace(before: DirectoryRowLite, after: DirectoryRowLite): void {
    this.remove(before);
    this.add(after);
  }

  /** Rows sharing `account`'s digit key, most recently updated first (load order). */
  byAccount(account: string | null | undefined): DirectoryRowLite[] {
    const key = accountMatchKey(account);
    return key ? (this.byKey.get(key) ?? []) : [];
  }

  /** Rows sharing this name, most recently updated first (load order). */
  byPersonName(name: string | null | undefined): DirectoryRowLite[] {
    const key = canonicalPersonName(name);
    return key ? (this.byName.get(key) ?? []) : [];
  }
}

export type ImportTarget =
  /** No existing row denotes this person — insert. */
  | { kind: 'create'; reason: 'new' }
  /** Update this row. `backfillAccount` writes the import's 工号 onto a row that had none. */
  | { kind: 'update'; entry: DirectoryRowLite; matchedBy: 'account' | 'name'; backfillAccount: boolean }
  /** Several rows could be this person — refuse to guess; the caller creates (工号 present) or skips. */
  | { kind: 'ambiguous'; candidates: DirectoryRowLite[] };

/** Prefer candidates whose 部门 (then 研究所) equals the import row's, when it says. */
function narrow(candidates: DirectoryRowLite[], row: ImportRowLite): DirectoryRowLite[] {
  let out = candidates;
  if (out.length > 1 && row.department) {
    const hit = out.filter((c) => c.department === row.department);
    if (hit.length) out = hit;
  }
  if (out.length > 1 && row.lab) {
    const hit = out.filter((c) => c.lab === row.lab);
    if (hit.length) out = hit;
  }
  return out;
}

export function resolveImportTarget(row: ImportRowLite, index: DirectoryIndex): ImportTarget {
  // 1. 工号 — the only identity that is trusted outright.
  if (row.accountNumber) {
    const byAccount = index.byAccount(row.accountNumber);
    if (byAccount.length) {
      return { kind: 'update', entry: byAccount[0], matchedBy: 'account', backfillAccount: false };
    }
  }

  const sameName = index.byPersonName(row.name);
  if (!sameName.length) return { kind: 'create', reason: 'new' };

  if (row.accountNumber) {
    // 2. This 工号 is new to the roster. Adopt a pre-工号 row with the same name and
    // backfill the 工号 onto it. Rows that already carry a DIFFERENT 工号 are other
    // people — never re-label them.
    const free = narrow(
      sameName.filter((c) => !c.accountNumber),
      row,
    );
    if (free.length === 1) return { kind: 'update', entry: free[0], matchedBy: 'name', backfillAccount: true };
    if (free.length > 1) return { kind: 'ambiguous', candidates: free };
    return { kind: 'create', reason: 'new' };
  }

  // 3. Import row has no 工号: prefer an account-less row, else the single row with
  // that name (its 工号 is preserved — see applyImportFields).
  const free = narrow(
    sameName.filter((c) => !c.accountNumber),
    row,
  );
  if (free.length === 1) return { kind: 'update', entry: free[0], matchedBy: 'name', backfillAccount: false };
  if (free.length > 1) return { kind: 'ambiguous', candidates: free };

  const all = narrow(sameName, row);
  if (all.length === 1) return { kind: 'update', entry: all[0], matchedBy: 'name', backfillAccount: false };
  return { kind: 'ambiguous', candidates: all };
}

export interface DuplicateVerdict {
  /** Safe to delete: a pre-工号 leftover of the SAME person. */
  merge: DirectoryRowLite[];
  /** Same name but contradicts on 部门/研究所 — probably a DIFFERENT person. Never deleted. */
  refused: DirectoryRowLite[];
}

/**
 * Split the same-name account-less rows into "this person's pre-工号 leftover" and
 * "someone else who happens to share the name".
 *
 * WHY THIS IS NOT JUST `filter(!accountNumber)`: it was, and it deleted real
 * employees. 王伟/z84412632/无线 plus a legacy 王伟//终端 (a different person) →
 * re-uploading the 无线 list wiped the 终端 王伟, even on an import that changed
 * nothing else. Worse, `narrow()` had often JUST used 部门 to decide those two rows
 * are different people, and `resolveImportTarget` refuses to even UPDATE a row it
 * can't disambiguate — so deleting it was the one place this module broke its own
 * "never guess" rule.
 *
 * No field can PROVE two same-name rows are one person (a stale 部门 is exactly why
 * the old exact-triple match failed), so the rule is the conservative one: delete
 * only rows that CONTRADICT nothing — 部门/研究所 blank, or equal to the import
 * row's, or to the kept row's value before/after this update. Everything else is
 * reported for a human to settle in 仅看重名. The caller must report each deletion
 * individually: a hard delete with only an aggregate count is unauditable.
 */
export function classifyNameDuplicates(
  row: ImportRowLite,
  kept: DirectoryRowLite,
  keptBefore: DirectoryRowLite,
  index: DirectoryIndex,
): DuplicateVerdict {
  const compatible = (dup: DirectoryRowLite, field: 'department' | 'lab') => {
    const value = dup[field];
    return !value || value === row[field] || value === keptBefore[field] || value === kept[field];
  };
  const merge: DirectoryRowLite[] = [];
  const refused: DirectoryRowLite[] = [];
  for (const dup of index.byPersonName(row.name)) {
    if (dup.id === kept.id || dup.accountNumber) continue;
    if (compatible(dup, 'department') && compatible(dup, 'lab')) merge.push(dup);
    else refused.push(dup);
  }
  return { merge, refused };
}

export interface FieldChanges {
  name?: string;
  accountNumber?: string | null;
  department?: string;
  lab?: string;
  avatarUrl?: string;
}

/**
 * What an import row overwrites on the row it matched. Non-empty values always
 * win (that is the "覆盖" the admin expects from re-uploading a corrected list);
 * blanks only clear when `clearMissing` is on, because a pasted line that simply
 * omits trailing columns must not wipe a department.
 *
 * 工号 is NEVER cleared and never overwritten with a different one here: it is the
 * identity key user-sync depends on, and `backfillAccount` (set only for a row
 * that had none) is the single path that writes it.
 */
export function applyImportFields(
  entry: DirectoryRowLite,
  row: ImportRowLite & { avatarUrl: string },
  opts: { backfillAccount: boolean; clearMissing: boolean },
): FieldChanges {
  const changes: FieldChanges = {};
  if (row.name && entry.name !== row.name) changes.name = row.name;
  if (opts.backfillAccount && row.accountNumber && entry.accountNumber !== row.accountNumber) {
    changes.accountNumber = row.accountNumber;
  }
  for (const field of ['department', 'lab', 'avatarUrl'] as const) {
    const next = row[field];
    if (next) {
      if (entry[field] !== next) changes[field] = next;
    } else if (opts.clearMissing && entry[field] !== '') {
      changes[field] = '';
    }
  }
  return changes;
}
