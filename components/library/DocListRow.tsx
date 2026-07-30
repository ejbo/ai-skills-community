'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { MessageSquare, Star } from 'lucide-react';
import type { DocCardData } from '@/lib/library-queries';
import { CATEGORY_NAME_BY_SLUG, DOC_TYPE_LABELS } from '@/lib/library/types';
import { relativeTime } from '@/lib/i18n-date';
import { DocCover } from './DocCover';
import { rememberListScroll } from './ScrollMemory';

export interface DocListRowProps extends Omit<DocCardData, 'createdAt'> {
  createdAt: Date | string;
}

/** 列表视图 row — fuller summary + categories + engagement counts. */
export function DocListRow(props: DocListRowProps) {
  const t = useTranslations('library_ui');
  const tl = useTranslations('labels');
  const tp = useTranslations('profile');
  const locale = useLocale();
  const created = typeof props.createdAt === 'string' ? new Date(props.createdAt) : props.createdAt;
  const typeLabel =
    props.docType in DOC_TYPE_LABELS ? tl(`docType.${props.docType}`) : props.docType;
  const source = props.siteName ?? props.author;

  return (
    <Link
      href={`/library/${props.slug}`}
      onClick={rememberListScroll}
      className="group flex gap-4 px-4 py-4 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
    >
      <div className="h-20 w-[60px] shrink-0 overflow-hidden rounded-lg">
        <DocCover
          title={props.title}
          coverUrl={props.coverUrl}
          docType={props.docType}
          className="h-full w-full"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {typeLabel}
          </span>
          {props.categories.slice(0, 3).map((cat) => (
            <span
              key={cat}
              className="rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300"
            >
              {cat in CATEGORY_NAME_BY_SLUG ? tl(`libCategory.${cat}`) : cat}
            </span>
          ))}
          {props.featured && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300">
              <Star className="h-3 w-3" />
              {t('featured_badge')}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted">
            {relativeTime(created, locale)}
          </span>
        </div>

        <h3 className="mt-1.5 truncate text-[15px] font-semibold tracking-tight group-hover:text-accent-600">
          {props.title}
        </h3>
        {props.summary && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">{props.summary}</p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted">
          {source && (
            <>
              <span className="max-w-[160px] truncate">{source}</span>
              <span>·</span>
            </>
          )}
          {props.ratingCount > 0 && (
            <>
              <span className="inline-flex items-center gap-0.5 font-mono tabular-nums">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {t('rating_with_count', { rating: props.avgRating.toFixed(1), count: props.ratingCount })}
              </span>
              <span>·</span>
            </>
          )}
          <span>{t('read_minutes', { min: props.estReadMinutes })}</span>
          <span>·</span>
          <span className="font-mono tabular-nums">{t('readers_count', { count: props.shelfCount })}</span>
          <span>·</span>
          <span className="font-mono tabular-nums">{tp('n_views', { count: props.viewCount })}</span>
          {props.commentCount > 0 && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5 font-mono tabular-nums">
                <MessageSquare className="h-3 w-3" />
                {props.commentCount}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
