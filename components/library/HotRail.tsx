'use client';

// 热门 rail with four views (owner, 2026-10-09): 最热 (time-decayed engagement,
// lib/library/hot-shared.ts) · 7 日评论 · 最多阅读 · 最多收藏. All four lists arrive
// from the server; switching is a local state flip, no fetch, no URL state.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocCardData } from '@/lib/library-queries';
import { RailItem } from './RailItem';

export type HotTab = 'hot' | 'commented' | 'read' | 'shelved';

export interface HotLists {
  hot: DocCardData[];
  commented: (DocCardData & { windowComments: number })[];
  read: DocCardData[];
  shelved: DocCardData[];
}

const TABS: HotTab[] = ['hot', 'commented', 'read', 'shelved'];

export function HotRail({ lists }: { lists: HotLists }) {
  const t = useTranslations('library');
  const tp = useTranslations('profile');
  // Default to 最热; a quiet week falls through to the first view that has rows.
  const [tab, setTab] = useState<HotTab>(() => TABS.find((k) => lists[k].length > 0) ?? 'hot');
  const labels: Record<HotTab, string> = {
    hot: t('hot_tab_hot'),
    commented: t('hot_tab_commented'),
    read: t('hot_tab_read'),
    shelved: t('hot_tab_shelved'),
  };
  const rows = lists[tab];

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{t('rail_hot')}</h2>
      </div>
      <div role="tablist" aria-label={t('rail_hot')} className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mx-1 rounded px-1 transition ${
              tab === k
                ? 'font-medium text-zinc-900 underline decoration-zinc-900 underline-offset-4 dark:text-zinc-50 dark:decoration-zinc-100'
                : 'text-muted hover:text-zinc-900 dark:hover:text-zinc-50'
            }`}
          >
            {labels[k]}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted">{t('rail_empty')}</p>
      ) : (
        <ul className="mt-2.5 space-y-1">
          {rows.map((doc, i) => (
            <RailItem
              key={doc.id}
              doc={doc}
              rank={i + 1}
              metric={
                tab === 'commented'
                  ? t('n_comments_window', { count: (doc as HotLists['commented'][number]).windowComments })
                  : tab === 'shelved'
                    ? tp('n_shelved', { count: doc.shelfCount })
                    : t('readers_count', { count: doc.readerCount })
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
