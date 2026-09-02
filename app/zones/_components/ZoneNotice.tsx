// 技术专区 — 版主公告 band (server component). The newest `announcement` post
// of the zone, unless this browser dismissed exactly that post (cookie —
// parsed by the page RSC so SSR and client agree; a NEWER announcement has a
// new id and shows again). Ink left rule = the Discourse "staff" tint with the
// hue removed. With no announcement, a moderator sees a dashed one-line CTA:
// publish, then 设为公告 from the post's ⋯ menu.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, Megaphone } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { leadRoleOf, type LeadRoles } from '@/lib/zones/lead-roles';
import { excerptOf, zoneHref, zonePostHref } from '@/lib/zones/shared';
import type { ZonePostCardView } from '@/lib/zones/types';
import { RelTime } from './RelTime';
import { RolePill } from './RolePill';
import { ZoneNoticeDismiss } from './ZoneNoticeDismiss';
import { CARD_CLS, SECTION_TITLE_CLS } from './ui';

export async function ZoneNotice({
  zoneId,
  slug,
  post,
  leadRoles,
  canModerate,
}: {
  zoneId: string;
  slug: string;
  /** The announcement to show — null when there is none or it was dismissed. */
  post: ZonePostCardView | null;
  leadRoles: LeadRoles;
  canModerate: boolean;
}) {
  const t = await getTranslations('zones');

  if (!post) {
    if (!canModerate) return null;
    return (
      <Link
        href={`${zoneHref(slug)}/posts/new`}
        className="group flex items-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-4 py-2.5 text-xs text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
      >
        <Megaphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{t('notice_cta')}</span>
        <ArrowRight className="h-3 w-3 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    );
  }

  const href = zonePostHref(slug, post.id);
  const role = leadRoleOf(leadRoles, post.author.handle);
  const excerpt = excerptOf(post.summary || '', 180);

  return (
    <section
      aria-label={t('notice_title')}
      className={`${CARD_CLS} relative border-l-2 border-l-zinc-900 p-4 pr-12 dark:border-l-zinc-100`}
    >
      <ZoneNoticeDismiss zoneId={zoneId} postId={post.id} className="absolute right-2 top-2" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span className={`${SECTION_TITLE_CLS} inline-flex items-center gap-1`}>
          <Megaphone className="h-3 w-3" aria-hidden />
          {t('notice_title')}
        </span>
        <span className="text-zinc-300 dark:text-zinc-600">·</span>
        <Avatar name={post.author.displayName} src={post.author.avatarUrl} size="xs" handle={post.author.handle} />
        <Link href={`/users/${post.author.handle}`} className="max-w-[10rem] truncate text-zinc-700 hover:underline dark:text-zinc-300">
          {post.author.displayName}
        </Link>
        {role && <RolePill role={role} />}
        <RelTime at={post.publishedAt ?? post.updatedAt} className="tabular-nums" />
      </div>
      <h3 className="mt-1.5 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        <Link href={href} className="hover:underline">
          {post.title}
        </Link>
      </h3>
      {excerpt && <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{excerpt}</p>}
      <Link
        href={href}
        className="group mt-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        {t('notice_read_more')}
        <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </section>
  );
}
