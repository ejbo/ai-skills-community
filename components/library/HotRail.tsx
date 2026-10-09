'use client';

// 热门 rail with four views (owner, 2026-10-09): 最热 (time-decayed engagement,
// lib/library/hot-shared.ts) · 最多评论 (last 7 days) · 最多阅读 (views) · 最多收藏. All four lists arrive
// from the server; switching is a local state flip, no fetch, no URL state.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, MessageSquare } from 'lucide-react';
import type { DocCardData } from '@/lib/library-queries';
import { RailItem } from './RailItem';

export type HotTab = 'hot' | 'commented' | 'read' | 'shelved';

export interface HotLists {
  hot: DocCardData[];
  commented: (DocCardData & { windowComments: number })[];
  read: DocCardData[];
  shelved: DocCardData[];
}

// 最多评论 is counted over the last 7 days (the label does not say so); 最多阅读 = views.
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
              showUploader
              metric={
                tab === 'commented' ? (
                  <span className="inline-flex items-center gap-0.5" title={t('n_comments_window', { count: (doc as HotLists['commented'][number]).windowComments })}>
                    <MessageSquare className="h-3 w-3" />
                    {(doc as HotLists['commented'][number]).windowComments}
                  </span>
                ) : tab === 'shelved' ? (
                  tp('n_shelved', { count: doc.shelfCount })
                ) : (
                  <span className="inline-flex items-center gap-0.5" title={tp('n_views', { count: doc.viewCount })}>
                    <Eye className="h-3 w-3" />
                    {doc.viewCount}
                  </span>
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
