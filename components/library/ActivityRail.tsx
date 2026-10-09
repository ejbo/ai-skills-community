'use client';

// 最新评论与批注 (owner, 2026-10-09). A short list; 展开更多 reveals the rest that the
// server already sent. Clicking a row opens where it LIVES in the side dock
// (PreviewProvider `page` target): the doc page scrolled to that comment, or the
// reader on the highlighted passage with the note. Below lg the dock is the
// modal drawer — same URL, same landing spot.

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MessageSquare, StickyNote } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { usePreview } from '@/components/zones/preview/PreviewProvider';
import { relativeTime } from '@/lib/i18n-date';
import type { ActivityItem } from '@/lib/library/activity-shared';

export function ActivityRail({ items, initial = 5 }: { items: ActivityItem[]; initial?: number }) {
  const t = useTranslations('library');
  const locale = useLocale();
  const preview = usePreview();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, initial);
  const hidden = items.length - initial;

  return (
    <section>
      <h2 className="text-[13px] font-semibold tracking-tight">{t('rail_activity')}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-muted">{t('activity_empty')}</p>
      ) : (
        <ul className="mt-2.5 space-y-0.5">
          {shown.map((a) => (
            <li key={`${a.kind}:${a.id}`}>
              <button
                type="button"
                onClick={() => preview.open({ kind: 'page', ref: a.href, title: a.doc.title, via: 'pointer' })}
                title={t('activity_open_hint')}
                className="-mx-2 flex w-full gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60"
              >
                <Avatar name={a.author.displayName} src={a.author.avatarUrl} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">{a.author.displayName}</span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-zinc-100 px-1 py-px text-[10px] dark:bg-zinc-800">
                      {a.kind === 'comment' ? <MessageSquare className="h-2.5 w-2.5" /> : <StickyNote className="h-2.5 w-2.5" />}
                      {a.kind === 'comment' ? t('activity_comment') : t('activity_note')}
                    </span>
                    <time dateTime={a.createdAt} className="ml-auto shrink-0" suppressHydrationWarning>
                      {relativeTime(a.createdAt, locale)}
                    </time>
                  </span>
                  {a.quote && (
                    <span className="mt-1 line-clamp-1 border-l-2 border-zinc-300 pl-2 text-[11px] italic text-muted dark:border-zinc-600">
                      {a.quote}
                    </span>
                  )}
                  <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug">{a.text}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">{a.doc.title}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[11px] text-muted transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          {expanded ? t('activity_collapse') : t('activity_expand', { count: hidden })}
        </button>
      )}
    </section>
  );
}
