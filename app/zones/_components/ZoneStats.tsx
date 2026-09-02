'use client';

// 技术专区 — stat trio (成员 / 帖子 / Wiki). Static mono tabular digits: the
// figures are first-paint content and never animate (motion table: "counts on
// first paint"). Since the header compacted, this renders only inside 版块信息
// on the 关于 tab — the tabs carry the live counts everywhere else.

import { useTranslations } from 'next-intl';

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
          <dd className="order-first font-mono text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{it.value}</dd>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">{it.label}</dt>
        </div>
      ))}
    </dl>
  );
}
