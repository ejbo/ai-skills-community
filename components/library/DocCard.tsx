'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import type { DocCardData } from '@/lib/library-queries';
import { DOC_TYPE_LABELS } from '@/lib/library/types';
import { relativeTime } from '@/lib/i18n-date';
import { pickText } from '@/lib/library/i18n-content';
import { DocCover } from './DocCover';
import { rememberListScroll } from './ScrollMemory';

export interface DocCardProps extends Omit<DocCardData, 'createdAt'> {
  createdAt: Date | string;
}

export function DocCard(props: DocCardProps) {
  const t = useTranslations('library_ui');
  const tl = useTranslations('labels');
  const tp = useTranslations('profile');
  const locale = useLocale();
  const created = typeof props.createdAt === 'string' ? new Date(props.createdAt) : props.createdAt;
  const typeLabel =
    props.docType in DOC_TYPE_LABELS ? tl(`docType.${props.docType}`) : props.docType;
  const source = props.siteName ?? props.author;
  const summary = pickText(locale, props.summary, props.summaryEn);
  const progress =
    typeof props.progressPercent === 'number' && props.progressPercent > 0
      ? Math.min(100, Math.max(0, props.progressPercent))
      : null;

  return (
    <Link
      href={`/library/${props.slug}`}
      onClick={rememberListScroll}
      className="card-hover surface group flex gap-3 rounded-xl p-4"
    >
      <div className="relative h-24 w-[72px] shrink-0 overflow-hidden rounded-lg">
        <DocCover
          title={props.title}
          coverUrl={props.coverUrl}
          docType={props.docType}
          className="h-full w-full"
        />
        {progress !== null && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
            <span className="block h-full bg-accent-500" style={{ width: `${progress}%` }} />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {typeLabel}
          </span>
          {props.featured && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300">
              <Star className="h-3 w-3" />
              {t('featured_badge')}
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold tracking-tight group-hover:text-accent-600">
          {props.title}
        </h3>
        {summary && <p className="line-clamp-2 text-xs text-muted">{summary}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-[11px] text-muted">
          {source && (
            <>
              <span className="max-w-[120px] truncate">{source}</span>
              <span>·</span>
            </>
          )}
          {props.ratingCount > 0 && (
            <>
              <span className="inline-flex items-center gap-0.5 font-mono tabular-nums">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {props.avgRating.toFixed(1)}
              </span>
              <span>·</span>
            </>
          )}
          <span>{t('read_minutes', { min: props.estReadMinutes })}</span>
          <span>·</span>
          <span className="font-mono tabular-nums">{tp('n_shelved', { count: props.shelfCount })}</span>
          {props.commentCount > 0 && (
            <>
              <span>·</span>
              <span className="font-mono tabular-nums">{tp('n_comments', { count: props.commentCount })}</span>
            </>
          )}
          <span>·</span>
          <span>{relativeTime(created, locale)}</span>
        </div>
      </div>
    </Link>
  );
}

export function DocCardSkeleton() {
  return (
    <div className="surface flex gap-3 rounded-xl p-4">
      <div className="shimmer h-24 w-[72px] shrink-0 rounded-lg" />
      <div className="flex-1 space-y-2 py-0.5">
        <div className="shimmer h-3 w-14 rounded-full" />
        <div className="shimmer h-4 w-3/4 rounded" />
        <div className="shimmer h-3 w-full rounded" />
        <div className="shimmer h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}
