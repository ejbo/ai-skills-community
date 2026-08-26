// Validation + import merge rules for the 员工名单 admin API
// (app/api/admin/employees/*).
//
// 匹配规则住在 lib/employee-match.ts（工号 → 姓名回填 → 拒绝猜测），这里只负责
// 落库：字段覆盖、同名旧行合并、用户同步与计数。要点：
//   - 重新上传同一批人 = 更新既有行（含把工号回填到早期无工号的旧行），不再新建重复行；
//   - 非空值总是覆盖；空值只在 clearMissing 时清空；工号永不清空、永不被改写成另一个；
//   - 停用行会被更新但不会被重新启用（用批量启用）；
//   - 每行处理后都同步到用户（无论新增还是更新）。

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  buildUserAccountIndex,
  canonicalAccountText,
  syncEntryToUsers,
  type UserAccountIndex,
} from '@/lib/employee-directory';
import {
  DirectoryIndex,
  applyImportFields,
  classifyNameDuplicates,
  resolveImportTarget,
  type DirectoryRowLite,
  type ImportRowLite,
} from '@/lib/employee-match';
import type { ParsedEmployeeRow } from '@/lib/employee-import';

const NAME_MAX = 128;
const ACCOUNT_MAX = 64;
const FIELD_MAX = 128;
const AVATAR_MAX = 300;

export const employeeCreateSchema = z.object({
  name: z.string().trim().min(1, '姓名必填').max(NAME_MAX),
  accountNumber: z.string().trim().max(ACCOUNT_MAX).optional().default(''),
  department: z.string().trim().max(FIELD_MAX).optional().default(''),
  lab: z.string().trim().max(FIELD_MAX).optional().default(''),
  avatarUrl: z.string().trim().max(AVATAR_MAX).optional().default(''),
});

export const employeeUpdateSchema = z.object({
  name: z.string().trim().min(1, '姓名必填').max(NAME_MAX).optional(),
  accountNumber: z.string().trim().max(ACCOUNT_MAX).optional(),
  department: z.string().trim().max(FIELD_MAX).optional(),
  lab: z.string().trim().max(FIELD_MAX).optional(),
  avatarUrl: z.string().trim().max(AVATAR_MAX).optional(),
  isActive: z.boolean().optional(),
});

/**
 * 工号 stored as null when blank so the unique index ignores it. Case is
 * canonicalized to lowercase: the DB unique index is case-SENSITIVE while every
 * app-level lookup is case-insensitive — without canonicalization, concurrent
 * imports carrying "Z001" and "z001" would create two rows the app treats as
 * the same 工号 (and the P2002 backstop would never fire). Fullwidth characters
 * are NFKC-folded and whitespace dropped (`canonicalAccountText`) so the stored
 * digit run is ASCII and contiguous — the `contains` prefilter in
 * lib/employee-directory.ts depends on it. The letter prefix is kept as imported
 * (`z84412632` stays `z84412632`); matching goes through `accountMatchKey`.
 */
export function normalizeAccountNumber(v: string | undefined | null): string | null {
  const text = canonicalAccountText(v).slice(0, ACCOUNT_MAX);
  return text || null;
}

/**
 * The import's prebuilt user index is refreshed on this cadence so a user whose
 * FIRST SSO login lands mid-import (their row not yet in the roster at login
 * time, so login-time sync found nothing) is still picked up by the rows that
 * follow, instead of waiting for their next login or a manual 全量同步.
 */
const USER_INDEX_TTL_MS = 5_000;

/** Per-list caps so one bad file can't flood the response / audit log. */
const MAX_REPORTED = 50;

export interface ImportOptions {
  /**
   * 空值也覆盖：导入行留空的 部门/研究所/头像 会清空已有值。默认关闭 —— 从 Excel
   * 粘贴时经常省略末尾列，默认清空会把整表的部门抹掉。工号不受影响（永不清空）。
   */
  clearMissing?: boolean;
  /**
   * 合并同名旧记录：某行匹配到已有记录、且该记录带工号后，删除同名且【无工号】、
   * 且【部门/研究所不矛盾】的历史行（判定见 classifyNameDuplicates）。用于清理
   * "工号匹配上线前，重复上传造出的重复行"。默认关闭 —— 它会删数据，而且每一条
   * 删除都会在 mergedRows 里逐条列出。
   */
  mergeNameDuplicates?: boolean;
}

export interface ImportResult {
  parsedRows: number;
  /** 新建的行 */
  added: number;
  /** 命中已有行并写入了改动 */
  updated: number;
  /** 命中已有行但字段完全相同 */
  unchanged: number;
  /** 其中：把工号补写到早期无工号的旧行 */
  backfilledAccounts: number;
  /** 合并同名旧记录时删除的行数 */
  mergedDuplicates: number;
  /** 被删掉的每一条（姓名 + 部门/研究所）—— 硬删除必须可追溯 */
  mergedRows: string[];
  /** 同名多条无法判定、且该行没有工号 ⇒ 跳过 */
  skipped: number;
  syncedUsers: number;
  /** 可疑但未失败的行（同名歧义、拒绝合并等），供管理员人工处理 */
  warnings: string[];
  errors: string[];
  /** warnings/errors 数组会被截断展示，这两个是真实总数 */
  warningCount: number;
  errorCount: number;
}

function toLite(row: {
  id: string;
  name: string;
  accountNumber: string | null;
  department: string;
  lab: string;
  avatarUrl: string;
  isActive: boolean;
}): DirectoryRowLite {
  return {
    id: row.id,
    name: row.name,
    accountNumber: row.accountNumber,
    department: row.department,
    lab: row.lab,
    avatarUrl: row.avatarUrl,
    isActive: row.isActive,
  };
}

async function loadDirectoryIndex(): Promise<DirectoryIndex> {
  const rows = await prisma.employeeDirectory.findMany({
    select: {
      id: true,
      name: true,
      accountNumber: true,
      department: true,
      lab: true,
      avatarUrl: true,
      isActive: true,
    },
    // Most-recently-updated first, matching `findDirectoryEntries` — so when legacy
    // duplicates share a key both paths pick the same winner.
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  });
  return new DirectoryIndex(rows.map(toLite));
}

export async function importEmployeeRows(
  rows: ParsedEmployeeRow[],
  createdById: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const clearMissing = options.clearMissing === true;
  const mergeNameDuplicates = options.mergeNameDuplicates === true;

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let backfilledAccounts = 0;
  let mergedDuplicates = 0;
  let skipped = 0;
  let syncedUsers = 0;
  // 数组只留前 MAX_REPORTED 条展示，计数器才是真实总数（否则管理员看到 "50 条待确认"
  // 却不知道其实有 500 条）。
  let warningCount = 0;
  let errorCount = 0;
  const warnings: string[] = [];
  const mergedRows: string[] = [];
  const errors: string[] = [];
  const warn = (message: string) => {
    warningCount += 1;
    if (warnings.length < MAX_REPORTED) warnings.push(message);
  };
  const fail = (message: string) => {
    errorCount += 1;
    if (errors.length < MAX_REPORTED) errors.push(message);
  };
  const describe = (r: { name: string; department: string; lab: string }) =>
    `${r.name}（${r.department || '—'}/${r.lab || '—'}）`;

  // Two indexes, each built once. The roster index turns what used to be 1–2
  // queries PER ROW into zero; the user index means roster rows with no
  // registered user (the vast majority) cost no write either.
  const index = await loadDirectoryIndex();
  let userIndex: UserAccountIndex = await buildUserAccountIndex();
  let userIndexAt = Date.now();

  const sync = async (entry: DirectoryRowLite) =>
    syncEntryToUsers(
      { accountNumber: entry.accountNumber, department: entry.department, lab: entry.lab, isActive: entry.isActive },
      userIndex,
    );

  for (const raw of rows) {
    if (Date.now() - userIndexAt > USER_INDEX_TTL_MS) {
      userIndex = await buildUserAccountIndex();
      userIndexAt = Date.now();
    }
    const name = raw.name.trim().slice(0, NAME_MAX);
    if (!name) {
      fail(`姓名必填: ${JSON.stringify(raw)}`);
      continue;
    }
    const accountNumber = normalizeAccountNumber(raw.accountNumber);
    const department = raw.department.trim().slice(0, FIELD_MAX);
    const lab = raw.lab.trim().slice(0, FIELD_MAX);
    const avatarUrl = raw.avatarUrl.trim().slice(0, AVATAR_MAX);
    const lite: ImportRowLite & { avatarUrl: string } = { name, accountNumber, department, lab, avatarUrl };

    try {
      let target = resolveImportTarget(lite, index);

      if (target.kind === 'ambiguous') {
        const where = target.candidates
          .map((c) => `${c.department || '—'}/${c.lab || '—'}`)
          .join('、');
        if (accountNumber) {
          // 有工号 ⇒ 这是一条可独立标识的记录，新建，但提醒管理员去合并。
          warn(`「${name}」同名旧记录有 ${target.candidates.length} 条（${where}），已按工号新建，请人工核对合并`);
          target = { kind: 'create', reason: 'new' };
        } else {
          // 无工号 ⇒ 没有任何东西能区分，再建一条只会加重重复。
          warn(`「${name}」同名有 ${target.candidates.length} 条（${where}）且本行没有工号，已跳过`);
          skipped += 1;
          continue;
        }
      }

      let entry: DirectoryRowLite;

      if (target.kind === 'create') {
        let createdLite: DirectoryRowLite | null = null;
        try {
          const created = await prisma.employeeDirectory.create({
            data: { name, accountNumber, department, lab, avatarUrl, createdById },
          });
          createdLite = toLite(created);
        } catch (err) {
          // Unique race on 工号 (concurrent import) → re-read that row and update it.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && accountNumber) {
            const existing = await prisma.employeeDirectory.findFirst({ where: { accountNumber } });
            if (!existing) throw err;
            createdLite = null;
            const before = toLite(existing);
            index.add(before);
            target = { kind: 'update', entry: before, matchedBy: 'account', backfillAccount: false };
          } else {
            throw err;
          }
        }
        if (createdLite) {
          index.add(createdLite);
          added += 1;
          entry = createdLite;
          syncedUsers += await sync(entry);
          continue;
        }
      }

      // target is 'update' here (either matched, or demoted from a create race).
      if (target.kind !== 'update') throw new Error('unreachable import target');
      const before = target.entry;
      const changes = applyImportFields(before, lite, {
        backfillAccount: target.backfillAccount,
        clearMissing,
      });

      if (Object.keys(changes).length) {
        let after: DirectoryRowLite;
        try {
          after = toLite(await prisma.employeeDirectory.update({ where: { id: before.id }, data: changes }));
        } catch (err) {
          // Backfilling the 工号 collided with a row that already owns it (a duplicate
          // created by an earlier upload). Keep the row, just skip the 工号 write.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002' &&
            changes.accountNumber
          ) {
            warn(`「${name}」的工号 ${changes.accountNumber} 已属于另一条记录，本行只更新了部门/研究所`);
            const { accountNumber: _dropped, ...rest } = changes;
            after = Object.keys(rest).length
              ? toLite(await prisma.employeeDirectory.update({ where: { id: before.id }, data: rest }))
              : before;
          } else {
            throw err;
          }
        }
        index.replace(before, after);
        if (after.accountNumber !== before.accountNumber) backfilledAccounts += 1;
        // after === before ⇒ P2002 兜底后没有任何字段可写，不能算作 updated。
        if (after === before) unchanged += 1;
        else updated += 1;
        entry = after;
      } else {
        unchanged += 1;
        entry = before;
      }

      // 合并：把"工号匹配上线前"重复上传造出的同名无工号旧行删掉 —— 只删部门/研究所
      // 不矛盾的那些；同名但部门对不上的另一个人绝不删，只上报（见 classifyNameDuplicates）。
      if (mergeNameDuplicates && entry.accountNumber) {
        const { merge, refused } = classifyNameDuplicates(lite, entry, before, index);
        for (const dup of merge) {
          await prisma.employeeDirectory.delete({ where: { id: dup.id } });
          index.remove(dup);
          mergedDuplicates += 1;
          // 硬删除 —— 逐条留痕，否则管理员事后无法知道谁被删了、更无法恢复。
          if (mergedRows.length < MAX_REPORTED) mergedRows.push(describe(dup));
        }
        for (const dup of refused) {
          warn(`「${name}」有同名旧记录 ${describe(dup)} 与本次导入的部门/研究所不一致，未删除 —— 请在「仅看重名」里人工确认`);
        }
      }

      syncedUsers += await sync(entry);
    } catch (err) {
      fail(`导入失败（${name}）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    parsedRows: rows.length,
    added,
    updated,
    unchanged,
    backfilledAccounts,
    mergedDuplicates,
    mergedRows,
    skipped,
    syncedUsers,
    warnings,
    errors,
    warningCount,
    errorCount,
  };
}
