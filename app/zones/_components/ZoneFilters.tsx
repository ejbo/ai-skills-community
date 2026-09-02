'use client';

// 技术专区 hub — the shared filter chrome for the feed-first landing.
//
// ALL state lives in the URL (`?tab=&sort=&lab=a,b&department=x,y&column=…&q=`)
// through `serializeMultiParam`, so every view is linkable and the back button
// works. There is no 类型 facet: post types are hidden everywhere (owner
// decision) — the rail is 研究所/部门 + 栏目. One hook (`useHubFilters`) owns the read/write: it mirrors
// the URL into local state so a click flips instantly, then pushes inside a
// transition — `pending` dims the results instead of blocking them.
//
// Exports, all consumed by app/zones/page.tsx:
//   HubSearchBox    — the single search box (posts in 动态, 版块 in 版块)
//   HubFilterRail   — 研究所→部门 tree + 栏目, collapsible on mobile
//   HubActiveChips  — removable chips for everything currently selected
//   HubSortToggle   — 最新 / 最热 (feed) and 最近活跃 / 最新创建 / 成员最多 (版块)

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import {
  ZONE_FEED_SORTS,
  ZONE_SORTS,
  parseMultiParam,
  parseZoneFeedSort,
  parseZoneSort,
  serializeMultiParam,
  type OrgLabNode,
  type ZoneFeedSort,
  type ZoneSort,
} from '@/lib/zones/shared';
import { OrgFilterPanel } from './OrgFilterPanel';
import { INPUT_CLS, SECTION_TITLE_CLS, chipCls } from './ui';

export interface HubFilterState {
  q: string;
  labs: string[];
  departments: string[];
  columns: string[];
}

const EMPTY: HubFilterState = { q: '', labs: [], departments: [], columns: [] };

/** Reads the hub filters out of the URL and writes them back (page reset, scroll kept). */
export function useHubFilters() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const key = sp.toString();

  const urlState = useMemo<HubFilterState>(() => {
    const params = new URLSearchParams(key);
    return {
      q: (params.get('q') ?? '').trim(),
      labs: parseMultiParam(params.get('lab')),
      departments: parseMultiParam(params.get('department')),
      columns: parseMultiParam(params.get('column')),
    };
  }, [key]);

  // Local mirror: a checkbox flips on click, the server catches up in the transition.
  const [state, setState] = useState<HubFilterState>(urlState);
  useEffect(() => setState(urlState), [urlState]);

  const commit = useCallback(
    (patch: Partial<HubFilterState>) => {
      const next: HubFilterState = { ...state, ...patch };
      setState(next);
      const params = new URLSearchParams(key);
      const write = (name: string, value: string) => {
        if (value) params.set(name, value);
        else params.delete(name);
      };
      write('q', next.q.trim());
      write('lab', serializeMultiParam(next.labs));
      write('department', serializeMultiParam(next.departments));
      write('column', serializeMultiParam(next.columns));
      // A stale `?type=` from an old bookmark is dropped on the first write.
      params.delete('type');
      params.delete('page');
      const qs = params.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [state, key, pathname, router],
  );

  const setParam = useCallback(
    (name: string, value: string | null) => {
      const params = new URLSearchParams(key);
      if (value) params.set(name, value);
      else params.delete(name);
      params.delete('page');
      const qs = params.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [key, pathname, router],
  );

  const active = state.labs.length + state.departments.length + state.columns.length + (state.q ? 1 : 0);

  return { state, commit, setParam, pending, active, clearAll: () => commit(EMPTY) };
}

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// ── Search ───────────────────────────────────────────────────────────────────

export function HubSearchBox({ mode, className = '' }: { mode: 'feed' | 'boards'; className?: string }) {
  const t = useTranslations('zones');
  const { state, commit, pending } = useHubFilters();
  const [value, setValue] = useState(state.q);
  useEffect(() => setValue(state.q), [state.q]);
  const placeholder = mode === 'feed' ? t('hub_search_posts_placeholder') : t('filters_search_placeholder');

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        commit({ q: value.trim() });
      }}
      className={`relative ${className}`}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${INPUT_CLS} h-10 pl-9 pr-20`}
      />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('');
              commit({ q: '' });
            }}
            aria-label={t('filters_clear')}
            className="rounded-md p-1 text-zinc-400 transition hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          {t('hub_search_submit')}
        </button>
      </div>
    </form>
  );
}

// ── Rail ─────────────────────────────────────────────────────────────────────

function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-zinc-200 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <h3 className={`${SECTION_TITLE_CLS} mb-2`}>{title}</h3>
      {children}
    </section>
  );
}

export function HubFilterRail({
  org,
  columns,
  mode,
}: {
  org: OrgLabNode[];
  columns: { name: string; postCount: number }[];
  mode: 'feed' | 'boards';
}) {
  const t = useTranslations('zones');
  const { state, commit, clearAll } = useHubFilters();
  const [open, setOpen] = useState(false);
  // Only count what this rail can actually change — 栏目 is feed-only.
  const active = state.labs.length + state.departments.length + (mode === 'feed' ? state.columns.length : 0);

  const departmentsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const lab of org) map.set(lab.lab, lab.departments.map((d) => d.department));
    return map;
  }, [org]);

  function toggleLab(lab: string) {
    const on = state.labs.includes(lab);
    if (!on) {
      commit({ labs: [...state.labs, lab] });
      return;
    }
    // Dropping a 研究所 drops the 部门 that only lived under it.
    const owned = new Set(departmentsOf.get(lab) ?? []);
    const stillReachable = new Set(
      state.labs.filter((l) => l !== lab).flatMap((l) => departmentsOf.get(l) ?? []),
    );
    commit({
      labs: state.labs.filter((l) => l !== lab),
      departments: state.departments.filter((d) => !owned.has(d) || stillReachable.has(d)),
    });
  }

  function toggleDepartment(lab: string, department: string) {
    // Picking a 部门 implies its 研究所 — otherwise the AND would return nothing.
    const labs = state.labs.includes(lab) ? state.labs : [...state.labs, lab];
    commit({ labs, departments: toggle(state.departments, department) });
  }

  const body = (
    <div className="flex flex-col gap-4">
      <RailSection title={t('hub_filter_org')}>
        <OrgFilterPanel
          org={org}
          selectedLabs={state.labs}
          selectedDepartments={state.departments}
          onToggleLab={toggleLab}
          onToggleDepartment={toggleDepartment}
        />
      </RailSection>

      {mode === 'feed' && columns.length > 0 && (
        <RailSection title={t('hub_filter_columns')}>
          <div className="flex flex-wrap gap-1.5">
            {columns.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => commit({ columns: toggle(state.columns, c.name) })}
                aria-pressed={state.columns.includes(c.name)}
                className={chipCls(state.columns.includes(c.name))}
              >
                {c.name}
                <span className="ml-1 font-mono text-[10px] tabular-nums opacity-60">{c.postCount}</span>
              </button>
            ))}
          </div>
        </RailSection>
      )}

      {active > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 self-start rounded-lg px-1.5 py-1 text-xs text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
          {t('hub_clear_all')}
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={chipCls(active > 0)}
        >
          <SlidersHorizontal className="mr-1 inline h-3.5 w-3.5" />
          {t('hub_filters')}
          {active > 0 && <span className="ml-1 font-mono text-[10px] tabular-nums">{active}</span>}
        </button>
        {open && (
          <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            {body}
          </div>
        )}
      </div>
      <div className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 scroll-thin">{body}</div>
      </div>
    </>
  );
}

// ── Active chips ─────────────────────────────────────────────────────────────

export function HubActiveChips({ mode, className = '' }: { mode: 'feed' | 'boards'; className?: string }) {
  const t = useTranslations('zones');
  const { state, commit, clearAll } = useHubFilters();
  // 栏目 only narrows the 动态 feed — never advertise it on the 版块 tab.
  const columnsOn = mode === 'feed' ? state.columns : [];
  const shown = state.labs.length + state.departments.length + columnsOn.length + (state.q ? 1 : 0);
  if (shown === 0) return null;

  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (state.q) chips.push({ key: `q:${state.q}`, label: t('hub_chip_q', { value: state.q }), remove: () => commit({ q: '' }) });
  for (const lab of state.labs) {
    chips.push({
      key: `lab:${lab}`,
      label: t('hub_chip_lab', { value: lab }),
      remove: () => commit({ labs: state.labs.filter((v) => v !== lab) }),
    });
  }
  for (const d of state.departments) {
    chips.push({
      key: `dept:${d}`,
      label: t('hub_chip_department', { value: d }),
      remove: () => commit({ departments: state.departments.filter((v) => v !== d) }),
    });
  }
  for (const c of columnsOn) {
    chips.push({
      key: `col:${c}`,
      label: t('hub_chip_column', { value: c }),
      remove: () => commit({ columns: state.columns.filter((v) => v !== c) }),
    });
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} aria-label={t('hub_active_filters')}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.remove}
          className="group inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <X className="h-3 w-3 shrink-0 text-zinc-400 transition group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
          <span className="sr-only">{t('hub_remove_filter')}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="rounded-lg px-1.5 py-1 text-xs text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {t('hub_clear_all')}
      </button>
    </div>
  );
}

// ── Sort ─────────────────────────────────────────────────────────────────────

export function HubSortToggle({ mode }: { mode: 'feed' | 'boards' }) {
  const t = useTranslations('zones');
  const { setParam } = useHubFilters();
  const sp = useSearchParams();

  if (mode === 'feed') {
    const sort = parseZoneFeedSort(sp.get('sort'));
    const label: Record<ZoneFeedSort, string> = {
      new: t('filters_post_sort_new'),
      hot: t('filters_post_sort_hot'),
    };
    return (
      <div className="flex items-center gap-1.5" role="group" aria-label={t('filters_sort')}>
        {ZONE_FEED_SORTS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setParam('sort', s === 'new' ? null : s)}
            aria-pressed={sort === s}
            className={chipCls(sort === s)}
          >
            {label[s]}
          </button>
        ))}
      </div>
    );
  }

  const sort = parseZoneSort(sp.get('sort'));
  const label: Record<ZoneSort, string> = {
    active: t('filters_sort_active'),
    new: t('filters_sort_new'),
    members: t('filters_sort_members'),
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('filters_sort')}>
      {ZONE_SORTS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setParam('sort', s === 'active' ? null : s)}
          aria-pressed={sort === s}
          className={chipCls(sort === s)}
        >
          {label[s]}
        </button>
      ))}
    </div>
  );
}
