'use client';

// 技术专区 — hub filters: 研究所 / 部门 selects, in-page search and sort chips.
// URL-driven (?lab&department&q&sort); every change drops ?page.

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { ZONE_SORTS, parseZoneSort, type ZoneSort } from '@/lib/zones/shared';
import { INPUT_CLS, SELECT_CLS, chipCls } from './ui';

export function ZoneFilters({ labs, departments }: { labs: string[]; departments: string[] }) {
  const t = useTranslations('zones');
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(sp.get('q') ?? '');
  useEffect(() => setQ(sp.get('q') ?? ''), [sp]);

  const lab = sp.get('lab') ?? '';
  const department = sp.get('department') ?? '';
  const sort = parseZoneSort(sp.get('sort'));

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const sortLabel: Record<ZoneSort, string> = {
    active: t('filters_sort_active'),
    new: t('filters_sort_new'),
    members: t('filters_sort_members'),
  };
  const hasFilter = Boolean(lab || department || sp.get('q'));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() || null });
          }}
          className="relative w-full sm:w-64"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('filters_search_placeholder')}
            className={`${INPUT_CLS} pl-9 pr-8`}
            aria-label={t('filters_search_placeholder')}
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
        <select
          value={lab}
          onChange={(e) => update({ lab: e.target.value || null })}
          className={SELECT_CLS}
          aria-label={t('filters_lab')}
        >
          <option value="">{t('filters_lab_all')}</option>
          {labs.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={department}
          onChange={(e) => update({ department: e.target.value || null })}
          className={SELECT_CLS}
          aria-label={t('filters_department')}
        >
          <option value="">{t('filters_department_all')}</option>
          {departments.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            type="button"
            onClick={() => update({ q: null, lab: null, department: null })}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
            {t('filters_clear')}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('filters_sort')}>
        {ZONE_SORTS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => update({ sort: s === 'active' ? null : s })}
            className={chipCls(sort === s)}
            aria-pressed={sort === s}
          >
            {sortLabel[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
