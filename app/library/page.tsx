import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon } from 'lucide-react';
import { auth } from '@/lib/auth';
import { browseDocs, getCategoryCounts, getFeaturedDocs } from '@/lib/library-queries';
import { LIBRARY_CATEGORIES } from '@/lib/library/types';
import { SearchBar } from '@/components/SearchBar';
import { EmptyState } from '@/components/EmptyState';
import { DocCard } from '@/components/library/DocCard';
import { DocListRow } from '@/components/library/DocListRow';
import { ListScrollRestore } from '@/components/library/ScrollMemory';
import { TypeTabs } from '@/components/library/TypeTabs';
import { LibrarySort } from '@/components/library/LibrarySort';
import { AddDocButton } from '@/components/library/AddDocButton';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  type?: string;
  cat?: string;
  sort?: string;
  page?: string;
  layout?: string;
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const [t, tNav, tHome] = await Promise.all([
    getTranslations('library'),
    getTranslations('nav'),
    getTranslations('home'),
  ]);
  const session = await auth();
  const isDefaultView =
    !searchParams.q && !searchParams.type && !searchParams.cat && !searchParams.sort && !searchParams.page;

  const [{ items, total, page, pageSize, hasMore }, featured, catCounts] = await Promise.all([
    browseDocs({
      q: searchParams.q,
      type: searchParams.type,
      cat: searchParams.cat,
      sort: searchParams.sort,
      page: Number(searchParams.page ?? 1),
    }),
    isDefaultView ? getFeaturedDocs() : Promise.resolve([]),
    getCategoryCounts(),
  ]);
  const showFeatured = isDefaultView && featured.length > 0;
  const activeCat = typeof searchParams.cat === 'string' ? searchParams.cat : undefined;
  const layout = searchParams.layout === 'list' ? 'list' : 'grid';

  return (
    <div className="container py-6">
      <ListScrollRestore />
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{tNav('library')}</h1>
            <p className="mt-1 text-sm text-muted">{t('page_subtitle')}</p>
          </div>
          <AddDocButton loggedIn={Boolean(session?.user)} />
        </div>
        <SearchBar />
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800">
          <TypeTabs />
          <div className="flex items-center gap-3 pb-2">
            <span className="text-xs text-muted">{t('total_docs', { count: total })}</span>
            <LayoutToggle searchParams={searchParams} layout={layout} />
            <LibrarySort />
          </div>
        </div>
      </div>

      {showFeatured && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold tracking-tight">{t('featured_title')}</h2>
          <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
            {featured.map((doc) => (
              <div key={doc.id} className="w-[320px] shrink-0">
                <DocCard {...doc} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
        <CategorySidebar searchParams={searchParams} active={activeCat} counts={catCounts} />

        <div className="min-w-0">
          {showFeatured && <h2 className="mb-3 text-lg font-semibold tracking-tight">{t('all_docs')}</h2>}
          {items.length === 0 ? (
            <EmptyState
              title={t('empty_title')}
              description={t('empty_desc')}
              actionLabel={
                searchParams.q || searchParams.type || searchParams.cat ? tHome('view_all') : undefined
              }
              actionHref={
                searchParams.q || searchParams.type || searchParams.cat ? '/library' : undefined
              }
            />
          ) : layout === 'list' ? (
            <div className="surface divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800/60">
              {items.map((doc) => (
                <DocListRow key={doc.id} {...doc} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
              {items.map((doc) => (
                <DocCard key={doc.id} {...doc} />
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
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** 细分类 sidebar — fixed AI-topic taxonomy, link-based filters keeping q/type/sort. */
async function CategorySidebar({
  searchParams,
  active,
  counts,
}: {
  searchParams: SearchParams;
  active: string | undefined;
  counts: Record<string, number>;
}) {
  const t = await getTranslations('library');
  const tl = await getTranslations('labels');
  const catHref = (slug: string | null) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === 'page' || k === 'cat' || v == null || v === '') continue;
      sp.set(k, String(v));
    }
    if (slug) sp.set('cat', slug);
    const qs = sp.toString();
    return qs ? `/library?${qs}` : '/library';
  };
  const rowCls = (on: boolean) =>
    `flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
      on
        ? 'bg-accent-500/10 font-medium text-accent-600 dark:text-accent-300'
        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60'
    }`;

  return (
    <aside className="hidden lg:block">
      <p className="mb-2 flex items-center gap-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        <LayoutGrid className="h-3.5 w-3.5" />
        {t('category_sidebar_title')}
      </p>
      <nav className="flex flex-col gap-0.5">
        <Link href={catHref(null)} className={rowCls(!active)}>
          <span>{t('all_categories')}</span>
        </Link>
        {LIBRARY_CATEGORIES.map((c) => (
          <Link key={c.slug} href={catHref(c.slug)} className={rowCls(active === c.slug)}>
            <span>{tl(`libCategory.${c.slug}`)}</span>
            {counts[c.slug] ? (
              <span className="font-mono text-[11px] tabular-nums text-muted">{counts[c.slug]}</span>
            ) : null}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/** 卡片/列表 view toggle — link-based so the choice lives in the URL. */
async function LayoutToggle({ searchParams, layout }: { searchParams: SearchParams; layout: 'grid' | 'list' }) {
  const t = await getTranslations('library');
  const href = (l: 'grid' | 'list') => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === 'layout' || k === 'page' || v == null || v === '') continue;
      sp.set(k, String(v));
    }
    if (l === 'list') sp.set('layout', 'list');
    const qs = sp.toString();
    return qs ? `/library?${qs}` : '/library';
  };
  const cls = (on: boolean) =>
    `grid h-7 w-7 place-items-center rounded-md transition ${
      on
        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
        : 'text-muted hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70'
    }`;
  return (
    <div className="surface flex items-center gap-0.5 rounded-lg p-0.5" role="tablist" aria-label={t('view_toggle')}>
      <Link href={href('grid')} role="tab" aria-selected={layout === 'grid'} aria-label={t('grid_view')} className={cls(layout === 'grid')}>
        <LayoutGrid className="h-3.5 w-3.5" />
      </Link>
      <Link href={href('list')} role="tab" aria-selected={layout === 'list'} aria-label={t('list_view')} className={cls(layout === 'list')}>
        <ListIcon className="h-3.5 w-3.5" />
      </Link>
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
  return qs ? `/library?${qs}` : '/library';
}

async function Pagination({
  searchParams,
  current,
  pageSize,
  total,
  hasMore,
}: {
  searchParams: SearchParams;
  current: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}) {
  const tBrowse = await getTranslations('browse');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const btn =
    'inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-accent-500 hover:text-accent-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-accent-400 dark:hover:text-accent-300';
  const disabled =
    'inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-muted opacity-40 dark:border-zinc-800';

  return (
    <div className="mt-8 flex items-center justify-center gap-3 text-sm">
      {current > 1 ? (
        <Link href={pageHref(searchParams, current - 1)} rel="prev" className={btn}>
          <ChevronLeft className="h-4 w-4" />
          {tBrowse('prev_page')}
        </Link>
      ) : (
        <span aria-disabled className={disabled}>
          <ChevronLeft className="h-4 w-4" />
          {tBrowse('prev_page')}
        </span>
      )}

      <span className="text-muted tabular-nums">
        {current} / {totalPages}
      </span>

      {hasMore ? (
        <Link href={pageHref(searchParams, current + 1)} rel="next" className={btn}>
          {tBrowse('next_page')}
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <span aria-disabled className={disabled}>
          {tBrowse('next_page')}
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}
