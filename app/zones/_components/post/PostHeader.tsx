'use client';

// Post masthead: zone breadcrumb, outlined type pill (+ 置顶/锁定/草稿), h1,
// summary lead, cover (GlareHover + lightbox), authors with DeptTag, and the
// publishedAt · 阅读 N 分钟 · views meta row. `link` posts show the shared URL
// as a prominent external card under the lead.

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Clock, ExternalLink, Eye, FolderOpen, Lock, Pin } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { GlareHover } from '@/components/motion';
import { ImageLightbox } from '@/app/events/_components/ImageLightbox';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import { hostnameOf, zoneHref } from '@/lib/zones/shared';
import type { ZonePostDetailView } from '@/lib/zones/types';
import { POST_TYPE_ICONS } from './PostTypePicker';
import { VISIBILITY_ICONS } from './VisibilityPicker';

export function PostHeader({ post, zone }: { post: ZonePostDetailView; zone: { slug: string; name: string } }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const locale = useLocale();
  const TypeIcon = POST_TYPE_ICONS[post.type];
  const VisibilityIcon = VISIBILITY_ICONS[post.visibility];
  const authors = [post.author, ...post.coauthors];
  const when = post.publishedAt ?? post.createdAt;

  return (
    <header className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label={t('post_breadcrumb_aria')}>
        <Link href="/zones" className="hover:underline">
          {t('post_breadcrumb_zones')}
        </Link>
        <span>/</span>
        <Link href={zoneHref(zone.slug)} className="hover:underline">
          {zone.name}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-zinc-400 px-2 py-px font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200">
          <TypeIcon className="h-3 w-3" />
          {tl(`zonePostType.${post.type}`)}
        </span>
        {post.column && (
          <Link
            href={`${zoneHref(zone.slug)}?column=${encodeURIComponent(post.column.slug)}`}
            aria-label={t('post_column_aria', { name: post.column.name })}
            className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-zinc-300 px-2 py-px font-medium text-zinc-700 transition hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{post.column.name}</span>
          </Link>
        )}
        {post.visibility !== 'zone' && (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-px text-muted dark:border-zinc-700">
            <VisibilityIcon className="h-3 w-3" aria-hidden />
            {tl(`zonePostVisibility.${post.visibility}`)}
          </span>
        )}
        {post.pinned && (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-px text-muted dark:border-zinc-700">
            <Pin className="h-3 w-3" />
            {t('post_badge_pinned')}
          </span>
        )}
        {post.locked && (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-px text-muted dark:border-zinc-700">
            <Lock className="h-3 w-3" />
            {t('post_badge_locked')}
          </span>
        )}
        {post.status === 'draft' && (
          <span className="rounded-full border border-dashed border-zinc-400 px-2 py-px text-muted dark:border-zinc-600">{t('post_badge_draft')}</span>
        )}
        {post.tags.map((tag) => (
          <Link
            key={tag}
            href={`${zoneHref(zone.slug)}?tag=${encodeURIComponent(tag)}`}
            className="rounded-full border border-zinc-200 px-2 py-px text-muted transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
          >
            #{tag}
          </Link>
        ))}
      </div>

      <h1 className="break-words text-3xl font-semibold leading-tight tracking-tight md:text-4xl">{post.title}</h1>

      {post.summary && <p className="text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">{post.summary}</p>}

      {post.linkUrl && (
        <a
          href={post.linkUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
        >
          <ExternalLink className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-muted">{hostnameOf(post.linkUrl)}</span>
            <span className="block truncate font-mono text-xs text-zinc-800 dark:text-zinc-200">{post.linkUrl}</span>
          </span>
        </a>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex -space-x-1.5">
            {authors.slice(0, 5).map((a) => (
              <Avatar key={a.handle} name={a.displayName} src={a.avatarUrl} size="sm" className="ring-2 ring-[rgb(var(--bg))]" handle={a.handle} />
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {authors.map((a, i) => (
              <span key={a.handle} className="inline-flex items-center gap-1.5">
                <Link href={`/users/${a.handle}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                  {a.displayName}
                </Link>
                <DeptTag department={a.department} lab={a.lab} className="relative z-[1]" />
                {i < authors.length - 1 && <span aria-hidden>·</span>}
              </span>
            ))}
          </span>
        </div>
        <span className="hidden sm:inline" aria-hidden>
          |
        </span>
        <span suppressHydrationWarning title={new Date(when).toLocaleString()}>
          {relativeTime(when, locale)}
        </span>
        {post.editedAt && <span>{t('post_edited')}</span>}
        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
          <Clock className="h-3 w-3" />
          {t('post_read_minutes', { count: post.readMinutes })}
        </span>
        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
          <Eye className="h-3 w-3" />
          {t('post_views', { count: post.viewCount })}
        </span>
      </div>

      {post.coverUrl && (
        <ImageLightbox src={post.coverUrl} alt={post.title} className="block w-full">
          <GlareHover className="aspect-[2/1] w-full rounded-2xl bg-zinc-100 dark:bg-zinc-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath(post.coverUrl)} alt={post.title} className="h-full w-full object-cover" />
          </GlareHover>
        </ImageLightbox>
      )}
    </header>
  );
}
