// 技术专区 — the header band above a filtered list (`?column=<slug>` or
// `?column=_none`), server component: name, description (or 「由 X 创建」 for a
// member column), mono post count, pencil → 版块设置 → 栏目 (moderators), and
// ✕ back to every post. `_none` is the 未归栏 pseudo-column.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Pencil, X } from 'lucide-react';
import type { ZoneColumnView } from '@/lib/zones/types';
import { BTN_ICON, PILL_COLUMN_MEMBER } from './ui';

export async function ColumnBand({
  column,
  uncategorizedCount,
  canModerate,
  clearHref,
  settingsHref,
}: {
  /** null ⇒ 未归栏 (`_none`). */
  column: ZoneColumnView | null;
  uncategorizedCount: number;
  canModerate: boolean;
  /** The same list without `?column` — q / tag / sort are kept (this is not 清除筛选). */
  clearHref: string;
  settingsHref: string;
}) {
  const t = await getTranslations('zones');
  const name = column ? column.name : t('column_rail_uncategorized');
  const count = column ? column.postCount : uncategorizedCount;
  const description = column
    ? column.description || (!column.official && column.createdBy ? t('column_by', { name: column.createdBy }) : '')
    : t('column_rail_uncategorized_desc');

  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{name}</h2>
          <span className="font-mono text-xs tabular-nums text-zinc-500">{t('column_band_posts', { count })}</span>
          {column && !column.official && <span className={PILL_COLUMN_MEMBER}>{t('home_about_column_member')}</span>}
        </div>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canModerate && column && (
          <Link href={settingsHref} aria-label={t('column_band_edit')} title={t('column_band_edit')} className={BTN_ICON}>
            <Pencil className="h-4 w-4" />
          </Link>
        )}
        <Link href={clearHref} aria-label={t('column_band_clear')} title={t('column_band_clear')} className={BTN_ICON}>
          <X className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
