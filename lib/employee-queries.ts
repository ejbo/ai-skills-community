// 员工名单列表的筛选条件 — SHARED by the admin page (/manage/employees) and the
// bulk-action route (/api/admin/employees/bulk).
//
// This must stay one function: 「选择全部 N 条」 sends the filter, not 3000 ids, so
// the server has to reproduce EXACTLY the set the admin was looking at. Two copies
// of this `where` would eventually drift and bulk-delete rows that were never on
// screen.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface EmployeeFilter {
  q?: string;
  department?: string;
  lab?: string;
  /** 只看重名：同一姓名出现多行（清理历史重复导入用）。 */
  dup?: boolean;
}

/** How many duplicate NAMES the 重名 filter will expand into an `IN (…)` list. */
const DUP_NAME_CAP = 5_000;

/**
 * Names that appear on more than one row. Exact stored spelling only (a raw
 * `groupBy`), so `李明` and `李 明` are not grouped — the filter is a cleanup aid,
 * not the matching contract (that is `canonicalPersonName`).
 */
export async function duplicateEmployeeNames(): Promise<string[]> {
  const groups = await prisma.employeeDirectory.groupBy({
    by: ['name'],
    _count: { name: true },
    having: { name: { _count: { gt: 1 } } },
    orderBy: { name: 'asc' },
    take: DUP_NAME_CAP,
  });
  return groups.map((g) => g.name);
}

export async function employeeWhere(filter: EmployeeFilter): Promise<Prisma.EmployeeDirectoryWhereInput> {
  const q = (filter.q ?? '').trim();
  const department = (filter.department ?? '').trim();
  const lab = (filter.lab ?? '').trim();

  const where: Prisma.EmployeeDirectoryWhereInput = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { accountNumber: { contains: q, mode: 'insensitive' as const } },
            { department: { contains: q, mode: 'insensitive' as const } },
            { lab: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(department ? { department } : {}),
    ...(lab ? { lab } : {}),
  };

  if (filter.dup) {
    // Empty list ⇒ `IN ()` ⇒ matches nothing, which is the correct answer for
    // "show me the duplicates" on a roster that has none.
    where.name = { in: await duplicateEmployeeNames() };
  }
  return where;
}
