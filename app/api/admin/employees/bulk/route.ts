// 员工名单批量操作：删除 / 停用 / 启用。
//
// 两种选择方式，二选一：
//   { ids: [...] }              勾选的行（页面上看得见的那些）
//   { all: true, filter: {…} }  「选择全部 N 条」—— 服务端用 employeeWhere() 重放
//                               管理员当时的筛选条件。这里必须复用同一个 where 构造
//                               函数，否则会删到屏幕上从没出现过的行。
//
// 删除语义与单行 DELETE 一致：不回收已经同步到用户上的部门/研究所。
// 启用后会按工号把部门/研究所补写回用户（停用期间的改动会在这时生效）；停用不动用户。

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { buildUserAccountIndex, syncEntryToUsers } from '@/lib/employee-directory';
import { employeeWhere } from '@/lib/employee-queries';

export const dynamic = 'force-dynamic';

const MAX_IDS = 20_000;

const bulkSchema = z
  .object({
    action: z.enum(['delete', 'activate', 'deactivate']),
    ids: z.array(z.string().min(1).max(64)).max(MAX_IDS).optional(),
    /** true = 对当前筛选结果全体生效（忽略 ids）。 */
    all: z.boolean().optional(),
    filter: z
      .object({
        q: z.string().max(200).optional(),
        department: z.string().max(200).optional(),
        lab: z.string().max(200).optional(),
        dup: z.boolean().optional(),
      })
      .optional(),
  })
  // 二选一，而且必须是显式的：在一个能整表删除的接口上，"同时给了 ids 和 all 就
  // 悄悄按 all 处理"是最容易演变成事故的默认值。
  .refine((v) => (v.all === true) !== ((v.ids?.length ?? 0) > 0), {
    message: 'provide exactly one of ids / all',
  });

export async function POST(req: Request) {
  const gate = await gateApi('employees');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const parsed = bulkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { action, all, filter } = parsed.data;
  const ids = Array.from(new Set(parsed.data.ids ?? []));

  const where = all ? await employeeWhere(filter ?? {}) : { id: { in: ids } };

  let affected = 0;
  let syncedUsers = 0;

  if (action === 'delete') {
    affected = (await prisma.employeeDirectory.deleteMany({ where })).count;
  } else {
    const isActive = action === 'activate';
    affected = (await prisma.employeeDirectory.updateMany({ where, data: { isActive } })).count;
    if (isActive && affected) {
      // 停用行不参与同步，所以重新启用后要补一次；只有带工号的行有意义。
      const entries = await prisma.employeeDirectory.findMany({
        where: { ...where, isActive: true, accountNumber: { not: null } },
        select: { accountNumber: true, department: true, lab: true, isActive: true },
        // 与 syncAllEntriesToUsers 同序：历史重复行共用一个工号时，最近更新的那条最后写、
        // 即最终生效。不定序会让同一次操作的结果随 DB 返回顺序漂移。
        orderBy: [{ updatedAt: 'asc' }, { id: 'desc' }],
      });
      const userIndex = await buildUserAccountIndex();
      for (const entry of entries) {
        syncedUsers += await syncEntryToUsers(entry, userIndex);
      }
    }
  }

  await logAdmin({
    adminUserId: session.user.id,
    action: `bulk_${action}_employees`,
    targetType: 'employee',
    details: {
      affected,
      syncedUsers,
      // scope 记录"按勾选"还是"按筛选全选"，后者把筛选条件一并留档 ——
      // 一次误操作的全表删除，事后只能靠这行还原当时的范围。
      scope: all ? 'filter' : 'ids',
      filter: all ? (filter ?? {}) : undefined,
      idCount: all ? undefined : ids.length,
      ids: all ? undefined : ids.slice(0, 200),
    },
  });

  return NextResponse.json({ ok: true, affected, syncedUsers });
}
