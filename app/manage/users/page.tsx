import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { accountMatchKey } from '@/lib/employee-directory';
import { formatDistanceToNowStrict } from 'date-fns';
import { requirePermission } from '@/lib/admin';
import { listRoles } from '@/lib/roles';
import { MEMBER_ROLE_KEY } from '@/lib/permissions';
import { RoleBadge } from './RoleBadge';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string; sort?: string; role?: string };
}) {
  await requirePermission('users');

  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);
  const q = (searchParams.q ?? '').trim();
  const sort = (searchParams.sort ?? 'last_seen') as 'last_seen' | 'created' | 'email';
  const roleKey = (searchParams.role ?? '').trim();

  const clauses: Prisma.UserWhereInput[] = [];
  if (q) {
    clauses.push({
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
        { handle: { contains: q, mode: 'insensitive' } },
        { huaweiW3Id: { contains: q, mode: 'insensitive' } },
        // 工号按数字匹配：搜索名单里的写法 z84412632 也能找到 uid 为 84412632 的用户。
        { huaweiW3Id: { contains: accountMatchKey(q) ?? q } },
        { huaweiW3Name: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (roleKey) {
    // null roleId means 普通成员 (rows created before the role table existed).
    clauses.push(
      roleKey === MEMBER_ROLE_KEY
        ? { OR: [{ role: { key: MEMBER_ROLE_KEY } }, { roleId: null }] }
        : { role: { key: roleKey } },
    );
  }
  const where: Prisma.UserWhereInput = clauses.length ? { AND: clauses } : {};

  const orderBy =
    sort === 'created'
      ? { createdAt: 'desc' as const }
      : sort === 'email'
        ? { email: 'asc' as const }
        : { lastSeenAt: { sort: 'desc' as const, nulls: 'last' as const } };

  const [users, total, roles] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
        isAdmin: true,
        isActive: true,
        authMethod: true,
        lastSeenAt: true,
        createdAt: true,
        huaweiW3Id: true,
        huaweiW3Name: true,
        department: true,
        lab: true,
        isPrivate: true,
        role: { select: { key: true, name: true } },
      },
    }),
    prisma.user.count({ where }),
    listRoles(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">用户管理</h2>
        <span className="text-xs text-muted">{total.toLocaleString()} 个账号</span>
      </div>

      <form className="surface flex items-center gap-2 rounded-xl p-2" action="/manage/users">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索 email / 用户名 / W3 工号 / W3 姓名…"
          className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <select
          name="role"
          defaultValue={roleKey}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="">全部角色</option>
          {roles.map((r) => (
            <option key={r.id} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={sort}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="last_seen">按最近在线</option>
          <option value="created">按注册时间</option>
          <option value="email">按邮箱字母</option>
        </select>
        <button className="h-9 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300">
          搜索
        </button>
      </form>

      <div className="surface overflow-x-auto rounded-xl">
        <table className="data">
          <thead>
            <tr>
              <th>用户</th>
              <th>W3 姓名</th>
              <th>工号</th>
              <th>部门 / 研究所</th>
              <th>Email</th>
              <th>角色</th>
              <th>登录方式</th>
              <th>最近在线</th>
              <th>注册时间</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/manage/users/${u.id}`} className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-xs font-semibold text-white dark:text-zinc-900">
                      {u.displayName.charAt(0)}
                    </span>
                    <span className="font-medium">{u.displayName}</span>
                    {u.isPrivate && (
                      <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                        隐私
                      </span>
                    )}
                  </Link>
                </td>
                <td className="text-[13px]">
                  {u.huaweiW3Name ? (
                    <span className="font-medium">{u.huaweiW3Name}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="font-mono text-[12px]">
                  {u.huaweiW3Id ? u.huaweiW3Id : <span className="font-sans text-muted">—</span>}
                </td>
                <td className="text-[12px]">
                  {u.department || u.lab ? (
                    <span>
                      {u.department}
                      {u.department && u.lab ? ' · ' : ''}
                      {u.lab}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="text-[12px] text-muted">{u.email}</td>
                <td>
                  <RoleBadge roleKey={u.role?.key ?? MEMBER_ROLE_KEY} name={u.role?.name ?? '普通成员'} staff={u.isAdmin} />
                </td>
                <td className="text-[12px]">
                  {u.authMethod === 'both' ? '密码 + W3' : u.authMethod === 'huawei_sso' ? 'W3' : '密码'}
                </td>
                <td className="font-mono text-[11px] tabular-nums">
                  {u.lastSeenAt ? formatDistanceToNowStrict(u.lastSeenAt, { addSuffix: true }) : '—'}
                </td>
                <td className="font-mono text-[11px] tabular-nums">
                  {formatDistanceToNowStrict(u.createdAt, { addSuffix: true })}
                </td>
                <td>
                  {u.isActive ? (
                    <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>
                      Active
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>
                      Disabled
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination current={page} totalPages={totalPages} q={q} sort={sort} role={roleKey} />
    </div>
  );
}

function Pagination({
  current,
  totalPages,
  q,
  sort,
  role,
}: {
  current: number;
  totalPages: number;
  q: string;
  sort: string;
  role: string;
}) {
  const prev = Math.max(1, current - 1);
  const next = Math.min(totalPages, current + 1);
  const url = (p: number) =>
    `/manage/users?page=${p}${q ? `&q=${encodeURIComponent(q)}` : ''}${sort ? `&sort=${sort}` : ''}${
      role ? `&role=${encodeURIComponent(role)}` : ''
    }`;
  return (
    <div className="flex items-center justify-end gap-2 text-xs">
      <Link
        href={url(prev)}
        className="rounded-lg border border-zinc-200 px-3 py-1 transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
      >
        ← 上一页
      </Link>
      <span className="text-muted">
        {current} / {totalPages}
      </span>
      <Link
        href={url(next)}
        className="rounded-lg border border-zinc-200 px-3 py-1 transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
      >
        下一页 →
      </Link>
    </div>
  );
}
