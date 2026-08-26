'use client';

// 技术专区 hub — the 版块 tab (ask #8): every 版块 the viewer may read, grouped
// under its 研究所 with a section header per lab, filtered live by the
// 研究所 → 部门 rail. Nothing is truncated in a header: the org name is the
// point of this view.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Building2, Layers } from 'lucide-react';
import type { ZoneCardView } from '@/lib/zones/types';
import { ZoneGrid } from './ZoneGrid';
import { BTN_SECONDARY } from './ui';

export interface ZoneBoardGroup {
  /** '' = 未标注研究所 (rendered last, with a neutral header). */
  lab: string;
  zones: ZoneCardView[];
}

export function ZoneBoards({
  groups,
  filtered,
  mine = false,
}: {
  groups: ZoneBoardGroup[];
  filtered: boolean;
  mine?: boolean;
}) {
  const t = useTranslations('zones');
  const count = groups.reduce((n, g) => n + g.zones.length, 0);

  if (count === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-8 py-16 text-center dark:border-zinc-800">
        <Layers className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
        <h3 className="mt-3 text-sm font-semibold">
          {mine ? t('hub_mine_empty_title') : filtered ? t('post_list_empty_filtered_title') : t('hub_empty_title')}
        </h3>
        <p className="mt-1 max-w-sm text-xs text-muted">
          {mine ? t('hub_mine_empty_desc') : filtered ? t('hub_empty_filtered_desc') : t('hub_empty_desc')}
        </p>
        {mine && (
          <Link href="/zones?tab=boards" className={`${BTN_SECONDARY} mt-4`}>
            {t('hub_browse_all')}
          </Link>
        )}
      </div>
    );
  }

  const showHeaders = groups.length > 1 || Boolean(groups[0]?.lab);

  return (
    <div className="flex flex-col gap-10">
      {groups.map((group) => (
        <section key={group.lab || '__none__'}>
          {showHeaders && (
            <div className="mb-4 flex items-baseline gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
              <Building2 className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-zinc-400" />
              <h2 className="min-w-0 break-words text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
                {group.lab || t('hub_org_unassigned')}
              </h2>
              <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {group.zones.length}
              </span>
            </div>
          )}
          <ZoneGrid zones={group.zones} />
        </section>
      ))}
    </div>
  );
}
