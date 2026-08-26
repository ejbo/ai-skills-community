// 技术专区 — hub header band (server component). BlurText title (the page's one
// text reveal), HairlineGrid behind, Magnetic on the single primary CTA.

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { BlurText, HairlineGrid, Magnetic } from '@/components/motion';
import { BTN_PRIMARY } from './ui';

export async function ZoneHubHeader({ canCreate, zoneCount }: { canCreate: boolean; zoneCount: number }) {
  const t = await getTranslations('zones');
  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white px-6 py-8 dark:border-zinc-800 dark:bg-zinc-950 sm:px-8 sm:py-10">
      <HairlineGrid mask="top" drift />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <BlurText
            text={t('hub_title')}
            as="h1"
            by="chars"
            stagger={0.03}
            className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl"
          />
          <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{t('hub_subtitle')}</p>
          <p className="mt-3 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
            {t('hub_zone_count', { count: zoneCount })}
          </p>
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
    </section>
  );
}
