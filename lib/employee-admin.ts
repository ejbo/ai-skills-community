// Validation + import merge rules for the 员工名单 admin API
// (app/api/admin/employees/*). Merge rules ported from ai4news:
//   - 有工号 → 按工号 upsert（更新时：姓名不同则覆盖；部门/研究所仅在导入值非空时覆盖；
//     头像从不更新已有行）
//   - 无工号 → 按 (姓名, 部门, 研究所) 三元组判重
//   - 每行处理后都同步到用户（无论新增还是更新）

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { syncEntryToUsers } from '@/lib/employee-directory';
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
 * the same 工号 (and the P2002 backstop would never fire).
 */
export function normalizeAccountNumber(v: string | undefined | null): string | null {
  const trimmed = (v ?? '').trim().slice(0, ACCOUNT_MAX).toLowerCase();
  return trimmed || null;
}

export interface ImportResult {
  parsedRows: number;
  added: number;
  skippedOrUpdated: number;
  syncedUsers: number;
  errors: string[];
}

export async function importEmployeeRows(
  rows: ParsedEmployeeRow[],
  createdById: string,
): Promise<ImportResult> {
  let added = 0;
  let skippedOrUpdated = 0;
  let syncedUsers = 0;
  const errors: string[] = [];

  for (const raw of rows) {
    const name = raw.name.trim().slice(0, NAME_MAX);
    if (!name) {
      errors.push(`姓名必填: ${JSON.stringify(raw)}`);
      continue;
    }
    const accountNumber = normalizeAccountNumber(raw.accountNumber);
    const department = raw.department.trim().slice(0, FIELD_MAX);
    const lab = raw.lab.trim().slice(0, FIELD_MAX);
    const avatarUrl = raw.avatarUrl.trim().slice(0, AVATAR_MAX);

    try {
      let entry;
      let created = false;
      if (accountNumber) {
        entry = await prisma.employeeDirectory.findFirst({
          where: { accountNumber: { equals: accountNumber, mode: 'insensitive' } },
        });
      } else {
        entry = await prisma.employeeDirectory.findFirst({
          where: { accountNumber: null, name, department, lab },
        });
      }
      if (!entry) {
        try {
          entry = await prisma.employeeDirectory.create({
            data: { name, accountNumber, department, lab, avatarUrl, createdById },
          });
          created = true;
        } catch (err) {
          // Unique race on 工号 (concurrent import) → re-read and fall through to update.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && accountNumber) {
            entry = await prisma.employeeDirectory.findFirst({
              where: { accountNumber: { equals: accountNumber, mode: 'insensitive' } },
            });
          }
          if (!entry) throw err;
        }
      }

      if (created) {
        added += 1;
      } else {
        const data: Prisma.EmployeeDirectoryUpdateInput = {};
        if (entry.name !== name) data.name = name;
        if (department && entry.department !== department) data.department = department;
        if (lab && entry.lab !== lab) data.lab = lab;
        if (Object.keys(data).length) {
          entry = await prisma.employeeDirectory.update({ where: { id: entry.id }, data });
        }
        skippedOrUpdated += 1;
      }
      syncedUsers += await syncEntryToUsers(entry);
    } catch (err) {
      errors.push(`导入失败（${name}）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    parsedRows: rows.length,
    added,
    skippedOrUpdated,
    syncedUsers,
    errors: errors.slice(0, 50),
  };
}
