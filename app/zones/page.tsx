// 技术专区 hub: header band (创建版块 CTA when allowed), 精选 band, 全部 / 我的版块
// tabs, filters, StaggerGrid of ZoneCard, pagination, 最新发布 band.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight, Layers, Newspaper, Star } from 'lucide-react';
import { auth } from '@/lib/auth';
import { canUserCreateZone, zoneSiteViewer } from '@/lib/zones/access';
import { featuredZones, listZones, zoneFacets } from '@/lib/zones/queries';
import { listRecentPostsAcrossZones } from '@/lib/zones/post-queries';
import { parseZoneSort } from '@/lib/zones/shared';
import { StaggerGrid, TabBar } from '@/components/motion';
import { PostRow } from './_components/PostRow';
import { ZoneCard } from './_components/ZoneCard';
import { ZoneFilters } from './_components/ZoneFilters';
import { ZoneGrid } from './_components/ZoneGrid';
import { ZoneHubHeader } from './_components/ZoneHubHeader';
import { BTN_SECONDARY, SECTION_TITLE_CLS, hrefWith, loginHref } from './_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('zones');
  return { title: t('hub_title') };
}

// Next 14 hands searchParams as string | string[] — take the first.
interface SearchParams {
  tab?: string | string[];
  q?: string | string[];
  lab?: string | string[];
  department?: string | string[];
  sort?: string | string[];
  page?: string | string[];
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : (v ?? '')).trim();
}

const PAGE_SIZE = 24;

export default async function ZonesHubPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/zones'));
  const viewer = zoneSiteViewer(session.user);
  const t = await getTranslations('zones');

  const tab = firstParam(searchParams.tab) === 'mine' ? 'mine' : 'all';
  const q = firstParam(searchParams.q);
  const lab = firstParam(searchParams.lab);
  const department = firstParam(searchParams.department);
  const sort = parseZoneSort(firstParam(searchParams.sort));
  const page = Math.max(1, Number.parseInt(firstParam(searchParams.page), 10) || 1);
  const filtered = Boolean(q || lab || department);
  const showBands = tab === 'all' && page === 1 && !filtered;

  const [list, featured, facets, recent, canCreate] = await Promise.all([
    listZones({ q, lab, department, sort, page, pageSize: PAGE_SIZE, mineFor: tab === 'mine' ? viewer.id : null, viewer }),
    showBands ? featuredZones(viewer, 6) : Promise.resolve([]),
    zoneFacets(),
    showBands ? listRecentPostsAcrossZones(viewer, 8) : Promise.resolve([]),
    canUserCreateZone(session.user),
  ]);

  const current = { tab: tab === 'mine' ? 'mine' : '', q, lab, department, sort: sort === 'active' ? '' : sort };
  const tabs = [
    { key: 'all', label: t('hub_tab_all'), href: hrefWith('/zones', { ...current, tab: '' }) },
    { key: 'mine', label: t('hub_tab_mine'), href: hrefWith('/zones', { ...current, tab: 'mine' }) },
  ];
  const pageHref = (n: number) => hrefWith('/zones', { ...current, page: String(n) });

  return (
    <div className="container py-8">
      <ZoneHubHeader canCreate={canCreate} zoneCount={list.total} />

      {showBands && featured.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Star className="h-4 w-4 text-zinc-400" />
              {t('hub_featured')}
            </h2>
          </div>
          <StaggerGrid
            items={featured}
            keyOf={(z) => z.id}
            render={(z) => <ZoneCard zone={z} variant="featured" />}
            className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            itemClassName="w-80 shrink-0 snap-start"
            stagger={0.06}
            cascade={6}
          />
        </section>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <TabBar tabs={tabs} active={tab} id="zones-hub-tabs" />
          <p className="font-mono text-xs tabular-nums text-zinc-500">{t('hub_result_count', { count: list.total })}</p>
        </div>
        <div className="mt-4">
          <ZoneFilters labs={facets.labs} departments={facets.departments} />
        </div>

        <div className="mt-6">
          {list.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-8 py-16 text-center dark:border-zinc-800">
              <Layers className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
              <h3 className="mt-3 text-sm font-semibold">{tab === 'mine' ? t('hub_mine_empty_title') : t('hub_empty_title')}</h3>
              <p className="mt-1 max-w-sm text-xs text-muted">
                {tab === 'mine' ? t('hub_mine_empty_desc') : filtered ? t('hub_empty_filtered_desc') : t('hub_empty_desc')}
              </p>
              {tab === 'mine' && (
                <Link href="/zones" className={`${BTN_SECONDARY} mt-4`}>
                  {t('hub_browse_all')}
                </Link>
              )}
            </div>
          ) : (
            <ZoneGrid zones={list.items} />
          )}
        </div>

        {(page > 1 || list.hasMore) && (
          <nav className="mt-8 flex items-center justify-center gap-3" aria-label={t('hub_pagination')}>
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className={BTN_SECONDARY}>
                <ChevronLeft className="h-4 w-4" />
                {t('hub_prev_page')}
              </Link>
            ) : (
              <span className={`${BTN_SECONDARY} opacity-40`} aria-disabled>
                <ChevronLeft className="h-4 w-4" />
                {t('hub_prev_page')}
              </span>
            )}
            <span className="font-mono text-xs tabular-nums text-zinc-500">
              {page} / {Math.max(1, Math.ceil(list.total / list.pageSize))}
            </span>
            {list.hasMore ? (
              <Link href={pageHref(page + 1)} className={BTN_SECONDARY}>
                {t('hub_next_page')}
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className={`${BTN_SECONDARY} opacity-40`} aria-disabled>
                {t('hub_next_page')}
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </nav>
        )}
      </section>

      {showBands && recent.length > 0 && (
        <section className="mt-12">
          <div className="mb-2 flex items-end justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Newspaper className="h-4 w-4 text-zinc-400" />
              {t('hub_recent_posts')}
            </h2>
            <span className={SECTION_TITLE_CLS}>{t('hub_recent_posts_hint')}</span>
          </div>
          <div className="grid gap-x-10 lg:grid-cols-2">
            {recent.map((post) => (
              <PostRow key={post.id} post={post} compact showZone />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
