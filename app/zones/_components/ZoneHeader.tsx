// 技术专区 — zone header band (server component), 贴吧-style: a tall banner
// (the cover, or the zone's OWN colour as a wash + hairline grid + a watermark
// monogram), the icon overlapping it in a ring of that colour, the name (plain
// text — the title deliberately does NOT animate), the 研究所 · 实验室 line,
// tagline, ONE policy sentence, a figures row (成员 / 帖子 / Wiki, 贴吧's 关注 ·
// 帖子) and ZoneTabs. Right cluster = LeadsStack (who runs this place —
// rendered on locked zones too, unlinked there because the members directory
// bounces a non-reader back here) · JoinButton · ZoneManageMenu. Reused by zone
// home, wiki and the members directory.
//
// Layout contract (v2, kept): the org line is the zone's most important
// metadata — its OWN full-width row right under the name, text-sm, full text,
// wraps. Never `DeptTag` here (that pill truncates at 12rem).
//
// Colour: banner wash, watermark, icon ring, monogram = the zone's material
// (theme colour or name hash — zone-color.ts). Buttons, tabs, pills = ink.

import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Building2, Hash } from 'lucide-react';
import { GlareHover, HairlineGrid } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import type { ZoneCurrentUser, ZoneDetailView } from '@/lib/zones/types';
import { JoinButton } from './JoinButton';
import { LeadsStack } from './LeadsStack';
import { ZoneManageMenu } from './ZoneManageMenu';
import { ZoneTabs, type ZoneTabKey } from './ZoneTabs';
import { PILL_MONO, PILL_TOPIC } from './ui';
import { zoneBannerStyle, zoneHue } from './zone-color';

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

const fmt = new Intl.NumberFormat('en-US');

export async function ZoneHeader({ zone, activeTab, leadCount }: ZoneHeaderProps) {
  const t = await getTranslations('zones');
  // 研究所 · 实验室 — `zone.lab` is the TOP level and `zone.department` the
  // 实验室 under it (lib/org.ts: the column names read backwards). Values are
  // stored Chinese and are never translated; only the sr-only label is.
  const org = [zone.lab, zone.department].filter(Boolean).join(' · ');
  const policy = t(`home_policy_${zone.visibility}_${zone.joinPolicy}`);
  const hue = zoneHue(zone.name, zone.themeColor);
  const monogram = zone.name.trim().charAt(0) || 'Z';
  const figures = [
    { key: 'members', value: zone.memberCount, label: t('zone_stat_members') },
    { key: 'posts', value: zone.postCount, label: t('zone_stat_posts') },
    { key: 'wiki', value: zone.wikiCount, label: t('zone_stat_wiki') },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* Banner */}
      <div
        className="relative h-40 overflow-hidden border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 sm:h-52"
        style={zone.coverUrl ? undefined : zoneBannerStyle(zone.name, zone.themeColor)}
      >
        {zone.coverUrl ? (
          <GlareHover className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL */}
            <img src={withBasePath(zone.coverUrl)} alt="" className="h-40 w-full object-cover sm:h-52" />
          </GlareHover>
        ) : (
          <>
            <HairlineGrid mask="top" drift />
            {/* The watermark: the monogram at banner scale, in the zone's colour,
                faint — what makes an un-covered board look designed rather than empty. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-10 right-6 select-none font-mono text-[11rem] font-semibold leading-none sm:-bottom-14 sm:right-10 sm:text-[15rem]"
              style={{ color: hue, opacity: 0.12, transform: 'rotate(-6deg)' }}
            >
              {monogram}
            </span>
          </>
        )}
        {/* Bottom fade so the identity block reads on a busy cover. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/90 to-transparent dark:from-zinc-950/90"
        />
      </div>

      <div className="px-5 sm:px-6">
        <div className="-mt-10 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:-mt-12">
          <div className="flex min-w-0 items-end gap-4">
            {/* Icon in a ring of the zone's colour, on a white plinth. */}
            <div className="relative z-[1] shrink-0 rounded-[22px] bg-white p-1 shadow-lg dark:bg-zinc-950" style={{ boxShadow: `0 0 0 3px ${hue}, 0 12px 28px -12px ${hue}99` }}>
              {zone.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
                <img src={withBasePath(zone.iconUrl)} alt="" className="h-16 w-16 rounded-[18px] object-cover sm:h-20 sm:w-20" />
              ) : (
                <span
                  className="flex h-16 w-16 items-center justify-center rounded-[18px] font-mono text-2xl font-semibold uppercase text-white sm:h-20 sm:w-20 sm:text-3xl"
                  style={{ backgroundColor: hue }}
                >
                  {monogram}
                </span>
              )}
            </div>
            <h1 className="min-w-0 break-words pb-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              {zone.name}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-1">
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

        {/* 研究所 · 实验室 — its own full-width row right under the name so the whole
            path fits and simply wraps. It sits OUTSIDE the name block on purpose:
            that block is bottom-aligned with the icon that overlaps the banner. */}
        {org && (
          <p className="mt-3 flex items-start gap-1.5 text-sm font-medium leading-6 text-zinc-700 dark:text-zinc-300">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <span className="sr-only">{t('zone_org_label')}: </span>
            <span className="min-w-0 break-words">{org}</span>
          </p>
        )}
        {zone.tagline && <p className="mt-0.5 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">{zone.tagline}</p>}
        {/* 主题词 — outlined ink chips (metadata, never coloured); each is a hub search. */}
        {zone.topics.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('topics_label')}>
            {zone.topics.map((topic) => (
              <li key={topic}>
                <Link href={`/zones?q=${encodeURIComponent(topic)}`} className={PILL_TOPIC}>
                  <Hash className="h-3 w-3 text-zinc-400" aria-hidden />
                  {topic}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {/* 贴吧's 关注 · 帖子 row: first-paint counts, static mono digits. */}
          <dl className="flex items-center gap-5">
            {figures.map((f) => (
              <div key={f.key} className="flex items-baseline gap-1.5">
                <dd className="order-first font-mono text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{fmt.format(f.value)}</dd>
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">{f.label}</dt>
              </div>
            ))}
          </dl>
          {/* The policy sentence replaces the 可见性 / 加入方式 pills: one line a visitor can read. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{policy}</span>
            {zone.access.roleName && zone.access.isMember && !zone.access.isOwner && (
              <span className={PILL_MONO}>{t('zone_your_role', { role: zone.access.roleName })}</span>
            )}
          </p>
        </div>

        <ZoneTabs
          slug={zone.slug}
          active={activeTab}
          counts={{ posts: zone.postCount, wiki: zone.wikiCount, members: zone.memberCount }}
          className="mt-3"
        />
      </div>
    </section>
  );
}
