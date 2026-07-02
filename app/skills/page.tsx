import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { browseSkills, listCategories } from '@/lib/skill-queries';
import { browsePacks } from '@/lib/pack-queries';
import type { SourceType } from '@prisma/client';
import { SkillCard, SkillCardSkeleton } from '@/components/SkillCard';
import { PackCard } from '@/components/PackCard';
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

  // `source=packs` flips the page into the skill-pack grid: same search bar and
  // tabs, but the skill-only sidebar/sort controls are hidden.
  if (searchParams.source === 'packs') {
    const { items, total, page, pageSize, hasMore } = await browsePacks({
      q: searchParams.q,
      page: Number(searchParams.page ?? 1),
    });

    return (
      <div className="container py-6">
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <SearchBar />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SourceTabs />
            <span className="ml-auto text-xs text-muted">共 {total.toLocaleString()} 个合集包</span>
          </div>
        </div>

        <div className="mt-6">
          {items.length === 0 ? (
            <EmptyState
              title={t('no_packs')}
              description={t('no_packs_hint')}
              actionLabel={t('reset_filters')}
              actionHref="/skills?source=packs"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((pack) => (
                <PackCard
                  key={pack.id}
                  slug={pack.slug}
                  name={pack.name}
                  summary={pack.summary}
                  icon={pack.icon}
                  installCount={pack.installCount}
                  updatedAt={pack.updatedAt}
                  skills={pack.items.map((i) => i.skill)}
                />
              ))}
            </div>
          )}

          {(page > 1 || hasMore) && (
            <Pagination
              searchParams={searchParams}
              current={page}
              pageSize={pageSize}
              total={total}
              hasMore={hasMore}
              prevLabel={t('prev_page')}
              nextLabel={t('next_page')}
            />
          )}
        </div>
      </div>
    );
  }

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
    maxTokens: searchParams.maxTokens ? Number(searchParams.maxTokens) : undefined,
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
            <EmptyState
              title={t('no_results')}
              description={t('no_results_hint')}
              actionLabel={t('reset_filters')}
              actionHref="/skills"
            />
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
                    visibility={skill.visibility}
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
            <Pagination
              searchParams={searchParams}
              current={page}
              pageSize={pageSize}
              total={total}
              hasMore={hasMore}
              prevLabel={t('prev_page')}
              nextLabel={t('next_page')}
            />
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

function pageHref(searchParams: SearchParams, page: number) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === 'page' || v == null || v === '') continue;
    sp.set(k, String(v));
  }
  if (page > 1) sp.set('page', String(page));
  const qs = sp.toString();
  return qs ? `/skills?${qs}` : '/skills';
}

function Pagination({
  searchParams,
  current,
  pageSize,
  total,
  hasMore,
  prevLabel,
  nextLabel,
}: {
  searchParams: SearchParams;
  current: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  prevLabel: string;
  nextLabel: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const btn =
    'inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-accent-500 hover:text-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-accent-400 dark:hover:text-accent-300';
  const disabled = 'inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-muted opacity-40 dark:border-zinc-800';

  return (
    <div className="mt-8 flex items-center justify-center gap-3 text-sm">
      {current > 1 ? (
        <Link href={pageHref(searchParams, current - 1)} rel="prev" aria-label={prevLabel} className={btn}>
          <ChevronLeft className="h-4 w-4" />
          {prevLabel}
        </Link>
      ) : (
        <span aria-disabled className={disabled}>
          <ChevronLeft className="h-4 w-4" />
          {prevLabel}
        </span>
      )}

      <span className="text-muted tabular-nums">
        {current} / {totalPages}
      </span>

      {hasMore ? (
        <Link href={pageHref(searchParams, current + 1)} rel="next" aria-label={nextLabel} className={btn}>
          {nextLabel}
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <span aria-disabled className={disabled}>
          {nextLabel}
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}
