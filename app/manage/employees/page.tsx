import Link from 'next/link';
import { requirePermission } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { accountMatchKey, distinctDirectoryValues, linkedAccountKeys } from '@/lib/employee-directory';
import { employeeWhere, type EmployeeFilter } from '@/lib/employee-queries';
import { EmployeeManager, type EmployeeRow } from './EmployeeManager';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminEmployeesPage({
  searchParams,
}: {
  searchParams: { q?: string; department?: string; lab?: string; dup?: string; page?: string };
}) {
  await requirePermission('employees');
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);
  const q = (searchParams.q ?? '').trim();
  const department = (searchParams.department ?? '').trim();
  const lab = (searchParams.lab ?? '').trim();
  const dup = searchParams.dup === '1';

  // 同一个 filter 对象既驱动这一页的查询，也随「选择全部 N 条」发给批量接口 ——
  // 两边必须是同一份条件（lib/employee-queries.ts）。
  const filter: EmployeeFilter = { q, department, lab, dup };
  const where = await employeeWhere(filter);

  const [entries, total, departments, labs] = await Promise.all([
    prisma.employeeDirectory.findMany({
      where,
      // id 兜底：同名行很多（重名清理正是本页的用途），只按 name 排序时 OFFSET 分页
      // 顺序不稳定，翻页会漏行/重复行。
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.employeeDirectory.count({ where }),
    distinctDirectoryValues('department'),
    distinctDirectoryValues('lab'),
  ]);

  // 这一页里哪些工号已经有注册用户 — 与 lib/employee-directory.ts 的同步匹配规则
  // 保持一致（按 accountMatchKey：只比较数字，z84412632 ≡ 84412632）。
  const linked = await linkedAccountKeys(entries.map((e) => e.accountNumber));

  const rows: EmployeeRow[] = entries.map((e) => {
    const key = accountMatchKey(e.accountNumber);
    return {
      id: e.id,
      name: e.name,
      accountNumber: e.accountNumber ?? '',
      department: e.department,
      lab: e.lab,
      avatarUrl: e.avatarUrl,
      isActive: e.isActive,
      updatedAt: e.updatedAt.toISOString(),
      hasUser: key !== null && linked.has(key),
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || department || lab || dup);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">员工名单</h2>
          <p className="mt-1 text-xs text-muted">
            全公司员工的统一目录 — 部门/研究所按工号自动同步到用户（导入、编辑与该用户登录时）。工号只比较数字：z84412632
            与 84412632 视为同一人。
          </p>
        </div>
        <span className="text-xs text-muted">
          共 {total.toLocaleString()} 条 · {departments.length} 个部门 · {labs.length} 个研究所
        </span>
      </div>

      <form className="surface flex flex-wrap items-center gap-2 rounded-xl p-2" action="/manage/employees">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索姓名、工号、部门、研究所…"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <select
          name="department"
          defaultValue={department}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="">全部部门</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          name="lab"
          defaultValue={lab}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="">全部研究所</option>
          {labs.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <label
          className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm dark:border-zinc-800"
          title="只看姓名完全相同的行 —— 用来清理历史重复导入。按库里存的原文比较，「李 明」和「李明」不会被算作重名（导入匹配会）"
        >
          <input
            type="checkbox"
            name="dup"
            value="1"
            defaultChecked={dup}
            className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
          />
          仅看重名
        </label>
        <button className="h-9 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300">
          搜索
        </button>
        {filtered && (
          <Link
            href="/manage/employees"
            className="h-9 rounded-lg border border-zinc-200 px-3 text-sm leading-9 text-muted hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200"
          >
            清除
          </Link>
        )}
      </form>

      {dup && (
        // 重名视图里"要保留的那一条"也在列表中 —— 不提醒的话，全选+批量删除会把这个人
        // 整个删光，而不是只删重复。
        <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          重名视图会把<span className="font-medium">要保留的那一条也一起列出来</span>
          。批量删除前请逐条勾选要清理的行，不要直接「选择全部」。
        </p>
      )}

      {/* key: 换页/换筛选后行集完全不同，勾选必须清空（否则会对看不见的行动手）。 */}
      <EmployeeManager
        key={`${q}|${department}|${lab}|${dup}|${page}`}
        rows={rows}
        total={total}
        filter={filter}
        filtered={filtered}
      />

      {totalPages > 1 && (
        <Pagination current={page} totalPages={totalPages} q={q} department={department} lab={lab} dup={dup} />
      )}
    </div>
  );
}

function Pagination({
  current,
  totalPages,
  q,
  department,
  lab,
  dup,
}: {
  current: number;
  totalPages: number;
  q: string;
  department: string;
  lab: string;
  dup: boolean;
}) {
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (p > 1) params.set('page', String(p));
    if (q) params.set('q', q);
    if (department) params.set('department', department);
    if (lab) params.set('lab', lab);
    if (dup) params.set('dup', '1');
    const s = params.toString();
    return `/manage/employees${s ? `?${s}` : ''}`;
  };
  return (
    <div className="flex items-center justify-end gap-2 text-xs">
      <Link
        href={qs(Math.max(1, current - 1))}
        className="rounded-lg border border-zinc-200 px-3 py-1 transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
      >
        ← 上一页
      </Link>
      <span className="text-muted">
        {current} / {totalPages}
      </span>
      <Link
        href={qs(Math.min(totalPages, current + 1))}
        className="rounded-lg border border-zinc-200 px-3 py-1 transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
      >
        下一页 →
      </Link>
    </div>
  );
}
