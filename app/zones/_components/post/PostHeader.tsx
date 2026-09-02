'use client';

// Post masthead: zone breadcrumb, chip row (栏目 FIRST — the taxonomy — then
// the 公告 pill, visibility, 置顶/锁定/草稿, #tags), h1, summary lead, link
// card, authors with DeptTag + lead-role pills, the publishedAt · 阅读 N 分钟 ·
// views meta row, and the cover (GlareHover + lightbox).
//
// There is no type pill: the content type is hidden everywhere. `announcement`
// is the ONE stored value that still shows, as the moderator's notice (an ink
// pill), not as a format. Lead roles (主版主 / 版主) reach the byline ONLY
// through RolePill + `leadRoleOf`.
//
// Hydration: the byline's `title` is the ISO instant, never
// `toLocaleString()` — that string depends on the process locale and differed
// between the server ("2026-09-01, 3:48:55 p.m.") and the browser
// ("9/1/2026, 3:48:55 PM").

import Link from 'next/link';
import type { RefObject } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Clock, ExternalLink, Eye, FolderOpen, Lock, Megaphone, PencilLine, Pin } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { GlareHover } from '@/components/motion';
import { ImageLightbox } from '@/app/events/_components/ImageLightbox';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import { leadRoleOf, type LeadRoles } from '@/lib/zones/lead-roles';
import { hostnameOf, zoneHref } from '@/lib/zones/shared';
import type { ZonePostDetailView } from '@/lib/zones/types';
import { RolePill } from '../RolePill';
import { PILL_COLUMN, PILL_COLUMN_MEMBER, PILL_INK } from '../ui';
import { VISIBILITY_ICONS } from './VisibilityPicker';

export function PostHeader({
  post,
  zone,
  leadRoles,
  titleRef,
}: {
  post: ZonePostDetailView;
  zone: { slug: string; name: string };
  /** handle → 主版主 / 版主 (built by the RSC page). */
  leadRoles?: LeadRoles;
  /** Handed to the <h1> so PostContextStrip can watch it leave the viewport. */
  titleRef?: RefObject<HTMLHeadingElement>;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const locale = useLocale();
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
        {post.column && (
          <Link
            href={`${zoneHref(zone.slug)}?column=${encodeURIComponent(post.column.slug)}`}
            aria-label={t('post_column_aria', { name: post.column.name })}
            className={post.column.official ? PILL_COLUMN : PILL_COLUMN_MEMBER}
          >
            <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{post.column.name}</span>
          </Link>
        )}
        {post.type === 'announcement' && (
          <span className={PILL_INK}>
            <Megaphone className="h-3 w-3" aria-hidden />
            {t('post_badge_announcement')}
          </span>
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

      {/* Never animated (owner decision): the title is the first thing a reader needs. */}
      <h1 ref={titleRef} className="break-words text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
        {post.title}
      </h1>

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
            {authors.map((a, i) => {
              const role = leadRoleOf(leadRoles, a.handle);
              return (
                <span key={a.handle} className="inline-flex items-center gap-1.5">
                  <Link href={`/users/${a.handle}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                    {a.displayName}
                  </Link>
                  {role && <RolePill role={role} />}
                  <DeptTag department={a.department} lab={a.lab} className="relative z-[1]" />
                  {i < authors.length - 1 && <span aria-hidden>·</span>}
                </span>
              );
            })}
          </span>
        </div>
        <span className="hidden sm:inline" aria-hidden>
          |
        </span>
        <span suppressHydrationWarning title={new Date(when).toISOString()}>
          {relativeTime(when, locale)}
        </span>
        {post.editedAt && (
          // Who edited, not just that it was edited: a 版主 editing someone
          // else's post should be visible rather than silent.
          <span className="inline-flex items-center gap-1" title={new Date(post.editedAt).toISOString()}>
            <PencilLine className="h-3 w-3" />
            {/* suppressHydrationWarning must sit on the TEXT-ONLY node: the
                relative time can tick over between SSR and hydration, and the
                attribute does not cover a sibling icon's text children. */}
            <span suppressHydrationWarning>
              {post.editedBy
                ? t('post_edited_by', {
                    name: post.editedBy.displayName,
                    time: relativeTime(post.editedAt, locale),
                  })
                : t('post_edited_at', { time: relativeTime(post.editedAt, locale) })}
            </span>
          </span>
        )}
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
