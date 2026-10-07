'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Eye, MessageSquare, MessagesSquare } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { relativeTime } from '@/lib/i18n-date';
import { TopicUpvoteButton } from './TopicUpvoteButton';
import { CategoryChip, LockedBadge, PinnedBadge } from './badges';
import type { TopicCardView } from './types';
import { topicHref } from '@/lib/slug-href';

/**
 * A forum topic as it appears in the 全部 stream, between feed posts.
 *
 * It borrows the PostCard's author row so the two card kinds share one rhythm,
 * and then says plainly that this one is a DISCUSSION: an ink 讨论 label, a
 * real title, the excerpt, and a footer that invites you in (回复 / 浏览 / who
 * is already talking / 参与讨论) instead of 点赞·评论·分享. The label is ink,
 * not a colour — the 配色契约 keeps colour for the material (the category
 * chips, the avatars).
 */
export function TopicCard({ topic }: { topic: TopicCardView }) {
  const t = useTranslations('discussion');
  const locale = useLocale();
  const href = topicHref(topic);
  const views = topic.viewCount < 1000 ? String(topic.viewCount) : `${(topic.viewCount / 1000).toFixed(1)}k`;

  return (
    <article className="surface rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <Link href={`/users/${topic.author.handle}`} className="shrink-0">
          <Avatar name={topic.author.displayName} src={topic.author.avatarUrl} size="md" handle={topic.author.handle} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/users/${topic.author.handle}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              {topic.author.displayName}
            </Link>
            <DeptTag department={topic.author.department} lab={topic.author.lab} />
            {topic.pinned && <PinnedBadge />}
            {topic.locked && <LockedBadge />}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <span>{t('started_topic')}</span>
            <span>·</span>
            <span suppressHydrationWarning>{relativeTime(topic.createdAt, locale)}</span>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          <MessagesSquare className="h-3 w-3" aria-hidden />
          {t('topic_label')}
        </span>
      </div>

      <Link href={href} className="group mt-3 block">
        <h3 className="break-words text-[15px] font-semibold leading-6 text-zinc-900 group-hover:underline dark:text-zinc-50">
          {topic.title}
        </h3>
        {topic.excerpt && (
          <p className="mt-1 line-clamp-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{topic.excerpt}</p>
        )}
      </Link>

      {topic.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {topic.tags.map((tag) => (
            <CategoryChip key={tag.slug} tag={tag} />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-100 pt-3 text-xs text-muted dark:border-zinc-800/60">
        <TopicUpvoteButton
          topicId={topic.id}
          initialCount={topic.upvoteCount}
          initialUpvoted={topic.upvotedByMe}
          size="inline"
        />
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          {t('reply_count_short', { count: topic.replyCount })}
        </span>
        <span className="flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" aria-hidden />
          {t('views_compact', { count: views })}
        </span>
        {topic.participants.length > 0 && (
          <span className="hidden items-center -space-x-1.5 sm:flex" aria-label={t('participants')}>
            {topic.participants.map((p) => (
              <Avatar
                key={p.handle}
                name={p.displayName}
                src={p.avatarUrl}
                size="xs"
                className="ring-2 ring-white dark:ring-zinc-900"
                handle={p.handle}
              />
            ))}
          </span>
        )}
        <Link
          href={href}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-medium text-zinc-900 transition hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800"
        >
          {topic.locked ? t('read_topic') : t('join_topic')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}
