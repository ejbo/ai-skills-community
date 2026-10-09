'use client';

// One right-rail row (精选 / 热门 / 继续阅读): a small cover or a rank number, the
// title, one metric line. Client so the tabbed 热门 rail can render it; the
// server rails use it too, so there is one row, not two.

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { DocCardData } from '@/lib/library-queries';
import { pickDocTitle } from '@/lib/library/translation-shared';
import { DocCover } from './DocCover';
import { SourceLine } from './SourceLine';

export function RailItem({
  doc,
  rank,
  percent,
  metric,
}: {
  doc: DocCardData;
  /** Numbered list (热门) instead of a cover. */
  rank?: number;
  /** 继续阅读: progress bar + percent instead of the source line. */
  percent?: number;
  /** Trailing figure on the meta line (「23 人读过」, 「5 评论」 …). */
  metric?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('library');
  const title = pickDocTitle(locale, doc);
  return (
    <li>
      <Link
        href={`/library/${doc.slug}`}
        className="-mx-2 flex gap-3 rounded-lg px-2 py-1.5 transition hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60"
      >
        {rank !== undefined ? (
          <span className="w-5 shrink-0 pt-0.5 font-mono text-sm tabular-nums text-muted">{rank}</span>
        ) : (
          <span className="h-12 w-9 shrink-0 overflow-hidden rounded">
            <DocCover title={title} coverUrl={doc.coverUrl} docType={doc.docType} className="h-full w-full text-sm" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[13px] font-medium leading-snug">{title}</span>
          {percent !== undefined ? (
            <span className="mt-1.5 flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <span className="block h-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${Math.round(percent)}%` }} />
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">{Math.round(percent)}%</span>
            </span>
          ) : (
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <SourceLine sourceUrl={doc.sourceUrl} siteName={doc.siteName} author={doc.author} format={doc.format} className="min-w-0" />
              {metric && (
                <>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 font-mono tabular-nums">{metric}</span>
                </>
              )}
            </span>
          )}
          <span className="sr-only">{t('readers_count', { count: doc.readerCount })}</span>
        </span>
      </Link>
    </li>
  );
}
