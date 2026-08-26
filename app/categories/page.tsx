import Link from 'next/link';
import { FolderOpen } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const t = await getTranslations('skills_misc');
  const tn = await getTranslations('nav');
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
        <h1 className="text-3xl font-semibold tracking-tight">{tn('categories')}</h1>
        <p className="mt-1 text-sm text-muted">{t('categories_subtitle')}</p>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/skills?category=${c.slug}`}
            className="card-hover surface group rounded-2xl p-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50">
                <FolderOpen className="h-4 w-4" />
              </div>
              <span className="font-mono text-xs tabular-nums text-muted">
                {c._count.skills}
              </span>
            </div>
            <h3 className="mt-3 text-base font-semibold group-hover:text-zinc-900">{c.name}</h3>
            {c.description && <p className="mt-1 text-xs text-muted">{c.description}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
