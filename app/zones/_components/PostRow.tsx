'use client';

// 技术专区 — ONE post row, reused by the zone home list, the hub 动态 feed,
// the rail's drafts and the related/recent lists. Contract shape:
// ({ post: ZonePostCardView; compact?; showZone?; leadRoles? }).
// The whole row is a stretched link to zonePostHref; inner links (zone, author
// profile, column, tag filter) sit above the overlay with `relative z-[1]`.
//
// Types are hidden everywhere (owner decision): the leading chip is the 栏目
// (soft-filled in the column's own hue when official, dashed in that hue when
// member-created — see zone-color.ts), never a format pill. A lead's name
// carries the `RolePill` when the surface passes `leadRoles` (zone-scoped lists
// only — the cross-zone feed passes none, a 版主 of one zone is nobody in
// another).
//
// The metadata line is TWO groups, not one long grey run: identity + time wrap
// inside the left group, the engagement figures stay hard right, so a column of
// numbers forms down the list and the eye can scan either edge.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Clock, Eye, FileText, FolderOpen, Heart, Image as ImageIcon, Lock, MessageCircle, Paperclip, Pin, Video } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { GlareHover } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { leadRoleOf, type LeadRoles } from '@/lib/zones/lead-roles';
import { zoneHref, zonePostHref } from '@/lib/zones/shared';
import type { ZoneAttachmentKindView, ZonePostCardView } from '@/lib/zones/types';
import { RelTime } from './RelTime';
import { RolePill } from './RolePill';
import { VISIBILITY_ICONS } from './post/VisibilityPicker';
import { PILL_INK, PILL_MONO } from './ui';
import { columnPillCls, tagTextCls, zoneHue } from './zone-color';

// An attachment's KIND is content, not chrome — the same reason GitHub 热榜
// keeps its per-language dot. Three quiet hues at 12px, enough to tell "there
// are slides on this one" from "there is a video" without reading a word.
const KIND_ICONS: Record<ZoneAttachmentKindView, { Icon: typeof FileText; cls: string }> = {
  image: { Icon: ImageIcon, cls: 'text-emerald-500/80 dark:text-emerald-400/80' },
  video: { Icon: Video, cls: 'text-violet-500/80 dark:text-violet-400/80' },
  file: { Icon: FileText, cls: 'text-sky-500/80 dark:text-sky-400/80' },
};
const MAX_KIND_GLYPHS = 3;

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums" title={label} aria-label={`${label} ${value}`}>
      {icon}
      {value}
    </span>
  );
}

/**
 * 20 px zone icon — the feed's "which board" cue. With no artwork it falls back
 * to a monogram on the zone's OWN identity hue (zone-color.ts), not a black
 * square: a feed mixing five 版块 used to show five identical ink chips.
 */
function ZoneIcon({ zone }: { zone: ZonePostCardView['zone'] }) {
  if (zone.iconUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
    return <img src={withBasePath(zone.iconUrl)} alt="" loading="lazy" className="h-5 w-5 shrink-0 rounded-md object-cover" />;
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold uppercase text-white"
      style={{ backgroundColor: zoneHue(zone.name) }}
    >
      {zone.name.trim().charAt(0) || 'Z'}
    </span>
  );
}

export function PostRow({
  post,
  compact = false,
  showZone = false,
  leadRoles,
}: {
  post: ZonePostCardView;
  compact?: boolean;
  showZone?: boolean;
  /** handle → 主版主/版主 of THIS zone; omitted on cross-zone surfaces. */
  leadRoles?: LeadRoles;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const VisibilityIcon = VISIBILITY_ICONS[post.visibility];
  const href =
    post.status === 'draft' ? `${zonePostHref(post.zone.slug, post.id)}/edit` : zonePostHref(post.zone.slug, post.id);
  const authors = [post.author, ...post.coauthors];
  const shownAuthors = authors.slice(0, compact ? 1 : 3);
  const moreAuthors = authors.length - shownAuthors.length;
  const when = post.publishedAt ?? post.updatedAt;
  const thumb = compact ? 'h-11 w-16' : 'h-16 w-24';
  const kindGlyphs = [...new Set(post.attachmentKinds)].slice(0, MAX_KIND_GLYPHS);

  return (
    <article
      className={`group relative -mx-3 flex gap-4 rounded-xl border-b border-zinc-200 px-3 transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60 ${
        compact ? 'py-3' : 'py-4'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {post.column && (
            <Link
              href={`${zoneHref(post.zone.slug)}?column=${encodeURIComponent(post.column.slug)}`}
              aria-label={t('post_column_aria', { name: post.column.name })}
              className={`${columnPillCls(post.column.name, post.column.official)} relative z-[1]`}
            >
              <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{post.column.name}</span>
            </Link>
          )}
          {post.visibility !== 'zone' && (
            <span className={PILL_MONO} title={tl(`zonePostVisibility.${post.visibility}`)}>
              <VisibilityIcon className="h-3 w-3" aria-hidden />
              {tl(`zonePostVisibility.${post.visibility}`)}
            </span>
          )}
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
              className="relative z-[1] inline-flex max-w-[14rem] items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <ZoneIcon zone={post.zone} />
              <span className="truncate hover:underline">{post.zone.name}</span>
            </Link>
          )}
        </div>

        <h3
          className={`mt-1.5 font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 ${
            compact ? 'line-clamp-1 text-sm' : 'line-clamp-2 text-lg leading-snug'
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
          className={`flex flex-wrap items-start gap-x-4 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400 sm:flex-nowrap ${
            compact ? 'mt-1.5' : 'mt-2.5'
          }`}
        >
          {/* Left group: it is the flex item that shrinks, so everything here
              wraps INSIDE it and the figures below never get pushed off the
              first line. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-1">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="flex -space-x-1.5">
                {shownAuthors.map((a) => (
                  <span key={a.handle} className="rounded-full ring-2 ring-white dark:ring-zinc-950">
                    <Avatar name={a.displayName} src={a.avatarUrl} size="xs" handle={a.handle} />
                  </span>
                ))}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1">
                {shownAuthors.map((a, i) => {
                  const role = leadRoleOf(leadRoles, a.handle);
                  return (
                    <span key={a.handle} className="inline-flex min-w-0 items-center gap-1">
                      {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
                      <Link
                        href={`/users/${a.handle}`}
                        className="relative z-[1] max-w-[8rem] truncate text-zinc-700 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
                      >
                        {a.displayName}
                      </Link>
                      {role && <RolePill role={role} />}
                    </span>
                  );
                })}
                {moreAuthors > 0 && <span>{t('post_row_authors_more', { count: moreAuthors })}</span>}
              </span>
              {!compact && (
                <DeptTag department={post.author.department} lab={post.author.lab} className="relative z-[1]" />
              )}
            </span>
            <RelTime at={when} className="inline-flex items-center gap-1 tabular-nums" />
            {!compact && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t('post_row_read_minutes', { count: post.readMinutes })}
              </span>
            )}
            {!compact && post.tags.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1">
                {post.tags.slice(0, 4).map((tag) => (
                  <Link
                    key={tag}
                    href={`${zoneHref(post.zone.slug)}?tag=${encodeURIComponent(tag)}`}
                    className={`relative z-[1] font-mono text-[11px] transition hover:underline hover:opacity-80 ${tagTextCls(tag)}`}
                  >
                    #{tag}
                  </Link>
                ))}
              </span>
            )}
          </div>

          {/* Right anchor — the figures, always on the first line at ≥sm. */}
          <span className="inline-flex shrink-0 items-center gap-3 sm:ml-auto">
            <Stat icon={<Heart className="h-3 w-3" />} value={post.likeCount} label={t('post_row_likes')} />
            <Stat icon={<MessageCircle className="h-3 w-3" />} value={post.commentCount} label={t('post_row_comments')} />
            {!compact && <Stat icon={<Eye className="h-3 w-3" />} value={post.viewCount} label={t('post_row_views')} />}
            {post.attachmentCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Stat icon={<Paperclip className="h-3 w-3" />} value={post.attachmentCount} label={t('post_row_attachments')} />
                {kindGlyphs.length > 0 && (
                  <span className="inline-flex items-center gap-0.5" aria-hidden>
                    {kindGlyphs.map((k) => {
                      const { Icon, cls } = KIND_ICONS[k];
                      return <Icon key={k} className={`h-3 w-3 ${cls}`} />;
                    })}
                  </span>
                )}
              </span>
            )}
          </span>
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
