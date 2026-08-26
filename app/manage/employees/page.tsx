import Link from 'next/link';
import { requirePermission } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { accountMatchKey, distinctDirectoryValues, linkedAccountKeys } from '@/lib/employee-directory';
import { EmployeeManager, type EmployeeRow } from './EmployeeManager';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminEmployeesPage({
  searchParams,
}: {
  searchParams: { q?: string; department?: string; lab?: string; page?: string };
}) {
  await requirePermission('employees');
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);
  const q = (searchParams.q ?? '').trim();
  const department = (searchParams.department ?? '').trim();
  const lab = (searchParams.lab ?? '').trim();

  const where = {
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

  const [entries, total, departments, labs] = await Promise.all([
    prisma.employeeDirectory.findMany({
      where,
      orderBy: { name: 'asc' },
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">员工名单</h2>
          <p className="mt-1 text-xs text-muted">
            全公司员工的统一目录 — 部门/研究所按工号自动同步到用户（导入、编辑与该用户登录时）。工号只比较数字部分：z84412632
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
        <button className="h-9 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600">
          搜索
        </button>
        {(q || department || lab) && (
          <Link
            href="/manage/employees"
            className="h-9 rounded-lg border border-zinc-200 px-3 text-sm leading-9 text-muted hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200"
          >
            清除
          </Link>
        )}
      </form>

      <EmployeeManager rows={rows} />

      {totalPages > 1 && (
        <Pagination current={page} totalPages={totalPages} q={q} department={department} lab={lab} />
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
}: {
  current: number;
  totalPages: number;
  q: string;
  department: string;
  lab: string;
}) {
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (p > 1) params.set('page', String(p));
    if (q) params.set('q', q);
    if (department) params.set('department', department);
    if (lab) params.set('lab', lab);
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
