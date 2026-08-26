'use client';

// 技术专区 — header stat trio (成员 / 帖子 / Wiki). CountUp paints the final
// figure server-side and animates once in view; mono tabular digits.

import { useTranslations } from 'next-intl';
import { CountUp } from '@/components/motion';

export function ZoneStats({ members, posts, wiki }: { members: number; posts: number; wiki: number }) {
  const t = useTranslations('zones');
  const items = [
    { key: 'members', label: t('zone_stat_members'), value: members },
    { key: 'posts', label: t('zone_stat_posts'), value: posts },
    { key: 'wiki', label: t('zone_stat_wiki'), value: wiki },
  ];
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {items.map((it) => (
        <div key={it.key} className="flex items-baseline gap-1.5">
          <dd className="order-first font-mono text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            <CountUp value={it.value} duration={1} />
          </dd>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">{it.label}</dt>
        </div>
      ))}
    </dl>
  );
}
