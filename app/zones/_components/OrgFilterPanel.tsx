'use client';

// 技术专区 hub — the 研究所 → 部门 filter tree (asks #6 and #8).
//
// Two levels, both MULTI-select. A 研究所 row toggles that lab; its 部门 are
// revealed indented underneath (a chevron peeks at them without selecting, so
// you can look before you commit). Names are rendered in FULL and wrap — the
// org path is the important metadata here, never a truncated pill.
//
// Purely presentational: selection lives in the URL and is written by
// `useHubFilters` (ZoneFilters.tsx), so the very same tree drives the 动态 feed
// and the 版块 grid.

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronRight, Search, X } from 'lucide-react';
import type { OrgLabNode } from '@/lib/zones/shared';
import { INPUT_CLS } from './ui';

export interface OrgFilterPanelProps {
  org: OrgLabNode[];
  selectedLabs: readonly string[];
  selectedDepartments: readonly string[];
  onToggleLab: (lab: string) => void;
  onToggleDepartment: (lab: string, department: string) => void;
  /** Show the in-tree filter box once there are more labs than this. */
  searchThreshold?: number;
  className?: string;
}

function Box({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition ${
        on
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900'
          : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950'
      }`}
    >
      {on && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

function Count({ value }: { value: number }) {
  return <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{value}</span>;
}

export function OrgFilterPanel({
  org,
  selectedLabs,
  selectedDepartments,
  onToggleLab,
  onToggleDepartment,
  searchThreshold = 8,
  className = '',
}: OrgFilterPanelProps) {
  const t = useTranslations('zones');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [needle, setNeedle] = useState('');

  const labSet = useMemo(() => new Set(selectedLabs), [selectedLabs]);
  const deptSet = useMemo(() => new Set(selectedDepartments), [selectedDepartments]);

  const query = needle.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!query) return org.map((lab) => ({ lab, matchedDepartments: false }));
    const out: { lab: OrgLabNode; matchedDepartments: boolean }[] = [];
    for (const lab of org) {
      const labHit = lab.lab.toLowerCase().includes(query);
      const hits = lab.departments.filter((d) => d.department.toLowerCase().includes(query));
      if (labHit) out.push({ lab, matchedDepartments: false });
      else if (hits.length > 0) out.push({ lab: { ...lab, departments: hits }, matchedDepartments: true });
    }
    return out;
  }, [org, query]);

  function toggleExpanded(lab: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lab)) next.delete(lab);
      else next.add(lab);
      return next;
    });
  }

  if (org.length === 0) {
    return <p className={`text-xs text-muted ${className}`}>{t('hub_org_empty')}</p>;
  }

  return (
    <div className={className}>
      {org.length > searchThreshold && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder={t('hub_org_search_placeholder')}
            aria-label={t('hub_org_search_placeholder')}
            className={`${INPUT_CLS} h-8 pl-8 pr-7 text-xs`}
          />
          {needle && (
            <button
              type="button"
              onClick={() => setNeedle('')}
              aria-label={t('filters_clear')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-2 text-xs text-muted">{t('hub_org_no_match')}</p>
      ) : (
        <ul className="-mx-1.5">
          {rows.map(({ lab, matchedDepartments }) => {
            const on = labSet.has(lab.lab);
            const open = on || expanded.has(lab.lab) || matchedDepartments;
            const hasDepartments = lab.departments.length > 0;
            return (
              <li key={lab.lab}>
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleLab(lab.lab)}
                    aria-pressed={on}
                    className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                      on ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <Box on={on} />
                    <span className={`min-w-0 flex-1 break-words leading-5 ${on ? 'font-medium' : ''}`}>{lab.lab}</span>
                    <Count value={lab.zoneCount} />
                  </button>
                  {hasDepartments && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(lab.lab)}
                      aria-expanded={open}
                      aria-label={t('hub_org_toggle_departments', { lab: lab.lab })}
                      className="mt-1 shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                    </button>
                  )}
                </div>

                {open && hasDepartments && (
                  <ul className="ml-[15px] border-l border-zinc-200 pl-2 dark:border-zinc-800">
                    {lab.departments.map((d) => {
                      const dOn = deptSet.has(d.department);
                      return (
                        <li key={d.department}>
                          <button
                            type="button"
                            onClick={() => onToggleDepartment(lab.lab, d.department)}
                            aria-pressed={dOn}
                            className={`flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                              dOn ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-500 dark:text-zinc-400'
                            }`}
                          >
                            <Box on={dOn} />
                            <span className={`min-w-0 flex-1 break-words leading-5 ${dOn ? 'font-medium' : ''}`}>
                              {d.department}
                            </span>
                            <Count value={d.zoneCount} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
