// 文档数据 — the plain counters (字数 / 阅读时长 / 浏览 / 收藏 / 评论), as a quiet
// two-column block under the action buttons in the detail page's left column
// (owner, 2026-10-08). Server component: nothing here is interactive — the two
// figures that ARE people live in DocPeople next to the byline.

import { getTranslations } from 'next-intl/server';

export async function DocFigures({
  wordCountLabel,
  readMinutes,
  viewCount,
  shelfCount,
  commentCount,
  className = '',
}: {
  wordCountLabel: string | null;
  readMinutes: number;
  viewCount: number;
  shelfCount: number;
  commentCount: number;
  className?: string;
}) {
  const [t, tp] = await Promise.all([getTranslations('library'), getTranslations('profile')]);
  const rows: [string, string | number][] = [];
  if (wordCountLabel) rows.push([t('stat_words'), wordCountLabel]);
  if (readMinutes > 0) rows.push([t('stat_read_time'), t('read_minutes_value', { count: readMinutes })]);
  rows.push([tp('stat_views'), viewCount], [tp('stat_shelved'), shelfCount], [tp('stat_comments'), commentCount]);

  return (
    <dl className={`surface grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl px-4 py-3 ${className}`}>
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[11px] text-muted">{label}</dt>
          <dd className="mt-0.5 truncate font-mono text-sm tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
