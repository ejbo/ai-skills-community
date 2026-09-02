// 技术专区 — zone header band (server component), compact: cover (GlareHover)
// or HairlineGrid fallback, icon, name (plain text — the title deliberately
// does NOT animate), the 研究所 · 部门 line, tagline, ONE policy sentence, and
// ZoneTabs (which carry the counts). Right cluster = LeadsStack (who runs this
// place — rendered on locked zones too, unlinked there because the members
// directory bounces a non-reader back here) · JoinButton · ZoneManageMenu. The old
// metrics row (ZoneStats + 可见性/加入方式 pills) is gone: the tabs already
// count, and the policy is a sentence, not two mono pills. Reused by zone
// home, wiki and the members directory.
//
// Layout contract (v2): the org line is the zone's most important metadata — it
// gets its OWN full-width row right under the name, at text-sm, with the full
// text and no truncation (it wraps instead). Do not fold it back into the pill
// row and do NOT render it with `DeptTag`: that pill is capped at 12rem for
// author rows, which is exactly the truncation this row must avoid.

import { getTranslations } from 'next-intl/server';
import { Building2 } from 'lucide-react';
import { GlareHover, HairlineGrid } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import type { ZoneCurrentUser, ZoneDetailView } from '@/lib/zones/types';
import { JoinButton } from './JoinButton';
import { LeadsStack } from './LeadsStack';
import { ZoneManageMenu } from './ZoneManageMenu';
import { ZoneTabs, type ZoneTabKey } from './ZoneTabs';
import { PILL_MONO } from './ui';

export interface ZoneHeaderProps {
  zone: ZoneDetailView;
  /** Which tab is highlighted. Every zone route passes it explicitly; when omitted ZoneTabs falls back to the pathname. */
  activeTab?: ZoneTabKey;
  /** Accepted for callers that hand the header their viewer; the header itself reads `zone.access`. */
  currentUser?: ZoneCurrentUser | null;
  /**
   * Total number of leads (owner + every moderator) for the 「版主 {count}」 link.
   * The zone home passes it from its dedicated moderator query; other routes fall
   * back to the ≤4 leads the card payload already carries.
   */
  leadCount?: number;
}

export async function ZoneHeader({ zone, activeTab, leadCount }: ZoneHeaderProps) {
  const t = await getTranslations('zones');
  const org = [zone.lab, zone.department].filter(Boolean).join(' · ');
  const policy = t(`home_policy_${zone.visibility}_${zone.joinPolicy}`);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="relative h-28 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 sm:h-36">
        {zone.coverUrl ? (
          <GlareHover className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL */}
            <img src={withBasePath(zone.coverUrl)} alt="" className="h-28 w-full object-cover sm:h-36" />
          </GlareHover>
        ) : (
          <HairlineGrid mask="top" drift />
        )}
      </div>

      <div className="px-5 sm:px-6">
        <div className="-mt-7 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-end gap-3">
            <div className="relative z-[1] shrink-0 rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              {zone.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
                <img src={withBasePath(zone.iconUrl)} alt="" className="h-14 w-14 rounded-xl object-cover sm:h-16 sm:w-16" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-900 font-mono text-xl font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900 sm:h-16 sm:w-16">
                  {zone.name.trim().charAt(0) || 'Z'}
                </span>
              )}
            </div>
            <h1 className="min-w-0 break-words pb-0.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              {zone.name}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-0.5">
            <LeadsStack slug={zone.slug} leads={zone.moderators} count={leadCount ?? zone.moderators.length} linked={zone.access.canRead} />
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
          <p className="mt-2 flex items-start gap-1.5 text-sm font-medium leading-6 text-zinc-700 dark:text-zinc-300">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <span className="sr-only">{t('zone_org_label')}: </span>
            <span className="min-w-0 break-words">{org}</span>
          </p>
        )}
        {zone.tagline && <p className="mt-0.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{zone.tagline}</p>}

        {/* The policy sentence replaces the 可见性 / 加入方式 pills: one line a visitor can read. */}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{policy}</span>
          {zone.access.roleName && zone.access.isMember && !zone.access.isOwner && (
            <span className={PILL_MONO}>{t('zone_your_role', { role: zone.access.roleName })}</span>
          )}
        </p>

        <ZoneTabs
          slug={zone.slug}
          active={activeTab}
          counts={{ posts: zone.postCount, wiki: zone.wikiCount, members: zone.memberCount }}
          className="mt-2"
        />
      </div>
    </section>
  );
}
