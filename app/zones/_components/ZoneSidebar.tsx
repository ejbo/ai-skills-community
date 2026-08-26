// 技术专区 — zone home right rail (server component, xl:): 关于 excerpt, 版主/成员
// avatar stack → /members, 外链, 我的草稿 (canPost), created date + owner.

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowRight, ExternalLink, FileEdit } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { ZONE_MODERATOR_ROLE_KEY } from '@/lib/zones/permissions';
import { excerptOf, hostnameOf, zoneHref } from '@/lib/zones/shared';
import type { ZoneDetailView, ZoneMemberView, ZonePostCardView } from '@/lib/zones/types';
import { PostRow } from './PostRow';
import { CARD_CLS, PILL_INK, PILL_MONO, SECTION_TITLE_CLS } from './ui';

export async function ZoneSidebar({
  zone,
  members,
  drafts,
}: {
  zone: ZoneDetailView;
  /** Active members, owner first then by role (what listZoneMembers returns). */
  members: ZoneMemberView[];
  drafts: ZonePostCardView[];
}) {
  const [t, tl, locale] = await Promise.all([getTranslations('zones'), getTranslations('labels'), getLocale()]);
  const base = zoneHref(zone.slug);
  const about = excerptOf(zone.descriptionMd, 220);
  const leads = members.filter((m) => m.isOwner || m.roleKey === ZONE_MODERATOR_ROLE_KEY).slice(0, 5);
  const created = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(zone.createdAt));

  return (
    <aside className="space-y-5">
      <section className={`${CARD_CLS} p-4`}>
        <h2 className={SECTION_TITLE_CLS}>{t('sidebar_about')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {about || zone.tagline || t('sidebar_about_empty')}
        </p>
        <Link
          href={`${base}?tab=about`}
          className="group mt-3 inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {t('sidebar_about_more')}
          <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
          <dt className="text-zinc-400">{t('sidebar_created')}</dt>
          <dd className="tabular-nums text-zinc-600 dark:text-zinc-400">{created}</dd>
          <dt className="text-zinc-400">{tl('zoneRole.owner')}</dt>
          <dd className="min-w-0">
            <Link href={`/users/${zone.owner.handle}`} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
              <Avatar name={zone.owner.displayName} src={zone.owner.avatarUrl} size="xs" tone="neutral" />
              <span className="truncate">{zone.owner.displayName}</span>
            </Link>
          </dd>
        </dl>
      </section>

      <section className={`${CARD_CLS} p-4`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={SECTION_TITLE_CLS}>{t('sidebar_members')}</h2>
          <Link
            href={`${base}/members`}
            className="group inline-flex items-center gap-1 font-mono text-xs tabular-nums text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {zone.memberCount}
            <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
        {members.length > 0 && (
          <Link href={`${base}/members`} className="mt-3 flex -space-x-2" aria-label={t('sidebar_members')}>
            {members.slice(0, 8).map((m) => (
              <span key={m.id} className="rounded-full ring-2 ring-white dark:ring-zinc-950" title={m.user.displayName}>
                <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="md" tone="neutral" />
              </span>
            ))}
            {zone.memberCount > 8 && (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 font-mono text-[10px] tabular-nums text-zinc-600 ring-2 ring-white dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-950">
                +{zone.memberCount - 8}
              </span>
            )}
          </Link>
        )}
        {leads.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            {leads.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="sm" tone="neutral" />
                <div className="min-w-0 flex-1">
                  <Link href={`/users/${m.user.handle}`} className="block truncate font-medium hover:underline">
                    {m.user.displayName}
                  </Link>
                  <DeptTag department={m.user.department} lab={m.user.lab} />
                </div>
                <span className={m.isOwner ? PILL_INK : PILL_MONO}>{m.isOwner ? tl('zoneRole.owner') : m.roleName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {zone.links.length > 0 && (
        <section className={`${CARD_CLS} p-4`}>
          <h2 className={SECTION_TITLE_CLS}>{t('sidebar_links')}</h2>
          <ul className="mt-2 space-y-1">
            {zone.links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate">{l.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-zinc-400">{hostnameOf(l.url)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {drafts.length > 0 && (
        <section className={`${CARD_CLS} p-4`}>
          <h2 className={`${SECTION_TITLE_CLS} flex items-center gap-1.5`}>
            <FileEdit className="h-3.5 w-3.5" />
            {t('sidebar_drafts')}
            <span className="font-mono tabular-nums">{drafts.length}</span>
          </h2>
          <div className="mt-1">
            {drafts.slice(0, 5).map((d) => (
              <PostRow key={d.id} post={d} compact />
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
