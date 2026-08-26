'use client';

// 技术专区 — zone home tabs (帖子 | Wiki | 成员 | 关于) on the motion TabBar.
// `active` is decided by the RSC on every zone route (帖子/关于, wiki, 成员);
// when omitted it falls back to the pathname / `?tab=about`, so the underline
// still slides across soft navs.

import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TabBar } from '@/components/motion';
import { zoneHref, zoneWikiHref } from '@/lib/zones/shared';

export type ZoneTabKey = 'posts' | 'wiki' | 'members' | 'about';

export function ZoneTabs({
  slug,
  active,
  counts,
  className = '',
}: {
  slug: string;
  active?: ZoneTabKey;
  counts: { posts: number; wiki: number; members: number };
  className?: string;
}) {
  const t = useTranslations('zones');
  const pathname = usePathname();
  const sp = useSearchParams();
  const base = zoneHref(slug);
  const derived: ZoneTabKey =
    active ??
    (pathname.includes(`${base}/wiki`)
      ? 'wiki'
      : pathname.includes(`${base}/members`)
        ? 'members'
        : sp.get('tab') === 'about'
          ? 'about'
          : 'posts');
  const tabs = [
    { key: 'posts', label: t('zone_tab_posts'), href: base, count: counts.posts },
    { key: 'wiki', label: t('zone_tab_wiki'), href: zoneWikiHref(slug), count: counts.wiki },
    { key: 'members', label: t('zone_tab_members'), href: `${base}/members`, count: counts.members },
    { key: 'about', label: t('zone_tab_about'), href: `${base}?tab=about` },
  ];
  return <TabBar tabs={tabs} active={derived} id={`zone-tabs-${slug}`} className={className} />;
}
