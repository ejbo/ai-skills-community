import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/admin';
import { UserTagsManager } from './UserTagsManager';

export const dynamic = 'force-dynamic';

export default async function ManageUserTagsPage() {
  await requirePermission('users');
  const tags = await prisma.userTag.findMany({
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      color: true,
      kind: true,
      sortOrder: true,
      _count: { select: { assignments: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">用户标签</h2>
        <p className="mt-1 text-sm text-muted">
          标签显示在用户卡片上。手动标签可单独或批量指派；系统标签（如版主）按规则自动授予与回收，
          不能手工指派或删除。成员可以在「设置 → 我的标签」里选择展示哪些。
        </p>
      </div>
      <UserTagsManager
        tags={tags.map((t) => ({
          id: t.id,
          key: t.key,
          name: t.name,
          description: t.description ?? '',
          color: t.color,
          kind: t.kind,
          sortOrder: t.sortOrder,
          assignedCount: t._count.assignments,
        }))}
      />
    </div>
  );
}
