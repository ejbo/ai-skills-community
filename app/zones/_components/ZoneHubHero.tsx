// 技术专区 — hub hero (server component), 贴吧-style: the section's name, one
// sentence, ONE big search box (finding a board is the landing's main verb),
// three figures for the whole 专区 and the 创建版块 CTA on the left; the
// 版块墙 (ZoneWall3D) on the right at lg+. Over the HairlineGrid backdrop.
//
// The figures are first-paint counts and never animate (motion grammar).
// They are formatted en-US like the homepage hero so SSR and the browser
// agree on the string.
//
// COPY + TOGGLES come from 管理后台 → 技术专区 → 首页设置 (ZoneSiteSetting):
// `hubCopy()` resolves the viewer's locale → 中文 → the i18n message, so a
// half-filled form never renders a blank; `showTotals` / `showWall` switch the
// figures and the 版块墙 off (the left block then takes a single column).

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { HairlineGrid, Magnetic } from '@/components/motion';
import { getZoneSiteSetting } from '@/lib/zones/site-settings';
import { resolveZoneHubCopy, type ZoneHubCopy } from '@/lib/zones/site-settings-shared';
import type { ZoneCardView } from '@/lib/zones/types';
import { HubSearchBox } from './ZoneFilters';
import { ZoneWall3D } from './ZoneWall3D';
import { BTN_PRIMARY } from './ui';

const fmt = new Intl.NumberFormat('en-US');

/** The hub's copy for the current viewer (admin override → 中文 → i18n). Shared with page.tsx + HubSideRail. */
export async function hubCopy(): Promise<ZoneHubCopy> {
  const [t, locale, setting] = await Promise.all([getTranslations('zones'), getLocale(), getZoneSiteSetting()]);
  return resolveZoneHubCopy(setting.copy, locale, {
    eyebrow: t('hub_eyebrow'),
    title: t('hub_title'),
    subtitle: t('hub_subtitle'),
    createTitle: t('hub_create_card_title'),
    createDesc: t('hub_create_card_desc'),
  });
}

export async function ZoneHubHero({
  canCreate,
  searchMode,
  totals,
  wall,
}: {
  canCreate: boolean;
  searchMode: 'feed' | 'boards';
  totals: { zones: number; posts: number; members: number };
  /** Busiest readable 版块 — the tiles on the wall (≤ WALL_MAX). */
  wall: ZoneCardView[];
}) {
  const [t, copy, setting] = await Promise.all([getTranslations('zones'), hubCopy(), getZoneSiteSetting()]);
  const showWall = setting.showWall && wall.length > 0;
  const figures = [
    { key: 'zones', value: totals.zones, label: t('hub_fig_zones') },
    { key: 'posts', value: totals.posts, label: t('hub_fig_posts') },
    { key: 'members', value: totals.members, label: t('hub_fig_members') },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <HairlineGrid mask="top" drift />
      {/* A neutral overhead light — colourless, the same material as the homepage hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-70 dark:opacity-40"
        style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgb(var(--text) / 0.06), transparent 70%)' }}
      />
      <div
        className={`relative grid gap-8 px-6 py-8 sm:px-8 lg:items-center lg:py-10 ${
          showWall ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]' : ''
        }`}
      >
        <div className={`min-w-0 ${showWall ? '' : 'max-w-3xl'}`}>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">{copy.title}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">{copy.subtitle}</p>

          <div className="mt-6 max-w-xl">
            <HubSearchBox mode={searchMode} size="lg" />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4">
            {setting.showTotals && (
              <dl className="flex items-center gap-6">
                {figures.map((f) => (
                  <div key={f.key} className="flex flex-col">
                    <dd className="order-first font-mono text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
                      {fmt.format(f.value)}
                    </dd>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">{f.label}</dt>
                  </div>
                ))}
              </dl>
            )}
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

        {showWall && (
          <div className="hidden min-w-0 lg:block">
            <ZoneWall3D zones={wall} className="h-[19rem]" />
          </div>
        )}
      </div>
    </section>
  );
}
