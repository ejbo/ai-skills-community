'use client';

// 技术专区 hub — the 版块 tab (ask #8): every 版块 the viewer may read, grouped
// under its 研究所 with a section header per institute, filtered live by the
// 研究所 → 实验室 rail. Nothing is truncated in a header: the org name is the
// point of this view — so its glyph carries the institute's own identity hue
// (zone-color.ts), which is what tells two long, similarly-worded 研究所
// headers apart on a scroll.
//
// EMPTY 研究所 ARE REAL. The navbar grid shows every configured 研究所, four of
// six of which have no 版块 yet, and every one of those tiles is a link here.
// Landing on the generic 「没有符合当前筛选条件的版块」 would read as a broken
// filter, so when the view is narrowed to exactly ONE 研究所 that is simply
// empty, `emptyInstitute` swaps in a state that NAMES it and lists the 实验室
// it is composed of — the hierarchy answers the question the tile asked.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Building2, Layers } from 'lucide-react';
import type { ZoneCardView } from '@/lib/zones/types';
import { ZoneGrid } from './ZoneGrid';
import { BTN_SECONDARY } from './ui';
import { orgHue } from './zone-color';

export interface ZoneBoardGroup {
  /** 研究所 name ('' = 未标注研究所, rendered last with a neutral header). */
  lab: string;
  zones: ZoneCardView[];
}

/** The one 研究所 this view is narrowed to, when it turns out to hold nothing. */
export interface EmptyInstitute {
  /** 研究所 name, shown verbatim — org values are never translated. */
  name: string;
  /** The 实验室 it is composed of (lib/org.ts). May be empty for a placeholder. */
  labs: string[];
}

export function ZoneBoards({
  groups,
  filtered,
  mine = false,
  emptyInstitute = null,
}: {
  groups: ZoneBoardGroup[];
  filtered: boolean;
  mine?: boolean;
  /** Set only when the filter is exactly one 研究所 and it has no 版块 at all. */
  emptyInstitute?: EmptyInstitute | null;
}) {
  const t = useTranslations('zones');
  const count = groups.reduce((n, g) => n + g.zones.length, 0);

  if (count === 0 && emptyInstitute) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-8 py-16 text-center dark:border-zinc-800">
        <Building2 className="h-6 w-6" style={{ color: orgHue(emptyInstitute.name) }} />
        <h3 className="mt-3 max-w-md break-words text-sm font-semibold">
          {t('hub_institute_empty_title', { name: emptyInstitute.name })}
        </h3>
        <p className="mt-1 max-w-md text-xs leading-5 text-muted">{t('hub_institute_empty_desc')}</p>
        {/* The 实验室 are the answer to 「那这个研究所里有什么」 — stored Chinese
            values, joined but never translated. */}
        <p className="mt-3 max-w-md break-words text-xs text-zinc-500 dark:text-zinc-400">
          {emptyInstitute.labs.length > 0
            ? t('hub_institute_labs', { labs: emptyInstitute.labs.join(' · ') })
            : t('hub_institute_labs_empty')}
        </p>
        <Link href="/zones?tab=boards" className={`${BTN_SECONDARY} mt-4`}>
          {t('hub_browse_all')}
        </Link>
      </div>
    );
  }

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
              <Building2
                className="h-3.5 w-3.5 shrink-0 translate-y-0.5"
                style={group.lab ? { color: orgHue(group.lab) } : undefined}
              />
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
