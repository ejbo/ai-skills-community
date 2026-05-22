import Link from 'next/link';
import { format } from 'date-fns';
import { prisma } from '@/lib/db';
import { SkillStatusActions } from './SkillStatusActions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

export default async function AdminSkillsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; source?: string; page?: string };
}) {
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const q = (searchParams.q ?? '').trim();
  const statusFilter = searchParams.status as 'draft' | 'published' | 'archived' | undefined;
  const sourceFilter = searchParams.source as
    | 'internal'
    | 'user_uploaded'
    | 'external_curated'
    | undefined;

  const where: import('@prisma/client').Prisma.SkillWhereInput = { deletedAt: null };
  if (statusFilter) where.status = statusFilter;
  if (sourceFilter) where.sourceType = sourceFilter;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
      { summary: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [skills, total] = await Promise.all([
    prisma.skill.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        author: { select: { handle: true, displayName: true } },
        currentVersion: { select: { version: true } },
      },
    }),
    prisma.skill.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Skill 审核</h2>
        <span className="text-xs text-muted">{total.toLocaleString()} 条记录</span>
      </div>

      <form className="surface flex flex-wrap items-center gap-2 rounded-xl p-2" action="/manage/skills">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索名称 / slug / 描述"
          className="h-9 min-w-[200px] flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? ''}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="">所有状态</option>
          <option value="published">已发布</option>
          <option value="draft">草稿</option>
          <option value="archived">已归档</option>
        </select>
        <select
          name="source"
          defaultValue={sourceFilter ?? ''}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <option value="">所有来源</option>
          <option value="internal">内部专用</option>
          <option value="user_uploaded">社区上传</option>
          <option value="external_curated">官方搬运</option>
        </select>
        <button className="h-9 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600">
          筛选
        </button>
      </form>

      <div className="surface overflow-hidden rounded-xl">
        <table className="data">
          <thead>
            <tr>
              <th>Skill</th>
              <th>作者</th>
              <th>来源</th>
              <th>状态</th>
              <th>版本</th>
              <th>统计</th>
              <th>更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {skills.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-xs text-muted">
                  暂无匹配的 Skill
                </td>
              </tr>
            )}
            {skills.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/skills/${s.slug}`} className="font-medium hover:text-accent-600">
                    {s.name}
                  </Link>
                  <div className="font-mono text-[10px] text-muted">{s.slug}</div>
                </td>
                <td>
                  <Link href={`/users/${s.author.handle}`} className="hover:text-accent-600">
                    {s.author.displayName}
                  </Link>
                </td>
                <td className="text-[11px]">
                  {s.sourceType === 'internal' ? '内部' : s.sourceType === 'user_uploaded' ? '社区' : '搬运'}
                </td>
                <td>
                  <span
                    className="badge"
                    style={{
                      background:
                        s.status === 'published' ? '#dcfce7' : s.status === 'draft' ? '#fef3c7' : '#fee2e2',
                      color:
                        s.status === 'published' ? '#166534' : s.status === 'draft' ? '#92400e' : '#991b1b',
                    }}
                  >
                    {s.status === 'published' ? '已发布' : s.status === 'draft' ? '草稿' : '归档'}
                  </span>
                </td>
                <td className="font-mono text-[11px] tabular-nums">
                  {s.currentVersion?.version ?? '—'}
                </td>
                <td className="font-mono text-[11px] tabular-nums text-muted">
                  ⬇{s.downloadCount} ❤{s.likeCount}
                </td>
                <td className="font-mono text-[11px] tabular-nums text-muted">
                  {format(s.updatedAt, 'MM-dd HH:mm')}
                </td>
                <td>
                  <SkillStatusActions slug={s.slug} status={s.status} sourceType={s.sourceType} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs text-muted">
        第 {page} / {totalPages} 页
      </div>
    </div>
  );
}
