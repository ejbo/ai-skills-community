'use client';

// One row of the browse list — the dominant unit of /library (owner, 2026-10-08:
// 首页杂乱，要看出来源和谁上传的). Reads like a Lobsters / Feedly item:
//   eyebrow  来源 (公众号 · 账号 | host | PDF) · 阅读时长            精选 · 时间
//   title
//   AI blurb (two lines)
//   footer   @上传者 收录 · 主题 chips                      ★4.6 (12) · 8 收藏 · 2 评论
// The whole row is one click target through the title link's ::after overlay;
// the uploader chip and topic chips sit above it (`relative z-10`) so they stay
// their own links — never an <a> inside an <a>.

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { MessageSquare, Star } from 'lucide-react';
import type { DocCardData } from '@/lib/library-queries';
import { CATEGORY_NAME_BY_SLUG } from '@/lib/library/types';
import { relativeTime } from '@/lib/i18n-date';
import { pickText } from '@/lib/library/i18n-content';
import { pickDocTitle } from '@/lib/library/translation-shared';
import { Avatar } from '@/components/Avatar';
import { DocCover } from './DocCover';
import { SourceLine } from './SourceLine';
import { rememberListScroll } from './ScrollMemory';

export interface DocListRowProps extends Omit<DocCardData, 'createdAt'> {
  createdAt: Date | string;
  /** Member-created topics have no message key — the page passes their names. */
  categoryNames?: Record<string, string>;
}

export function DocListRow(props: DocListRowProps) {
  const t = useTranslations('library_ui');
  const tlib = useTranslations('library');
  const tl = useTranslations('labels');
  const tp = useTranslations('profile');
  const locale = useLocale();
  const created = typeof props.createdAt === 'string' ? new Date(props.createdAt) : props.createdAt;
  const summary = pickText(locale, props.summary, props.summaryEn);
  const title = pickDocTitle(locale, props);
  const topicLabel = (cat: string) =>
    cat in CATEGORY_NAME_BY_SLUG ? tl(`libCategory.${cat}`) : (props.categoryNames?.[cat] ?? cat);

  return (
    <article className="group relative flex gap-4 px-4 py-4 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
      <div className="h-[76px] w-[56px] shrink-0 overflow-hidden rounded-lg">
        <DocCover title={title} coverUrl={props.coverUrl} docType={props.docType} className="h-full w-full" />
      </div>

      <div className="min-w-0 flex-1">
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
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {props.featured && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-zinc-900/[0.06] px-1.5 py-px font-medium text-zinc-900 dark:bg-white/10 dark:text-zinc-50">
                <Star className="h-2.5 w-2.5" />
                {t('featured_badge')}
              </span>
            )}
            <time dateTime={created.toISOString()} suppressHydrationWarning>
              {relativeTime(created, locale)}
            </time>
          </span>
        </div>

        <h3 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">
          <Link
            href={`/library/${props.slug}`}
            onClick={rememberListScroll}
            className="after:absolute after:inset-0 group-hover:text-zinc-900 dark:group-hover:text-white"
          >
            {title}
          </Link>
        </h3>
        {summary && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">{summary}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          <span className="relative z-10 inline-flex min-w-0 items-center gap-1.5">
            <Avatar
              name={props.uploader.displayName}
              src={props.uploader.avatarUrl}
              size="xs"
              handle={props.uploader.handle}
            />
            <span className="max-w-[160px] truncate">{tlib('added_by', { name: props.uploader.displayName })}</span>
          </span>
          {props.categories.slice(0, 2).map((cat) => (
            <Link
              key={cat}
              href={`/library?cat=${encodeURIComponent(cat)}`}
              className="relative z-10 rounded-full bg-zinc-900/[0.06] px-2 py-0.5 font-medium text-zinc-700 transition hover:bg-zinc-900/10 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/[0.14]"
            >
              {topicLabel(cat)}
            </Link>
          ))}
          <span className="ml-auto flex shrink-0 items-center gap-x-2 font-mono tabular-nums">
            {props.ratingCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {t('rating_with_count', { rating: props.avgRating.toFixed(1), count: props.ratingCount })}
              </span>
            )}
            <span>{tp('n_shelved', { count: props.shelfCount })}</span>
            {props.commentCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <MessageSquare className="h-3 w-3" />
                {props.commentCount}
              </span>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
