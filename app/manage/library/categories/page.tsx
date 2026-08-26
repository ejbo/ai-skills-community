import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/admin';
import { LibraryCategoryManager } from './LibraryCategoryManager';

export const dynamic = 'force-dynamic';

export default async function ManageLibraryCategoriesPage() {
  await requirePermission('library');
  const rows = await prisma.libraryCategory.findMany({
    orderBy: [{ official: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      nameEn: true,
      official: true,
      sortOrder: true,
      createdBy: { select: { handle: true, displayName: true } },
    },
  });

  // Usage is what tells an admin whether a member category deserves promoting.
  const docs = await prisma.libraryDoc.findMany({
    where: { deletedAt: null },
    select: { categories: true },
  });
  const counts: Record<string, number> = {};
  for (const d of docs) for (const c of d.categories) counts[c] = (counts[c] ?? 0) + 1;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">知识库分类</h2>
        <p className="mt-1 text-sm text-muted">
          官方分类排在选择器最前面，也是 AI 自动归类时唯一可选的范围。成员自建的分类对所有人可见，
          可以「设为官方」提升；删除只是撤下这个选项，已经用它归类的文档不受影响。
          <Link href="/manage/library" className="ml-2 text-zinc-900 dark:text-zinc-50 hover:underline">
            返回知识库后台
          </Link>
        </p>
      </div>
      <LibraryCategoryManager
        categories={rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          nameEn: r.nameEn,
          official: r.official,
          sortOrder: r.sortOrder,
          createdBy: r.createdBy?.displayName ?? null,
          docCount: counts[r.slug] ?? 0,
        }))}
      />
    </div>
  );
}
