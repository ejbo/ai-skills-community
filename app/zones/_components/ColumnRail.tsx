'use client';

// 技术专区 — the left 栏目 rail on the zone home (xl only; PostFilters carries a
// chip row below xl). The taxonomy as a vertical TabBar (hairline + hover pill
// — the house primitive, no HoverRail): 全部 · official columns in sortOrder ·
// 未归栏 (when any post has no column) · a collapsed 「成员创建 n」 disclosure
// holding the member columns as a second dashed bar · 我的草稿. The active tab
// is the `?column=` param; sort/q/tag are carried so a click never drops them
// (the chip row below xl edits the live URL and keeps them — same action, same
// result at every width).
// Empty taxonomy: a hint plus 创建栏目 for moderators.
//
// The rail is navigation, so it stays ink — but each 栏目 carries its own hue
// as a dot (zone-color.ts), the way 讨论区's Discourse sidebar dots its
// categories. That dot is the same colour as the chip the 栏目 wears on every
// post row, which is what makes the rail and the list read as one taxonomy.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown, FileEdit, Settings2 } from 'lucide-react';
import { TabBar, type TabItem } from '@/components/motion';
import { UNCATEGORIZED_COLUMN_PARAM, zoneHref, zonePostHref } from '@/lib/zones/shared';
import type { ZoneColumnView, ZonePostCardView } from '@/lib/zones/types';
import { FADE_Y_CLASS, SECTION_TITLE_CLS, hrefWith } from './ui';
import { columnDotCls } from './zone-color';

const ALL_KEY = '__all';

export function ColumnRail({
  slug,
  columns,
  postCount,
  uncategorized,
  drafts,
  active,
  carry,
  canModerate,
  className = '',
}: {
  slug: string;
  columns: ZoneColumnView[];
  postCount: number;
  /** postCount − Σ columns.postCount (never below 0). */
  uncategorized: number;
  /** The viewer's own drafts in this zone — listed under a 我的草稿 disclosure (the rail replaces the right-rail card on xl). */
  drafts: ZonePostCardView[];
  /** The `?column=` param ('' = 全部). */
  active: string;
  carry: { sort?: string | null; q?: string | null; tag?: string | null };
  canModerate: boolean;
  className?: string;
}) {
  const t = useTranslations('zones');
  const base = zoneHref(slug);
  const href = (column: string | null) =>
    hrefWith(base, { column, sort: carry.sort === 'hot' ? 'hot' : '', q: carry.q ?? '', tag: carry.tag ?? '' });

  const official = columns.filter((c) => c.official);
  const member = columns.filter((c) => !c.official);
  const activeKey = active || ALL_KEY;
  const memberActive = member.some((c) => c.slug === active);

  const label = (c: ZoneColumnView, hash = false) => (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={c.name}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${columnDotCls(c.name)}`} aria-hidden />
      <span className="block max-w-[6.25rem] truncate">{hash ? `#${c.name}` : c.name}</span>
    </span>
  );

  const mainTabs: TabItem[] = [
    { key: ALL_KEY, label: t('column_rail_all'), href: href(null), count: postCount },
    ...official.map((c) => ({ key: c.slug, label: label(c), href: href(c.slug), count: c.postCount })),
    ...(columns.length > 0 && uncategorized > 0
      ? [
          {
            key: UNCATEGORIZED_COLUMN_PARAM,
            label: t('column_rail_uncategorized'),
            href: href(UNCATEGORIZED_COLUMN_PARAM),
            count: uncategorized,
          },
        ]
      : []),
  ];
  const memberTabs: TabItem[] = member.map((c) => ({ key: c.slug, label: label(c, true), href: href(c.slug), count: c.postCount }));

  return (
    <nav aria-label={t('column_rail_title')} className={`sticky top-24 ${className}`}>
      <div className="flex items-center justify-between gap-2 pr-1">
        <h2 className={SECTION_TITLE_CLS}>{t('column_rail_title')}</h2>
        {canModerate && (
          <Link
            href={`${base}/settings?tab=columns`}
            aria-label={t('column_rail_manage')}
            title={t('column_rail_manage')}
            className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      <div className={`mt-2 max-h-[calc(100dvh-160px)] overflow-y-auto py-2 scroll-thin ${FADE_Y_CLASS}`}>
        <TabBar orientation="vertical" id="zone-columns" tabs={mainTabs} active={memberActive ? '' : activeKey} />

        {member.length > 0 && (
          <details className="group mt-2" open={memberActive || undefined}>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">{t('column_rail_member', { count: member.length })}</span>
              <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-open:grid-rows-[1fr] motion-reduce:transition-none">
              <div className="min-h-0 overflow-hidden">
                <TabBar
                  orientation="vertical"
                  id="zone-columns-member"
                  tabs={memberTabs}
                  active={memberActive ? activeKey : ''}
                  className="border-dashed"
                />
              </div>
            </div>
          </details>
        )}

        {columns.length === 0 && (
          <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            <p>{t('column_rail_empty')}</p>
            {canModerate && (
              <Link
                href={`${base}/settings?tab=columns`}
                className="mt-1 inline-block font-medium text-zinc-700 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                {t('column_rail_create')}
              </Link>
            )}
          </div>
        )}

        {drafts.length > 0 && (
          <details className="group mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
              <FileEdit className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{t('sidebar_drafts')}</span>
              <span className="font-mono tabular-nums">{drafts.length}</span>
              <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <ul className="mt-1 space-y-0.5">
              {drafts.slice(0, 5).map((d) => (
                <li key={d.id}>
                  <Link
                    href={`${zonePostHref(slug, d.id)}/edit`}
                    className="block truncate rounded-md px-3 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    title={d.title}
                  >
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </nav>
  );
}
