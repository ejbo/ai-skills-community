'use client';

// 技术专区 — ONE post row, reused by the zone home list, the hub's 最新发布 band,
// the right rail's drafts and U2/U3's related/recent lists. Contract shape:
// ({ post: ZonePostCardView; compact?: boolean; showZone?: boolean }).
// The whole row is a stretched link to zonePostHref; inner links (zone, author
// profile, tag filter) sit above the overlay with `relative z-[1]`.

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Clock, Eye, Heart, Lock, MessageCircle, Paperclip, Pin } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { GlareHover } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import { zoneHref, zonePostHref, type ZonePostTypeValue } from '@/lib/zones/shared';
import type { ZonePostCardView } from '@/lib/zones/types';
import { PILL_INK, PILL_MONO } from './ui';

export function PostTypePill({ type, className = '' }: { type: ZonePostTypeValue; className?: string }) {
  const tl = useTranslations('labels');
  return <span className={`${PILL_MONO} ${className}`}>{tl(`zonePostType.${type}`)}</span>;
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums" title={label} aria-label={`${label} ${value}`}>
      {icon}
      {value}
    </span>
  );
}

export function PostRow({
  post,
  compact = false,
  showZone = false,
}: {
  post: ZonePostCardView;
  compact?: boolean;
  showZone?: boolean;
}) {
  const t = useTranslations('zones');
  const locale = useLocale();
  const href =
    post.status === 'draft' ? `${zonePostHref(post.zone.slug, post.id)}/edit` : zonePostHref(post.zone.slug, post.id);
  const authors = [post.author, ...post.coauthors];
  const shownAuthors = authors.slice(0, compact ? 1 : 3);
  const moreAuthors = authors.length - shownAuthors.length;
  const when = post.publishedAt ?? post.updatedAt;
  const thumb = compact ? 'h-11 w-16' : 'h-16 w-24';

  return (
    <article
      className={`group relative flex gap-4 border-b border-zinc-200 last:border-b-0 dark:border-zinc-800 ${
        compact ? 'py-3' : 'py-4'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <PostTypePill type={post.type} />
          {post.pinned && (
            <span className={PILL_INK}>
              <Pin className="h-3 w-3" />
              {t('post_row_pinned')}
            </span>
          )}
          {post.locked && (
            <span className={PILL_MONO}>
              <Lock className="h-3 w-3" />
              {t('post_row_locked')}
            </span>
          )}
          {post.status === 'draft' && <span className={PILL_MONO}>{t('post_row_draft')}</span>}
          {showZone && (
            <Link
              href={zoneHref(post.zone.slug)}
              className="relative z-[1] max-w-[12rem] truncate text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {post.zone.name}
            </Link>
          )}
        </div>

        <h3
          className={`mt-1.5 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 ${
            compact ? 'line-clamp-1 text-sm' : 'line-clamp-2 text-base'
          }`}
        >
          <Link href={href} className="after:absolute after:inset-0 group-hover:underline">
            {post.title}
          </Link>
        </h3>

        {!compact && post.summary && (
          <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{post.summary}</p>
        )}

        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400 ${
            compact ? 'mt-1.5' : 'mt-2.5'
          }`}
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="flex -space-x-1.5">
              {shownAuthors.map((a) => (
                <span key={a.handle} className="rounded-full ring-2 ring-white dark:ring-zinc-950">
                  <Avatar name={a.displayName} src={a.avatarUrl} size="xs" tone="neutral" />
                </span>
              ))}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1">
              {shownAuthors.map((a, i) => (
                <span key={a.handle} className="inline-flex min-w-0 items-center">
                  {i > 0 && <span className="mr-1 text-zinc-300 dark:text-zinc-600">·</span>}
                  <Link
                    href={`/users/${a.handle}`}
                    className="relative z-[1] max-w-[8rem] truncate text-zinc-700 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
                  >
                    {a.displayName}
                  </Link>
                </span>
              ))}
              {moreAuthors > 0 && <span>{t('post_row_authors_more', { count: moreAuthors })}</span>}
            </span>
            {!compact && (
              <DeptTag department={post.author.department} lab={post.author.lab} className="relative z-[1]" />
            )}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">{relativeTime(when, locale)}</span>
          {!compact && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t('post_row_read_minutes', { count: post.readMinutes })}
            </span>
          )}
          <Stat icon={<Heart className="h-3 w-3" />} value={post.likeCount} label={t('post_row_likes')} />
          <Stat icon={<MessageCircle className="h-3 w-3" />} value={post.commentCount} label={t('post_row_comments')} />
          {!compact && <Stat icon={<Eye className="h-3 w-3" />} value={post.viewCount} label={t('post_row_views')} />}
          {post.attachmentCount > 0 && (
            <Stat icon={<Paperclip className="h-3 w-3" />} value={post.attachmentCount} label={t('post_row_attachments')} />
          )}
          {!compact && post.tags.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1">
              {post.tags.slice(0, 4).map((tag) => (
                <Link
                  key={tag}
                  href={`${zoneHref(post.zone.slug)}?tag=${encodeURIComponent(tag)}`}
                  className="relative z-[1] font-mono text-[11px] text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
                >
                  #{tag}
                </Link>
              ))}
            </span>
          )}
        </div>
      </div>

      {post.coverUrl && (
        <GlareHover className={`${thumb} shrink-0 self-start rounded-lg border border-zinc-200 dark:border-zinc-800`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL */}
          <img
            src={withBasePath(post.coverUrl)}
            alt=""
            loading="lazy"
            className={`${thumb} rounded-lg object-cover transition-transform duration-500 group-hover:scale-[1.03]`}
          />
        </GlareHover>
      )}
    </article>
  );
}
