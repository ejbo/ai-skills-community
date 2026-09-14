'use client';

// 技术专区 — hub card, 贴吧-style: a board is a PLACE, so the card leads with
// the place's own face (cover or theme banner, big icon in the zone's colour),
// then who runs it and how alive it is (成员 / 帖子 / 版主 / latest post).
// SpotlightCard chrome (pointer-tracked light, no re-render), GlareHover on
// the cover only. The whole card is a stretched link; the 版主 avatars and the
// latest-post line are informational (no nested links but the title).
//
// Colour: the banner wash, the monogram and the icon ring are the zone's own
// (theme colour or name hash — zone-color.ts). The border, pills and figures
// stay ink (配色契约).

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Building2, FileText, Hash, Lock, Star, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { GlareHover, HairlineGrid, SpotlightCard } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCardView } from '@/lib/zones/types';
import { RelTime } from './RelTime';
import { PILL_INK, PILL_MONO, PILL_TOPIC } from './ui';
import { zoneBannerStyle, zoneHue } from './zone-color';

export function ZoneCard({ zone, variant = 'grid' }: { zone: ZoneCardView; variant?: 'grid' | 'featured' }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const locale = useLocale();
  const href = zoneHref(zone.slug);
  // [研究所, 实验室] — stored Chinese values, never translated.
  const org = [zone.lab, zone.department].filter(Boolean);
  const hue = zoneHue(zone.name, zone.themeColor);

  return (
    <SpotlightCard as="article" className="flex h-full flex-col">
      <div
        className="relative h-24 shrink-0 overflow-hidden border-b border-zinc-200 dark:border-zinc-800"
        style={zone.coverUrl ? undefined : zoneBannerStyle(zone.name, zone.themeColor)}
      >
        {zone.coverUrl ? (
          <GlareHover className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL */}
            <img
              src={withBasePath(zone.coverUrl)}
              alt=""
              loading="lazy"
              className="h-24 w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          </GlareHover>
        ) : (
          <>
            <HairlineGrid size={24} mask="center" />
            {/* Watermark monogram — the banner's own "artwork" when there is no cover. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-2 -top-4 select-none font-mono text-[6.5rem] font-semibold leading-none"
              style={{ color: hue, opacity: 0.14 }}
            >
              {zone.name.trim().charAt(0) || 'Z'}
            </span>
          </>
        )}
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          {variant === 'featured' && (
            <span className={PILL_INK}>
              <Star className="h-3 w-3" />
              {t('hub_featured_pill')}
            </span>
          )}
          {zone.visibility === 'members' && (
            <span className={`${PILL_MONO} bg-white/80 backdrop-blur dark:bg-zinc-950/80`}>
              <Lock className="h-3 w-3" />
              {tl('zoneVisibility.members')}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <div
            className="relative z-[1] -mt-11 shrink-0 rounded-2xl bg-white p-[3px] shadow-md dark:bg-zinc-950"
            style={{ boxShadow: `0 0 0 2px ${hue}` }}
          >
            {zone.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
              <img src={withBasePath(zone.iconUrl)} alt="" className="h-12 w-12 rounded-[13px] object-cover" />
            ) : (
              <span
                className="flex h-12 w-12 items-center justify-center rounded-[13px] font-mono text-lg font-semibold uppercase text-white"
                style={{ backgroundColor: hue }}
              >
                {zone.name.trim().charAt(0) || 'Z'}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="flex items-start gap-1.5 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              <Link href={href} className="min-w-0 truncate after:absolute after:inset-0 group-hover:underline">
                {zone.name}
              </Link>
              <ArrowUpRight
                aria-hidden
                className="mt-1 h-3.5 w-3.5 shrink-0 text-zinc-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-zinc-900 dark:text-zinc-600 dark:group-hover:text-zinc-100"
              />
            </h3>
            {org.length > 0 ? (
              <p className="mt-0.5 flex items-start gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                <Building2 className="mt-[3px] h-3 w-3 shrink-0" aria-hidden />
                <span className="sr-only">{t('zone_org_label')}: </span>
                <span className="min-w-0 line-clamp-1 break-all">{org.join(' · ')}</span>
              </p>
            ) : null}
          </div>
        </div>

        <p className="mt-2.5 line-clamp-2 min-h-[2.6em] text-sm text-zinc-600 dark:text-zinc-400">
          {zone.tagline || t('zone_card_no_tagline')}
        </p>
        {zone.topics.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1" aria-label={t('topics_label')}>
            {zone.topics.slice(0, 3).map((topic) => (
              <li key={topic}>
                {/* `relative z-[1]` lifts the chip above the card's stretched link so it is its own target. */}
                <Link href={`/zones?q=${encodeURIComponent(topic)}`} className={`${PILL_TOPIC} relative z-[1]`}>
                  <Hash className="h-3 w-3 text-zinc-400" aria-hidden />
                  {topic}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-3">
          <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-3 font-mono tabular-nums">
              <span className="inline-flex items-center gap-1" title={t('zone_stat_members')}>
                <Users className="h-3.5 w-3.5" />
                {zone.memberCount}
              </span>
              <span className="inline-flex items-center gap-1" title={t('zone_stat_posts')}>
                <FileText className="h-3.5 w-3.5" />
                {zone.postCount}
              </span>
              {zone.membership && (
                <span className={`${PILL_MONO} normal-case tracking-normal`}>
                  {zone.membership === 'owner'
                    ? tl('zoneRole.owner')
                    : zone.membership === 'active'
                      ? t('zone_card_joined')
                      : t('zone_card_pending')}
                </span>
              )}
            </span>
            <span className="flex -space-x-1.5" title={t('about_moderators')}>
              {zone.moderators.slice(0, 4).map((m) => (
                <span key={m.handle} className="rounded-full ring-2 ring-white dark:ring-zinc-950">
                  <Avatar name={m.displayName} src={m.avatarUrl} size="xs" handle={m.handle} />
                </span>
              ))}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
            {zone.latestPost ? (
              <>
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{zone.latestPost.title}</span>
                <RelTime at={zone.latestPost.publishedAt} className="shrink-0 tabular-nums text-zinc-400" />
              </>
            ) : (
              <span className="text-zinc-400" suppressHydrationWarning>
                {t('zone_card_active_at', { time: relativeTime(zone.lastActivityAt, locale) })}
              </span>
            )}
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}
