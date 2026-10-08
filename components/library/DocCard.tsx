'use client';

// Grid card — the same information order as DocListRow (eyebrow 来源 · 时长 /
// title / blurb / @上传者 收录 + metrics) on a cover-led tile. Used by the
// browse grid toggle, the shelf and 个人主页. Whole card clickable via the title
// link's overlay; the uploader chip stays its own control above it.

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import type { DocCardData } from '@/lib/library-queries';
import { relativeTime } from '@/lib/i18n-date';
import { pickText } from '@/lib/library/i18n-content';
import { pickDocTitle } from '@/lib/library/translation-shared';
import { Avatar } from '@/components/Avatar';
import { DocCover } from './DocCover';
import { SourceLine } from './SourceLine';
import { rememberListScroll } from './ScrollMemory';

export interface DocCardProps extends Omit<DocCardData, 'createdAt'> {
  createdAt: Date | string;
}

export function DocCard(props: DocCardProps) {
  const t = useTranslations('library_ui');
  const tlib = useTranslations('library');
  const tp = useTranslations('profile');
  const locale = useLocale();
  const created = typeof props.createdAt === 'string' ? new Date(props.createdAt) : props.createdAt;
  const summary = pickText(locale, props.summary, props.summaryEn);
  const title = pickDocTitle(locale, props);
  const progress =
    typeof props.progressPercent === 'number' && props.progressPercent > 0
      ? Math.min(100, Math.max(0, props.progressPercent))
      : null;

  return (
    <article className="card-hover surface group relative flex gap-3 rounded-xl p-4">
      <div className="relative h-24 w-[72px] shrink-0 overflow-hidden rounded-lg">
        <DocCover title={title} coverUrl={props.coverUrl} docType={props.docType} className="h-full w-full" />
        {progress !== null && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
            <span className="block h-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${progress}%` }} />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-x-1.5 text-[11px] text-muted">
          <SourceLine
            sourceUrl={props.sourceUrl}
            siteName={props.siteName}
            author={props.author}
            format={props.format}
            className="min-w-0"
          />
          {props.estReadMinutes > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0">{t('read_minutes', { min: props.estReadMinutes })}</span>
            </>
          )}
          {props.featured && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-900/[0.06] px-1.5 py-px font-medium text-zinc-900 dark:bg-white/10 dark:text-zinc-50">
              <Star className="h-2.5 w-2.5" />
              {t('featured_badge')}
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight">
          <Link
            href={`/library/${props.slug}`}
            onClick={rememberListScroll}
            className="after:absolute after:inset-0 group-hover:text-zinc-900 dark:group-hover:text-white"
          >
            {title}
          </Link>
        </h3>
        {summary && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{summary}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-[11px] text-muted">
          <span className="relative z-10 inline-flex min-w-0 items-center gap-1.5">
            <Avatar
              name={props.uploader.displayName}
              src={props.uploader.avatarUrl}
              size="xs"
              handle={props.uploader.handle}
            />
            <span className="max-w-[120px] truncate">{tlib('added_by', { name: props.uploader.displayName })}</span>
          </span>
          <span aria-hidden>·</span>
          <time dateTime={created.toISOString()} suppressHydrationWarning>
            {relativeTime(created, locale)}
          </time>
          <span className="ml-auto flex shrink-0 items-center gap-x-1.5 font-mono tabular-nums">
            {props.ratingCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {props.avgRating.toFixed(1)}
              </span>
            )}
            <span>{tp('n_shelved', { count: props.shelfCount })}</span>
          </span>
        </div>
      </div>
    </article>
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
