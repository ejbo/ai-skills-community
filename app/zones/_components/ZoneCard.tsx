'use client';

// 技术专区 — hub card. SpotlightCard chrome (pointer-tracked light, no
// re-render), GlareHover on the cover strip only, HairlineGrid fallback when a
// zone has no cover. The whole card is a stretched link; moderator avatars and
// the latest-post line are informational (no nested links but the title).

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, FileText, Lock, Star, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { GlareHover, HairlineGrid, SpotlightCard } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCardView } from '@/lib/zones/types';
import { PILL_INK, PILL_MONO } from './ui';

export function ZoneCard({ zone, variant = 'grid' }: { zone: ZoneCardView; variant?: 'grid' | 'featured' }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const locale = useLocale();
  const href = zoneHref(zone.slug);
  const org = [zone.lab, zone.department].filter(Boolean);

  return (
    <SpotlightCard as="article" className="flex h-full flex-col">
      <div className="relative h-24 shrink-0 overflow-hidden border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
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
          <HairlineGrid size={24} mask="center" />
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
          <div className="relative z-[1] -mt-10 shrink-0 rounded-xl border border-zinc-200 bg-white p-0.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            {zone.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
              <img src={withBasePath(zone.iconUrl)} alt="" className="h-11 w-11 rounded-[10px] object-cover" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-zinc-900 font-mono text-base font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900">
                {zone.name.trim().charAt(0) || 'Z'}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h3 className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              <Link href={href} className="after:absolute after:inset-0 group-hover:underline">
                {zone.name}
              </Link>
            </h3>
            {zone.membership && (
              <span className={`${PILL_MONO} mt-1`}>
                {zone.membership === 'owner'
                  ? tl('zoneRole.owner')
                  : zone.membership === 'active'
                    ? t('zone_card_joined')
                    : t('zone_card_pending')}
              </span>
            )}
          </div>
        </div>

        <p className="mt-2 line-clamp-2 min-h-[2.6em] text-sm text-zinc-600 dark:text-zinc-400">
          {zone.tagline || t('zone_card_no_tagline')}
        </p>

        {org.length > 0 && (
          <p className="mt-2.5 flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Building2 className="mt-[3px] h-3.5 w-3.5 shrink-0" />
            {/* 研究所 · 部门 in full — the org path is the metadata people scan for (ask #3). */}
            <span className="min-w-0 break-words">{org.join(' · ')}</span>
          </p>
        )}

        <div className="mt-auto pt-4">
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
            </span>
            <span className="flex -space-x-1.5">
              {zone.moderators.slice(0, 4).map((m) => (
                <span key={m.handle} className="rounded-full ring-2 ring-white dark:ring-zinc-950" title={m.displayName}>
                  <Avatar name={m.displayName} src={m.avatarUrl} size="xs" handle={m.handle} />
                </span>
              ))}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
            {zone.latestPost ? (
              <>
                <span className={PILL_MONO}>{tl(`zonePostType.${zone.latestPost.type}`)}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{zone.latestPost.title}</span>
                <span className="shrink-0 tabular-nums text-zinc-400">
                  {relativeTime(zone.latestPost.publishedAt, locale)}
                </span>
              </>
            ) : (
              <span className="text-zinc-400">
                {t('zone_card_active_at', { time: relativeTime(zone.lastActivityAt, locale) })}
              </span>
            )}
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}
