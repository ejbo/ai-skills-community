import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon } from 'lucide-react';
import { auth } from '@/lib/auth';
import {
  browseDocs,
  getBrowseCounts,
  getContinueReading,
  getFeaturedDocs,
  type DocCardData,
} from '@/lib/library-queries';
import { listLibraryCategories, type LibraryCategoryOption } from '@/lib/library/categories';
import { CATEGORY_NAME_BY_SLUG, LIBRARY_SECTIONS, isLibrarySection } from '@/lib/library/types';
import { pickDocTitle } from '@/lib/library/translation-shared';
import { SearchBar } from '@/components/SearchBar';
import { EmptyState } from '@/components/EmptyState';
import { DocCard } from '@/components/library/DocCard';
import { DocCover } from '@/components/library/DocCover';
import { DocListRow } from '@/components/library/DocListRow';
import { ListScrollRestore } from '@/components/library/ScrollMemory';
import { LibrarySort } from '@/components/library/LibrarySort';
import { SourceLine } from '@/components/library/SourceLine';
import { TypeFilter } from '@/components/library/TypeFilter';
import { AddDocButton } from '@/components/library/AddDocButton';

export const dynamic = 'force-dynamic';

// Browse page shape (owner, 2026-10-08 + the reading-site brief): ONE dominant
// list that facets narrow — a 版块 rail on top (7 fixed sections → their topics
// as a second row), 类型 / 排序 / 视图 as a quiet toolbar, and discovery (精选 ·
// 最多收藏 · 继续阅读) as a compact right rail rather than blocks that push the
// list down. Format is a facet, never a section; the 16-item sidebar is gone.

interface SearchParams {
  q?: string;
  section?: string;
  cat?: string;
  type?: string;
  sort?: string;
  page?: string;
  layout?: string;
}

const RAIL_FEATURED = 5;
const RAIL_POPULAR = 5;
const RAIL_CONTINUE = 3;

/** `/library?…` with `patch` applied; `page` always drops (a filter change restarts paging). */
function hrefWith(sp: SearchParams, patch: Record<string, string | null>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page' || v == null || v === '') continue;
    next.set(k, String(v));
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `/library?${qs}` : '/library';
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const [t, tNav, tHome, tl, locale, session, categories] = await Promise.all([
    getTranslations('library'),
    getTranslations('nav'),
    getTranslations('home'),
    getTranslations('labels'),
    getLocale(),
    auth(),
    listLibraryCategories(),
  ]);

  const sectionOf = (c: LibraryCategoryOption) => c.section ?? 'other';
  const section =
    isLibrarySection(searchParams.section) || searchParams.section === 'other' ? searchParams.section : undefined;
  const activeTopic = categories.find((c) => c.slug === searchParams.cat);
  // A chosen topic lights its own 版块 in the rail.
  const railSection = section ?? (activeTopic ? sectionOf(activeTopic) : undefined);
  const topicsInRail = railSection ? categories.filter((c) => sectionOf(c) === railSection) : [];
  const layout = searchParams.layout === 'grid' ? 'grid' : 'list';

  const [{ items, total, page, pageSize, hasMore }, featured, popular, continueReading, counts] =
    await Promise.all([
      browseDocs({
        q: searchParams.q,
        type: searchParams.type,
        cat: activeTopic?.slug,
        cats: !activeTopic && section ? topicsInRail.map((c) => c.slug) : undefined,
        sort: searchParams.sort,
        page: Number(searchParams.page ?? 1),
      }),
      getFeaturedDocs(RAIL_FEATURED),
      browseDocs({ sort: 'shelved', pageSize: RAIL_POPULAR }).then((r) => r.items.filter((d) => d.shelfCount > 0)),
      session?.user ? getContinueReading(session.user.id, RAIL_CONTINUE) : Promise.resolve([]),
      getBrowseCounts(),
    ]);

  const categoryNames = Object.fromEntries(
    categories.map((c) => [c.slug, locale.startsWith('zh') ? c.name : c.nameEn || c.name]),
  );
  const topicLabel = (c: LibraryCategoryOption) =>
    c.official && c.slug in CATEGORY_NAME_BY_SLUG ? tl(`libCategory.${c.slug}`) : categoryNames[c.slug];
  const hasOther = categories.some((c) => sectionOf(c) === 'other' && (counts.byTopic[c.slug] ?? 0) > 0);
  const filtered = Boolean(searchParams.q || searchParams.type || section || activeTopic);

  const sectionChip = (on: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
      on
        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
        : 'border border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50'
    }`;
  const topicChip = (on: boolean) =>
    `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
      on
        ? 'bg-zinc-900/[0.08] font-medium text-zinc-900 dark:bg-white/[0.14] dark:text-zinc-50'
        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
    }`;

  return (
    <div className="container py-6">
      <ListScrollRestore />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{tNav('library')}</h1>
          <p className="mt-1 text-sm text-muted">{t('page_subtitle')}</p>
        </div>
        <AddDocButton loggedIn={Boolean(session?.user)} />
      </div>

      {/* 版块 rail — the top level. Horizontal scroll on phones, one row on desktop. */}
      <nav aria-label={t('category_sidebar_title')} className="scroll-thin mt-5 flex gap-1.5 overflow-x-auto pb-1">
        <Link href={hrefWith(searchParams, { section: null, cat: null })} className={sectionChip(!railSection)}>
          {t('section_all')}
        </Link>
        {LIBRARY_SECTIONS.map((sec) => (
          <Link key={sec} href={hrefWith(searchParams, { section: sec, cat: null })} className={sectionChip(railSection === sec)}>
            {tl(`libSection.${sec}`)}
            {counts.bySection[sec] ? (
              <span className={`ml-1 font-mono text-[11px] tabular-nums ${railSection === sec ? 'opacity-70' : 'text-muted'}`}>
                {counts.bySection[sec]}
              </span>
            ) : null}
          </Link>
        ))}
        {hasOther && (
          <Link href={hrefWith(searchParams, { section: 'other', cat: null })} className={sectionChip(railSection === 'other')}>
            {tl('libSection.other')}
          </Link>
        )}
      </nav>

      {/* Topics of the chosen 版块 — the second level, with counts. */}
      {railSection && topicsInRail.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 pl-1 text-xs">
          <span className="mr-1 text-muted">{t('topics_in_section')}</span>
          <Link href={hrefWith(searchParams, { section: railSection, cat: null })} className={topicChip(!activeTopic)}>
            {t('section_all')}
          </Link>
          {topicsInRail.map((c) => (
            <Link key={c.slug} href={hrefWith(searchParams, { section: railSection, cat: c.slug })} className={topicChip(activeTopic?.slug === c.slug)}>
              {topicLabel(c)}
              {counts.byTopic[c.slug] ? (
                <span className="font-mono text-[10px] tabular-nums text-muted">{counts.byTopic[c.slug]}</span>
              ) : null}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="w-full sm:max-w-xs">
          <SearchBar />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{t('total_docs', { count: total })}</span>
          <TypeFilter />
          <LibrarySort />
          <LayoutToggle searchParams={searchParams} layout={layout} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="min-w-0">
          {items.length === 0 ? (
            <EmptyState
              title={t('empty_title')}
              description={t('empty_desc')}
              actionLabel={filtered ? tHome('view_all') : undefined}
              actionHref={filtered ? '/library' : undefined}
            />
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {items.map((doc) => (
                <DocCard key={doc.id} {...doc} />
              ))}
            </div>
          ) : (
            <div className="surface divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800/60">
              {items.map((doc) => (
                <DocListRow key={doc.id} {...doc} categoryNames={categoryNames} />
              ))}
            </div>
          )}

          {(page > 1 || hasMore) && (
            <Pagination searchParams={searchParams} current={page} pageSize={pageSize} total={total} hasMore={hasMore} />
          )}
        </div>

        <aside className="space-y-7">
          {featured.length > 0 && (
            <Rail title={t('rail_featured')} moreHref="/library?sort=featured" moreLabel={t('rail_featured_all')}>
              {featured.map((doc) => (
                <RailItem key={doc.id} doc={doc} locale={locale} />
              ))}
            </Rail>
          )}
          {popular.length > 0 && (
            <Rail title={t('rail_popular')}>
              {popular.map((doc, i) => (
                <RailItem key={doc.id} doc={doc} locale={locale} rank={i + 1} />
              ))}
            </Rail>
          )}
          {continueReading.length > 0 && (
            <Rail title={t('rail_continue')} moreHref="/library/shelf" moreLabel={t('rail_shelf_link')}>
              {continueReading.map(({ doc, percent }) => (
                <RailItem key={doc.id} doc={doc} locale={locale} percent={percent} />
              ))}
            </Rail>
          )}
        </aside>
      </div>
    </div>
  );
}

/** One right-rail block: a small heading, a list, an optional 「查看全部」. */
function Rail({
  title,
  moreHref,
  moreLabel,
  children,
}: {
  title: string;
  moreHref?: string;
  moreLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {moreHref && moreLabel && (
          <Link href={moreHref} className="text-[11px] text-muted transition hover:text-zinc-900 dark:hover:text-zinc-50">
            {moreLabel}
          </Link>
        )}
      </div>
      <ul className="mt-2.5 space-y-1">{children}</ul>
    </section>
  );
}

async function RailItem({
  doc,
  locale,
  rank,
  percent,
}: {
  doc: DocCardData;
  locale: string;
  rank?: number;
  percent?: number;
}) {
  const [t, tp] = await Promise.all([getTranslations('library'), getTranslations('profile')]);
  const title = pickDocTitle(locale, doc);
  return (
    <li>
      <Link
        href={`/library/${doc.slug}`}
        className="-mx-2 flex gap-3 rounded-lg px-2 py-1.5 transition hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60"
      >
        {rank !== undefined ? (
          <span className="w-5 shrink-0 pt-0.5 font-mono text-sm tabular-nums text-muted">{rank}</span>
        ) : (
          <span className="h-12 w-9 shrink-0 overflow-hidden rounded">
            <DocCover title={title} coverUrl={doc.coverUrl} docType={doc.docType} className="h-full w-full text-sm" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[13px] font-medium leading-snug">{title}</span>
          {percent !== undefined ? (
            <span className="mt-1.5 flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <span className="block h-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${Math.round(percent)}%` }} />
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">{Math.round(percent)}%</span>
            </span>
          ) : (
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <SourceLine sourceUrl={doc.sourceUrl} siteName={doc.siteName} author={doc.author} format={doc.format} className="min-w-0" />
              {rank !== undefined && (
                <>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 font-mono tabular-nums">{tp('n_shelved', { count: doc.shelfCount })}</span>
                </>
              )}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** 列表/卡片 view toggle — link-based so the choice lives in the URL. List is the default. */
async function LayoutToggle({ searchParams, layout }: { searchParams: SearchParams; layout: 'grid' | 'list' }) {
  const t = await getTranslations('library');
  const cls = (on: boolean) =>
    `grid h-7 w-7 place-items-center rounded-md transition ${
      on ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-muted hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70'
    }`;
  return (
    <div className="surface flex items-center gap-0.5 rounded-lg p-0.5" role="tablist" aria-label={t('view_toggle')}>
      <Link href={hrefWith(searchParams, { layout: null })} role="tab" aria-selected={layout === 'list'} aria-label={t('list_view')} className={cls(layout === 'list')}>
        <ListIcon className="h-3.5 w-3.5" />
      </Link>
      <Link href={hrefWith(searchParams, { layout: 'grid' })} role="tab" aria-selected={layout === 'grid'} aria-label={t('grid_view')} className={cls(layout === 'grid')}>
        <LayoutGrid className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function pageHref(searchParams: SearchParams, page: number) {
  return hrefWith(searchParams, { page: page > 1 ? String(page) : null });
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
    'inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:text-zinc-50';
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
