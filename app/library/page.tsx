import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon } from 'lucide-react';
import { auth } from '@/lib/auth';
import {
  browseDocs,
  getBrowseCounts,
  getContinueReading,
  getFeaturedDocs,
  getHotDocs,
  getRecentActivity,
  getTopCommentedDocs,
} from '@/lib/library-queries';
import { can } from '@/lib/permissions';
import { listLibraryCategories, type LibraryCategoryOption } from '@/lib/library/categories';
import { CATEGORY_NAME_BY_SLUG, LIBRARY_SECTIONS, isLibrarySection } from '@/lib/library/types';
import { SearchBar } from '@/components/SearchBar';
import { EmptyState } from '@/components/EmptyState';
import { ActivityRail } from '@/components/library/ActivityRail';
import { BrowseColumns } from '@/components/library/BrowseColumns';
import { DocCard } from '@/components/library/DocCard';
import { DocListRow } from '@/components/library/DocListRow';
import { HotRail } from '@/components/library/HotRail';
import { ListScrollRestore } from '@/components/library/ScrollMemory';
import { LibrarySort } from '@/components/library/LibrarySort';
import { RailItem } from '@/components/library/RailItem';
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
const RAIL_HOT = 5;
const RAIL_CONTINUE = 3;
/** 最新评论与批注: this many visible at first, the rest behind 展开更多. */
const RAIL_ACTIVITY_SHOWN = 5;
const RAIL_ACTIVITY_TOTAL = 15;

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

  const [
    { items, total, page, pageSize, hasMore },
    featured,
    hot,
    commented,
    mostRead,
    mostShelved,
    continueReading,
    activity,
    counts,
  ] = await Promise.all([
      browseDocs({
        q: searchParams.q,
        type: searchParams.type,
        cat: activeTopic?.slug,
        cats: !activeTopic && section ? topicsInRail.map((c) => c.slug) : undefined,
        sort: searchParams.sort,
        page: Number(searchParams.page ?? 1),
      }),
      getFeaturedDocs(RAIL_FEATURED),
      getHotDocs(RAIL_HOT),
      getTopCommentedDocs(undefined, RAIL_HOT),
      browseDocs({ sort: 'readers', pageSize: RAIL_HOT }).then((r) => r.items.filter((d) => d.readerCount > 0)),
      browseDocs({ sort: 'shelved', pageSize: RAIL_HOT }).then((r) => r.items.filter((d) => d.shelfCount > 0)),
      session?.user ? getContinueReading(session.user.id, RAIL_CONTINUE) : Promise.resolve([]),
      getRecentActivity({
        limit: RAIL_ACTIVITY_TOTAL,
        locale,
        canSeeIdentity: session?.user ? can(session.user, 'identity') : false,
      }),
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

      <BrowseColumns
        main={
          <>
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
          </>
        }
        aside={
          <>
            {featured.length > 0 && (
              <Rail title={t('rail_featured')} moreHref="/library?sort=featured" moreLabel={t('rail_featured_all')}>
                {featured.map((doc) => (
                  <RailItem key={doc.id} doc={doc} />
                ))}
              </Rail>
            )}
            <HotRail lists={{ hot, commented, read: mostRead, shelved: mostShelved }} />
            {continueReading.length > 0 && (
              <Rail title={t('rail_continue')} moreHref="/library/shelf" moreLabel={t('rail_shelf_link')}>
                {continueReading.map(({ doc, percent }) => (
                  <RailItem key={doc.id} doc={doc} percent={percent} />
                ))}
              </Rail>
            )}
            <ActivityRail items={activity} initial={RAIL_ACTIVITY_SHOWN} />
          </>
        }
      />
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
