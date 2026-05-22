import Link from 'next/link';
import { FolderOpen } from 'lucide-react';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: {
        select: {
          skills: { where: { deletedAt: null, status: 'published' } },
        },
      },
    },
  });

  return (
    <div className="container py-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">类别</h1>
        <p className="mt-1 text-sm text-muted">按场景挑选合适的 Skill。</p>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/skills?category=${c.slug}`}
            className="card-hover surface group rounded-2xl p-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
                <FolderOpen className="h-4 w-4" />
              </div>
              <span className="font-mono text-xs tabular-nums text-muted">
                {c._count.skills}
              </span>
            </div>
            <h3 className="mt-3 text-base font-semibold group-hover:text-accent-600">{c.name}</h3>
            {c.description && <p className="mt-1 text-xs text-muted">{c.description}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
