// 技术专区 — zone header band (server component): cover (GlareHover) or
// HairlineGrid fallback, icon, name (plain text — the title deliberately does
// NOT animate), the 研究所 · 部门 line, tagline, JoinButton, ZoneManageMenu, then
// a metrics row (ZoneStats + the secondary 可见性/加入方式/角色 pills) and
// ZoneTabs. Reused by zone home, wiki and the members directory.
//
// Layout contract (v2): the org line is the zone's most important metadata — it
// gets its OWN full-width row right under the name, at text-sm, with the full
// text and no truncation (it wraps instead). Do not fold it back into the pill
// row and do NOT render it with `DeptTag`: that pill is capped at 12rem for
// author rows, which is exactly the truncation this row must avoid. 可见性 /
// 加入方式 / 我的角色 are secondary — they live on the metrics row below.

import { getTranslations } from 'next-intl/server';
import { Building2, Lock } from 'lucide-react';
import { GlareHover, HairlineGrid } from '@/components/motion';
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
  const org = [zone.lab, zone.department].filter(Boolean).join(' · ');

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
            <h1 className="min-w-0 break-words pb-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              {zone.name}
            </h1>
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

        {/* 研究所 · 部门 — its own full-width row right under the name so the whole
            path fits and simply wraps. It sits OUTSIDE the name block on purpose:
            that block is bottom-aligned with the icon that overlaps the cover, so a
            third line there would push the title up onto the cover image. */}
        {org && (
          <p className="mt-3 flex items-start gap-1.5 text-sm font-medium leading-6 text-zinc-700 dark:text-zinc-300">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <span className="sr-only">{t('zone_org_label')}: </span>
            <span className="min-w-0 break-words">{org}</span>
          </p>
        )}
        {zone.tagline && (
          <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{zone.tagline}</p>
        )}

        {/* Metrics + the secondary pills — deliberately BELOW and lighter than the org line. */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <ZoneStats members={zone.memberCount} posts={zone.postCount} wiki={zone.wikiCount} />
          <div className="flex flex-wrap items-center gap-1.5">
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
