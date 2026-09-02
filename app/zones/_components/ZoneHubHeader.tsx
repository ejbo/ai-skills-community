// 技术专区 — hub header band (server component), compact: ONE row on lg —
// plain-text h1 (no BlurText, no per-char reveal), one sentence, the search
// box (search is the landing's main verb) and the Magnetic 创建 CTA — over the
// HairlineGrid backdrop. Counts sit under the search as mono text.

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
    <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white px-6 py-6 dark:border-zinc-800 dark:bg-zinc-950">
      <HairlineGrid mask="top" drift />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">{t('hub_title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{t('hub_subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 lg:shrink-0">
          <div className="w-full sm:w-80">
            <HubSearchBox mode={searchMode} />
            {stats.length > 0 && (
              <p className="mt-1.5 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-500">{stats.join(' · ')}</p>
            )}
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
      </div>
    </section>
  );
}
