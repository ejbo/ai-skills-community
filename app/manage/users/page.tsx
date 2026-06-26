import Link from 'next/link';
import { prisma } from '@/lib/db';
import { formatDistanceToNowStrict } from 'date-fns';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string; sort?: string };
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const q = (searchParams.q ?? '').trim();
  const sort = (searchParams.sort ?? 'last_seen') as 'last_seen' | 'created' | 'email';

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { displayName: { contains: q, mode: 'insensitive' as const } },
          { handle: { contains: q, mode: 'insensitive' as const } },
          { huaweiW3Id: { contains: q, mode: 'insensitive' as const } },
          { huaweiW3Name: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const orderBy =
    sort === 'created'
      ? { createdAt: 'desc' as const }
      : sort === 'email'
        ? { email: 'asc' as const }
        : { lastSeenAt: { sort: 'desc' as const, nulls: 'last' as const } };

  const [users, total] = await Promise.all([
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
      },
    }),
    prisma.user.count({ where }),
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
          name="sort"
          defaultValue={sort}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="last_seen">按最近在线</option>
          <option value="created">按注册时间</option>
          <option value="email">按邮箱字母</option>
        </select>
        <button className="h-9 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600">
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
              <th>Email</th>
              <th>身份</th>
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
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500 text-xs font-semibold text-white">
                      {u.displayName.charAt(0)}
                    </span>
                    <span className="font-medium">{u.displayName}</span>
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
                <td className="text-[12px] text-muted">{u.email}</td>
                <td>
                  {u.isAdmin ? (
                    <span className="badge" style={{ background: '#EEF0FF', color: '#3833A8' }}>
                      Admin
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#f4f4f5', color: '#71717a' }}>
                      User
                    </span>
                  )}
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

      <Pagination current={page} totalPages={totalPages} q={q} sort={sort} />
    </div>
  );
}

function Pagination({
  current,
  totalPages,
  q,
  sort,
}: {
  current: number;
  totalPages: number;
  q: string;
  sort: string;
}) {
  const prev = Math.max(1, current - 1);
  const next = Math.min(totalPages, current + 1);
  const url = (p: number) =>
    `/manage/users?page=${p}${q ? `&q=${encodeURIComponent(q)}` : ''}${sort ? `&sort=${sort}` : ''}`;
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
