import Link from 'next/link';
import { ChevronLeft, ChevronRight, Clapperboard, Play, Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getVideoActor } from '@/lib/video/access';
import { browseVideos, getHomeFeed, listVideoCategories } from '@/lib/video/queries';
import {
  annotateShortsViewer,
  featuredShorts,
  listShorts,
  toShortView,
} from '@/lib/video/shorts-queries';
import { parseVideoSort } from '@/lib/video/types';
import { ShortsBrowse } from '@/components/video/ShortsBrowse';
import { SearchBar } from '@/components/SearchBar';
import { EmptyState } from '@/components/EmptyState';
import { HomeHero } from '@/components/video/HomeHero';
import { VideoRail } from '@/components/video/VideoRail';
import { VideoGrid } from '@/components/video/VideoGrid';
import { CategoryBar } from '@/components/video/CategoryBar';
import { VideoSort } from '@/components/video/VideoSort';
import { VideoBreadcrumb } from '@/components/video/VideoBreadcrumb';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  category?: string;
  sort?: string;
  page?: string;
  tab?: string;
}

/** GeekHub 视频 | 短视频 tab switcher (segmented control under the breadcrumb). */
function VideosTabs({
  active,
  videosLabel,
  shortsLabel,
}: {
  active: 'videos' | 'shorts';
  videosLabel: string;
  shortsLabel: string;
}) {
  const base = 'flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition';
  const on = 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white';
  const off = 'text-muted hover:text-zinc-800 dark:hover:text-zinc-200';
  return (
    <div className="flex w-fit items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
      <Link href="/videos" className={`${base} ${active === 'videos' ? on : off}`}>
        <Clapperboard className="h-4 w-4" />
        {videosLabel}
      </Link>
      <Link href="/videos?tab=shorts" className={`${base} ${active === 'shorts' ? on : off}`}>
        <Play className="h-4 w-4" />
        {shortsLabel}
      </Link>
    </div>
  );
}

export default async function VideosPage({ searchParams }: { searchParams: SearchParams }) {
  const t = await getTranslations('video');
  const ts = await getTranslations('shorts');
  const categories = await listVideoCategories();
  const categoryPills = categories.map((c) => ({ slug: c.slug, name: c.name }));

  // ── 短视频 tab (Douyin-style browse; same unified player) ──────────────────
  if (searchParams.tab === 'shorts') {
    const actor = await getVideoActor();
    const viewerId = actor?.id ?? null;
    const viewerIsAdmin = actor?.isAdmin ?? false;
    const [heroRows, latestRes] = await Promise.all([
      featuredShorts(10),
      listShorts({ sort: 'new', limit: 18, viewerId }),
    ]);
    const heroItems = (await annotateShortsViewer(heroRows, viewerId)).map((s) =>
      toShortView(s, viewerIsAdmin),
    );
    const latest = latestRes.items.map((s) => toShortView(s, viewerIsAdmin));

    return (
      <div className="container animate-fade-in py-6">
        <VideoBreadcrumb items={[{ label: t('nav'), href: '/videos' }, { label: ts('title') }]} />
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <VideosTabs active="shorts" videosLabel={ts('tab_videos')} shortsLabel={ts('tab_shorts')} />
          <Link
            href="/videos/shorts?upload=1"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-600"
          >
            <Plus className="h-4 w-4" />
            {ts('upload')}
          </Link>
        </div>
        <ShortsBrowse heroItems={heroItems} latest={latest} />
      </div>
    );
  }

  const isBrowse = Boolean(
    searchParams.q || searchParams.category || searchParams.sort || searchParams.page,
  );

  // ── Home (Netflix billboard + rails) ───────────────────────────────────────
  if (!isBrowse) {
    const actor = await getVideoActor();
    const feed = await getHomeFeed(actor?.id ?? null);

    return (
      <div className="animate-fade-in">
        <div className="container pt-4">
          <VideoBreadcrumb items={[{ label: t('nav') }]} />
          <div className="mt-3">
            <VideosTabs active="videos" videosLabel={ts('tab_videos')} shortsLabel={ts('tab_shorts')} />
          </div>
        </div>
        {feed.hero.length > 0 && (
          <div className="container">
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

  const activeCat = searchParams.category
    ? categories.find((c) => c.slug === searchParams.category)
    : null;
  const browseLeaf = activeCat ? activeCat.name : searchParams.q ? `“${searchParams.q}”` : t('feed.title');

  return (
    <div className="container animate-fade-in py-6">
      <VideoBreadcrumb items={[{ label: t('nav'), href: '/videos' }, { label: browseLeaf }]} />
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
