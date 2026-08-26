// 技术专区 — zone header band (server component): cover (GlareHover) or
// HairlineGrid fallback, icon, name (BlurText — the page's one reveal),
// tagline, org/visibility/join pills, ZoneStats (CountUp), JoinButton,
// ZoneManageMenu and ZoneTabs. Reused by zone home and the members directory.

import { getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';
import { BlurText, GlareHover, HairlineGrid } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import type { ZoneCurrentUser, ZoneDetailView } from '@/lib/zones/types';
import { JoinButton } from './JoinButton';
import { ZoneManageMenu } from './ZoneManageMenu';
import { ZoneStats } from './ZoneStats';
import { ZoneTabs, type ZoneTabKey } from './ZoneTabs';
import { PILL_MONO } from './ui';

export interface ZoneHeaderProps {
  zone: ZoneDetailView;
  /** Which tab is highlighted. Every zone route passes it explicitly; when omitted ZoneTabs falls back to the pathname. */
  activeTab?: ZoneTabKey;
  /** Accepted for callers that hand the header their viewer; the header itself reads `zone.access`. */
  currentUser?: ZoneCurrentUser | null;
}

export async function ZoneHeader({ zone, activeTab }: ZoneHeaderProps) {
  const t = await getTranslations('zones');
  const tl = await getTranslations('labels');
  const org = [zone.lab, zone.department].filter(Boolean);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="relative h-32 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 sm:h-44">
        {zone.coverUrl ? (
          <GlareHover className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL */}
            <img src={withBasePath(zone.coverUrl)} alt="" className="h-32 w-full object-cover sm:h-44" />
          </GlareHover>
        ) : (
          <HairlineGrid mask="top" drift />
        )}
      </div>

      <div className="px-5 sm:px-6">
        <div className="-mt-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 items-end gap-4">
            <div className="relative z-[1] shrink-0 rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              {zone.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
                <img src={withBasePath(zone.iconUrl)} alt="" className="h-16 w-16 rounded-xl object-cover sm:h-20 sm:w-20" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-zinc-900 font-mono text-2xl font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900 sm:h-20 sm:w-20">
                  {zone.name.trim().charAt(0) || 'Z'}
                </span>
              )}
            </div>
            <div className="min-w-0 pb-1">
              <BlurText
                text={zone.name}
                as="h1"
                by="chars"
                stagger={0.025}
                className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl"
              />
              {zone.tagline && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{zone.tagline}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <JoinButton
              slug={zone.slug}
              name={zone.name}
              access={zone.access}
              joinPolicy={zone.joinPolicy}
              magnetic={!zone.access.canPost}
            />
            <ZoneManageMenu slug={zone.slug} access={zone.access} pendingCount={zone.pendingCount} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {org.map((v) => (
            <span key={v} className={`${PILL_MONO} max-w-[16rem] truncate normal-case tracking-normal`}>
              {v}
            </span>
          ))}
          <span className={PILL_MONO} title={t('zone_visibility_label')}>
            {zone.visibility === 'members' && <Lock className="h-3 w-3" />}
            {tl(`zoneVisibility.${zone.visibility}`)}
          </span>
          <span className={PILL_MONO} title={t('zone_join_policy_label')}>
            {tl(`zoneJoinPolicy.${zone.joinPolicy}`)}
          </span>
          {zone.access.roleName && zone.access.isMember && !zone.access.isOwner && (
            <span className={PILL_MONO}>{t('zone_your_role', { role: zone.access.roleName })}</span>
          )}
        </div>

        <div className="mt-4">
          <ZoneStats members={zone.memberCount} posts={zone.postCount} wiki={zone.wikiCount} />
        </div>

        <ZoneTabs
          slug={zone.slug}
          active={activeTab}
          counts={{ posts: zone.postCount, wiki: zone.wikiCount, members: zone.memberCount }}
          className="mt-4"
        />
      </div>
    </section>
  );
}
