import { prisma } from '@/lib/db';
import { format } from 'date-fns';
import { LogDetailsModal } from './LogDetailsModal';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

export default async function LogsPage({
  searchParams,
}: {
  searchParams: { q?: string; action?: string; page?: string };
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const q = (searchParams.q ?? '').trim();
  const action = (searchParams.action ?? '').trim();

  const where: import('@prisma/client').Prisma.AdminLogWhereInput = {};
  if (action) where.action = action;
  if (q) {
    where.OR = [
      { targetId: { contains: q } },
      { adminUser: { displayName: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const [logs, total, actions] = await Promise.all([
    prisma.adminLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { adminUser: { select: { displayName: true, handle: true } } },
    }),
    prisma.adminLog.count({ where }),
    prisma.adminLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">操作日志</h2>

      <form className="surface flex items-center gap-2 rounded-xl p-2" action="/manage/logs">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索目标 ID 或管理员…"
          className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <select
          name="action"
          defaultValue={action}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="">所有动作</option>
          {actions.map((a) => (
            <option key={a.action} value={a.action}>
              {a.action}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600">
          筛选
        </button>
      </form>

      <div className="surface overflow-hidden rounded-xl">
        <table className="data">
          <thead>
            <tr>
              <th>时间</th>
              <th>管理员</th>
              <th>动作</th>
              <th>目标</th>
              <th>详情</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-xs text-muted">
                  暂无记录
                </td>
              </tr>
            )}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="font-mono text-[11px] tabular-nums">{format(l.createdAt, 'MM-dd HH:mm:ss')}</td>
                <td>{l.adminUser.displayName}</td>
                <td>
                  <span className="badge" style={{ background: '#EEF0FF', color: '#3833A8' }}>
                    {l.action}
                  </span>
                </td>
                <td className="font-mono text-[11px] text-muted">
                  {l.targetType && <span>{l.targetType}:</span>}
                  {l.targetId}
                </td>
                <td>
                  <LogDetailsModal details={l.details} action={l.action} />
                </td>
                <td className="font-mono text-[11px] text-muted">{l.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs">
        <span className="text-muted">
          第 {page} / {totalPages} 页 · 共 {total} 条
        </span>
      </div>
    </div>
  );
}
