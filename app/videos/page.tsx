import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getVideoActor } from '@/lib/video/access';
import { browseVideos, getHomeFeed, listVideoCategories } from '@/lib/video/queries';
import { parseVideoSort } from '@/lib/video/types';
import { SearchBar } from '@/components/SearchBar';
import { EmptyState } from '@/components/EmptyState';
import { HomeHero } from '@/components/video/HomeHero';
import { VideoRail } from '@/components/video/VideoRail';
import { VideoGrid } from '@/components/video/VideoGrid';
import { CategoryBar } from '@/components/video/CategoryBar';
import { VideoSort } from '@/components/video/VideoSort';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  category?: string;
  sort?: string;
  page?: string;
}

export default async function VideosPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations('video');
  const categories = await listVideoCategories();
  const categoryPills = categories.map((c) => ({ slug: c.slug, name: c.name }));

  const isBrowse = Boolean(
    searchParams.q || searchParams.category || searchParams.sort || searchParams.page,
  );

  // ── Home (Netflix billboard + rails) ───────────────────────────────────────
  if (!isBrowse) {
    const actor = await getVideoActor();
    const feed = await getHomeFeed(actor?.id ?? null);

    return (
      <div className="animate-fade-in">
        {feed.hero.length > 0 && (
          <div className="container pt-4 sm:pt-6">
            <HomeHero videos={feed.hero} />
          </div>
        )}

        <div className="container mt-5">
          <CategoryBar categories={categoryPills} />
        </div>

        <div className="container space-y-9 py-8">
          {feed.rails.map((rail) => (
            <VideoRail key={rail.key} title={rail.title} href={rail.href} videos={rail.videos} />
          ))}
        </div>
      </div>
    );
  }

  // ── Browse / search ────────────────────────────────────────────────────────
  const currentPage = Number(searchParams.page) || 1;
  const { videos, total, hasMore, page } = await browseVideos({
    q: searchParams.q,
    categorySlug: searchParams.category,
    sort: parseVideoSort(searchParams.sort),
    page: currentPage,
  });

  return (
    <div className="container animate-fade-in py-6">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('feed.title')}</h1>
        <SearchBar />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CategoryBar categories={categoryPills} active={searchParams.category} />
          <VideoSort />
        </div>
      </div>

      <div className="mt-7">
        {videos.length === 0 ? (
          <EmptyState title={t('feed.no_results')} description={t('feed.no_results_hint')} />
        ) : (
          <VideoGrid videos={videos} />
        )}
      </div>

      {(page > 1 || hasMore) && (
        <Pagination searchParams={searchParams} page={page} hasMore={hasMore} total={total} />
      )}
    </div>
  );
}

function buildHref(searchParams: SearchParams, page: number): string {
  const sp = new URLSearchParams();
  if (searchParams.q) sp.set('q', searchParams.q);
  if (searchParams.category) sp.set('category', searchParams.category);
  if (searchParams.sort) sp.set('sort', searchParams.sort);
  if (page > 1) sp.set('page', String(page));
  const qs = sp.toString();
  return qs ? `/videos?${qs}` : '/videos';
}

function Pagination({
  searchParams,
  page,
  hasMore,
  total,
}: {
  searchParams: SearchParams;
  page: number;
  hasMore: boolean;
  total: number;
}) {
  return (
    <nav className="mt-8 flex items-center justify-between gap-4" aria-label="Pagination">
      <PageLink href={buildHref(searchParams, page - 1)} disabled={page <= 1}>
        <ChevronLeft className="h-4 w-4" />
        Prev
      </PageLink>
      <span className="text-xs text-muted">
        {page} · {total.toLocaleString()}
      </span>
      <PageLink href={buildHref(searchParams, page + 1)} disabled={!hasMore} align="end">
        Next
        <ChevronRight className="h-4 w-4" />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  align = 'start',
  children,
}: {
  href: string;
  disabled: boolean;
  align?: 'start' | 'end';
  children: React.ReactNode;
}) {
  const base =
    'inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';
  if (disabled) {
    return (
      <span
        className={`${base} surface pointer-events-none text-muted opacity-40 ${
          align === 'end' ? 'ml-auto' : ''
        }`}
        aria-disabled
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      className={`${base} surface card-hover ${align === 'end' ? 'ml-auto' : ''}`}
    >
      {children}
    </Link>
  );
}
