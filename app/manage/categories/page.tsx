import { prisma } from '@/lib/db';
import { CategoryEditor } from './CategoryEditor';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { skills: { where: { deletedAt: null } } } },
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">类别管理</h2>
      <CategoryEditor
        categories={categories.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description ?? '',
          sortOrder: c.sortOrder,
          skillCount: c._count.skills,
        }))}
      />
    </div>
  );
}
