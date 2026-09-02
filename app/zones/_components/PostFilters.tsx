'use client';

// 技术专区 — post list controls on the zone home. ONE controls row:
// [最新 | 最热] · in-zone search · the active #tag chip · 发布 (primary,
// Magnetic) right-aligned. The 栏目 chip row renders BELOW xl only — on xl the
// ColumnRail owns the taxonomy — with official chips first, member chips
// dashed, and 未归栏 (`?column=_none`). Types are gone (owner decision).

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PenLine, Search, X } from 'lucide-react';
import { Magnetic } from '@/components/motion';
import { UNCATEGORIZED_COLUMN_PARAM, ZONE_POST_SORTS, parseZonePostSort, zoneHref } from '@/lib/zones/shared';
import type { ZoneColumnView } from '@/lib/zones/types';
import { BTN_PRIMARY, INPUT_CLS, chipCls } from './ui';

export function PostFilters({
  slug,
  canPost,
  columns = [],
  uncategorized = 0,
}: {
  slug: string;
  canPost: boolean;
  /** The zone's 栏目 (official first) — the chip row is hidden when there are none. */
  columns?: ZoneColumnView[];
  /** Posts without a column — the 未归栏 chip renders when > 0. */
  uncategorized?: number;
}) {
  const t = useTranslations('zones');
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(sp.get('q') ?? '');
  useEffect(() => setQ(sp.get('q') ?? ''), [sp]);

  const sort = parseZonePostSort(sp.get('sort'));
  const tag = sp.get('tag') ?? '';
  const columnSlug = sp.get('column') ?? '';

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('tab');
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const columnChip = (c: ZoneColumnView) => (
    <button
      key={c.id}
      type="button"
      onClick={() => update({ column: columnSlug === c.slug ? null : c.slug })}
      className={`${chipCls(columnSlug === c.slug)} inline-flex max-w-[14rem] items-center gap-1.5 ${c.official ? '' : 'border-dashed'}`}
      aria-pressed={columnSlug === c.slug}
      title={c.description || c.name}
    >
      <span className="truncate">{c.official ? c.name : `#${c.name}`}</span>
      <span className="font-mono text-[10px] tabular-nums opacity-70">{c.postCount}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {columns.length > 0 && (
        <div
          role="group"
          aria-label={t('filters_column_label')}
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] xl:hidden [&::-webkit-scrollbar]:hidden"
        >
          <button type="button" onClick={() => update({ column: null })} className={chipCls(!columnSlug)} aria-pressed={!columnSlug}>
            {t('filters_column_all')}
          </button>
          {columns.filter((c) => c.official).map(columnChip)}
          {columns.filter((c) => !c.official).map(columnChip)}
          {uncategorized > 0 && (
            <button
              type="button"
              onClick={() => update({ column: columnSlug === UNCATEGORIZED_COLUMN_PARAM ? null : UNCATEGORIZED_COLUMN_PARAM })}
              className={`${chipCls(columnSlug === UNCATEGORIZED_COLUMN_PARAM)} inline-flex items-center gap-1.5`}
              aria-pressed={columnSlug === UNCATEGORIZED_COLUMN_PARAM}
            >
              {t('column_rail_uncategorized')}
              <span className="font-mono text-[10px] tabular-nums opacity-70">{uncategorized}</span>
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5" role="group" aria-label={t('filters_sort')}>
          {ZONE_POST_SORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update({ sort: s === 'new' ? null : s })}
              className={chipCls(sort === s)}
              aria-pressed={sort === s}
            >
              {s === 'new' ? t('filters_post_sort_new') : t('filters_post_sort_hot')}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() || null });
          }}
          className="relative w-full sm:w-56"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('filters_post_search_placeholder')}
            className={`${INPUT_CLS} pl-9 pr-8`}
            aria-label={t('filters_post_search_placeholder')}
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                update({ q: null });
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label={t('filters_clear')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>
        {tag && (
          <button
            type="button"
            onClick={() => update({ tag: null })}
            className={`${chipCls(true)} inline-flex items-center gap-1 font-mono normal-case`}
          >
            #{tag}
            <X className="h-3 w-3" />
          </button>
        )}
        {canPost && (
          <div className="ml-auto">
            <Magnetic>
              <Link href={`${zoneHref(slug)}/posts/new`} className={BTN_PRIMARY}>
                <PenLine className="h-4 w-4" />
                {t('zone_publish')}
              </Link>
            </Magnetic>
          </div>
        )}
      </div>
    </div>
  );
}
