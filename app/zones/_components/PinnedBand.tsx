'use client';

// 技术专区 — 置顶 band: the pinned posts of the unfiltered page-1 stream as a
// 2-col card grid (phone: a horizontal snap scroller, the 精选 pattern). The
// page REMOVES these rows from the list below, so a pinned post appears once.
// No StaggerGrid — a band of two cards has nothing to choreograph.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FolderOpen, Pin } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { GlareHover } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { leadRoleOf, type LeadRoles } from '@/lib/zones/lead-roles';
import { zoneHref, zonePostHref } from '@/lib/zones/shared';
import type { ZonePostCardView } from '@/lib/zones/types';
import { RelTime } from './RelTime';
import { RolePill } from './RolePill';
import { CARD_CLS, PILL_COLUMN, PILL_COLUMN_MEMBER, SECTION_TITLE_CLS } from './ui';

export function PinnedBand({ items, leadRoles }: { items: ZonePostCardView[]; leadRoles?: LeadRoles }) {
  const t = useTranslations('zones');
  if (items.length === 0) return null;

  return (
    <section aria-label={t('pinned_band_title')}>
      <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-1.5`}>
        <Pin className="h-3 w-3" aria-hidden />
        {t('pinned_band_title')}
        <span className="font-mono tabular-nums">{items.length}</span>
      </h2>
      <div className="-mx-6 mt-2 flex snap-x gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
        {items.map((post) => {
          const role = leadRoleOf(leadRoles, post.author.handle);
          const zoneBase = zoneHref(post.zone.slug);
          return (
            <article
              key={post.id}
              className={`${CARD_CLS} card-hover group relative flex w-64 shrink-0 snap-start gap-3 p-3 pr-8 sm:w-auto`}
            >
              {post.coverUrl ? (
                <GlareHover className="h-14 w-14 shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL */}
                  <img src={withBasePath(post.coverUrl)} alt="" loading="lazy" className="h-14 w-14 rounded-lg object-cover" />
                </GlareHover>
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-900">
                  <FolderOpen className="h-5 w-5" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  <Link href={zonePostHref(post.zone.slug, post.id)} className="after:absolute after:inset-0 group-hover:underline">
                    {post.title}
                  </Link>
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {post.column && (
                    <Link
                      href={`${zoneBase}?column=${encodeURIComponent(post.column.slug)}`}
                      className={`${post.column.official ? PILL_COLUMN : PILL_COLUMN_MEMBER} relative z-[1]`}
                    >
                      <span className="truncate">{post.column.name}</span>
                    </Link>
                  )}
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Avatar name={post.author.displayName} src={post.author.avatarUrl} size="xs" handle={post.author.handle} />
                    <Link
                      href={`/users/${post.author.handle}`}
                      className="relative z-[1] max-w-[7rem] truncate text-zinc-700 hover:underline dark:text-zinc-300"
                    >
                      {post.author.displayName}
                    </Link>
                  </span>
                  {role && <RolePill role={role} />}
                  <RelTime at={post.publishedAt ?? post.updatedAt} className="tabular-nums" />
                </div>
              </div>
              <Pin className="absolute right-2.5 top-2.5 h-3 w-3 text-zinc-400" aria-hidden />
            </article>
          );
        })}
      </div>
    </section>
  );
}
