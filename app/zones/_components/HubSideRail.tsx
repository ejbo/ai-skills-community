// 技术专区 hub — the right rail beside the 动态 feed (server component, xl+):
// 热门版块 as a ranked list (贴吧's 热门吧 — rank digit · icon · name · 帖子/成员),
// then a quiet 创建版块 card for viewers who may. Reference, not showcase: no
// SpotlightCard, no cascade; the rank digits are mono and the icons carry the
// zone's own colour.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, Plus } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCardView } from '@/lib/zones/types';
import { hubCopy } from './ZoneHubHero';
import { BTN_SECONDARY, CARD_CLS, SECTION_TITLE_CLS } from './ui';
import { zoneHue } from './zone-color';

export async function HubSideRail({ hot, canCreate }: { hot: ZoneCardView[]; canCreate: boolean }) {
  const [t, copy] = await Promise.all([getTranslations('zones'), hubCopy()]);

  return (
    <aside className="space-y-4">
      {hot.length > 0 && (
        <section className={`${CARD_CLS} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className={SECTION_TITLE_CLS}>{t('hub_hot_title')}</h2>
            <Link
              href="/zones?tab=boards"
              className="group inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {t('hub_browse_all')}
              <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
          <ol className="mt-2 -mx-2">
            {hot.map((zone, i) => (
              <li key={zone.id}>
                <Link
                  href={zoneHref(zone.slug)}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                >
                  <span
                    className={`w-4 shrink-0 text-center font-mono text-xs tabular-nums ${
                      i < 3 ? 'font-semibold text-zinc-900 dark:text-zinc-50' : 'text-zinc-400'
                    }`}
                  >
                    {i + 1}
                  </span>
                  {zone.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
                    <img src={withBasePath(zone.iconUrl)} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold uppercase text-white"
                      style={{ backgroundColor: zoneHue(zone.name, zone.themeColor) }}
                    >
                      {zone.name.trim().charAt(0) || 'Z'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-900 group-hover:underline dark:text-zinc-50">
                      {zone.name}
                    </span>
                    <span className="block truncate font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                      {t('hub_hot_meta', { posts: zone.postCount, members: zone.memberCount })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {canCreate && (
        <section className={`${CARD_CLS} p-4`}>
          {/* 开一个版块 copy is admin-editable (首页设置) — resolved in hubCopy(). */}
          <h2 className={SECTION_TITLE_CLS}>{copy.createTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{copy.createDesc}</p>
          <Link href="/zones/new" className={`${BTN_SECONDARY} mt-3 w-full`}>
            <Plus className="h-4 w-4" />
            {t('hub_create')}
          </Link>
        </section>
      )}
    </aside>
  );
}
