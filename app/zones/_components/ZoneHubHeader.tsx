// 技术专区 — hub header band (server component).
//
// Ask #5: the title is PLAIN TEXT — no BlurText, no per-char reveal. What is
// left is quiet chrome: the HairlineGrid backdrop, one Magnetic primary CTA and
// the search box, which sits here because /zones is a feed-first landing and
// search is its main verb.

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { HairlineGrid, Magnetic } from '@/components/motion';
import { HubSearchBox } from './ZoneFilters';
import { BTN_PRIMARY } from './ui';

export async function ZoneHubHeader({
  canCreate,
  searchMode,
  zoneCount,
  postCount,
}: {
  canCreate: boolean;
  searchMode: 'feed' | 'boards';
  zoneCount?: number;
  postCount?: number;
}) {
  const t = await getTranslations('zones');
  const stats: string[] = [];
  if (typeof zoneCount === 'number') stats.push(t('hub_zone_count', { count: zoneCount }));
  if (typeof postCount === 'number') stats.push(t('hub_post_count', { count: postCount }));

  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white px-6 py-8 dark:border-zinc-800 dark:bg-zinc-950 sm:px-8 sm:py-10">
      <HairlineGrid mask="top" drift />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
              {t('hub_title')}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{t('hub_subtitle')}</p>
          </div>
          {canCreate && (
            <Magnetic>
              <Link href="/zones/new" className={BTN_PRIMARY}>
                <Plus className="h-4 w-4" />
                {t('hub_create')}
              </Link>
            </Magnetic>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <HubSearchBox mode={searchMode} className="w-full sm:w-96" />
          {stats.length > 0 && (
            <p className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-500">{stats.join(' · ')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
