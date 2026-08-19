import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus, Star } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { EmptyState } from '@/components/EmptyState';
import {
  listFeaturedVoteActivities,
  listVoteActivities,
  voteViewerFromSession,
  type VoteTab,
} from '@/lib/vote-queries';
import { VoteCard } from './_components/VoteCard';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getTranslations('votes');
  return { title: t('meta_title') };
}

// Next 14 交给 page 的 searchParams 运行时可能是 string[]（?q=a&q=b）——取第一个。
interface SearchParams {
  tab?: string | string[];
  page?: string | string[];
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : (v ?? '')).trim();
}

function votesHref(patch: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/votes?${qs}` : '/votes';
}

export default async function VotesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();
  const viewer = voteViewerFromSession(session);
  const t = await getTranslations('votes');

  const tabRaw = firstParam(searchParams.tab);
  const tab: VoteTab = tabRaw === 'ended' ? 'ended' : tabRaw === 'mine' && viewer.id ? 'mine' : 'active';
  const pageNum = Math.max(1, Number.parseInt(firstParam(searchParams.page), 10) || 1);

  const showFeatured = tab === 'active' && pageNum === 1;
  const [list, featured] = await Promise.all([
    listVoteActivities(tab, viewer, pageNum),
    showFeatured ? listFeaturedVoteActivities(viewer) : Promise.resolve([]),
  ]);
  const featuredIds = new Set(featured.map((v) => v.id));
  const mainItems = list.items.filter((v) => !(showFeatured && featuredIds.has(v.id)));

  const createHref = session?.user
    ? '/votes/new'
    : `/auth/login?callbackUrl=${encodeURIComponent('/votes/new')}`;

  const tabs: { key: VoteTab; label: string }[] = [
    { key: 'active', label: t('tab_active') },
    { key: 'ended', label: t('tab_ended') },
    ...(viewer.id ? [{ key: 'mine' as VoteTab, label: t('tab_mine') }] : []),
  ];

  return (
    <div className="container py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Link
          href={createHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
        >
          <Plus className="h-4 w-4" />
          {t('create')}
        </Link>
      </div>

      <div className="mb-6 inline-flex rounded-xl border border-zinc-200 p-1 dark:border-zinc-800">
        {tabs.map((item) => {
          const active = tab === item.key;
          return (
            <Link
              key={item.key}
              href={votesHref(item.key === 'active' ? {} : { tab: item.key })}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                active
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {showFeatured && featured.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Star className="h-4 w-4" />
            {t('featured')}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((v) => (
              <VoteCard key={v.id} vote={v} />
            ))}
          </div>
        </section>
      )}

      {mainItems.length === 0 && featured.length === 0 ? (
        <EmptyState
          title={t('empty_title')}
          description={t('empty_hint')}
          actionLabel={t('create')}
          actionHref={createHref}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mainItems.map((v) => (
              <VoteCard key={v.id} vote={v} />
            ))}
          </div>
          {list.pageCount > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3 text-sm">
              {list.page > 1 ? (
                <Link
                  href={votesHref({
                    ...(tab === 'active' ? {} : { tab }),
                    page: String(list.page - 1),
                  })}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-3 transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('prev_page')}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted">
                {t('page_indicator', { page: list.page, pageCount: list.pageCount })}
              </span>
              {list.page < list.pageCount ? (
                <Link
                  href={votesHref({
                    ...(tab === 'active' ? {} : { tab }),
                    page: String(list.page + 1),
                  })}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-3 transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
                >
                  {t('next_page')}
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
