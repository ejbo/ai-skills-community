import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { browseSkills, listCategories } from '@/lib/skill-queries';
import type { SourceType } from '@prisma/client';
import { SkillCard, SkillCardSkeleton } from '@/components/SkillCard';
import { FilterSidebar } from '@/components/FilterSidebar';
import { SearchBar } from '@/components/SearchBar';
import { SortMenu } from '@/components/SortMenu';
import { SourceTabs } from '@/components/SourceTabs';
import { EmptyState } from '@/components/EmptyState';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  category?: string;
  tag?: string;
  source?: string;
  sort?: string;
  page?: string;
  minRating?: string;
  maxTokens?: string;
}

export default async function BrowseSkillsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations('browse');
  const categories = await listCategories();

  const sourceParam = searchParams.source as SourceType | 'all' | undefined;
  const { items, total, page, pageSize, hasMore } = await browseSkills({
    q: searchParams.q,
    category: searchParams.category,
    tag: searchParams.tag,
    source: sourceParam ?? 'all',
    sort: (searchParams.sort as 'trending' | 'downloads' | 'newest' | 'top_rated') ?? 'trending',
    page: Number(searchParams.page ?? 1),
    minRating: Number(searchParams.minRating ?? 0),
  });

  return (
    <div className="container py-6">
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <SearchBar />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SourceTabs />
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted">共 {total.toLocaleString()} 个 Skill</span>
            <SortMenu />
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <div className="hidden lg:block">
          <FilterSidebar categories={categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name }))} />
        </div>

        <div>
          {items.length === 0 ? (
            <EmptyState title={t('no_results')} actionLabel={t('reset_filters')} actionHref="/skills" />
          ) : (
            <Suspense fallback={<GridSkeleton />}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    slug={skill.slug}
                    name={skill.name}
                    summary={skill.summary}
                    sourceType={skill.sourceType}
                    author={skill.author}
                    updatedAt={skill.updatedAt}
                    stats={{
                      downloads: skill.downloadCount,
                      likes: skill.likeCount,
                      rating: skill.avgRating,
                      reviewCount: skill.reviewCount,
                      tokens: skill.tokenCostEstimate,
                    }}
                  />
                ))}
              </div>
            </Suspense>
          )}

          {(page > 1 || hasMore) && (
            <Pagination current={page} pageSize={pageSize} total={total} />
          )}
        </div>
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <SkillCardSkeleton key={i} />
      ))}
    </div>
  );
}

function Pagination({ current, pageSize, total }: { current: number; pageSize: number; total: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-8 flex items-center justify-center gap-2 text-sm">
      <span className="text-muted">
        第 {current} / {totalPages} 页
      </span>
    </div>
  );
}
