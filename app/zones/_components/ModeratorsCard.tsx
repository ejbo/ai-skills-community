// 技术专区 — the 版主 widget, LAST card of the zone home rail (Reddit's rule:
// the people who run the place close the sidebar). Owner row + every moderator
// from the dedicated moderator query (so a zone with >12 members still lists
// each 版主), a link into the members directory and 联系版主 → the owner's
// profile. Identity follows the house contract (Avatar + DeptTag + RolePill).

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, MessageSquare } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import type { PublicAuthor } from '@/lib/user-identity';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneMemberView } from '@/lib/zones/types';
import { RolePill } from './RolePill';
import { BTN_SECONDARY, CARD_CLS, SECTION_TITLE_CLS } from './ui';

export async function ModeratorsCard({
  slug,
  owner,
  moderators,
  memberCount,
}: {
  slug: string;
  owner: PublicAuthor;
  /** Active members holding the `moderator` role (owner excluded by the query). */
  moderators: ZoneMemberView[];
  memberCount: number;
}) {
  const t = await getTranslations('zones');
  const base = zoneHref(slug);
  return (
    <section className={`${CARD_CLS} p-4`}>
      <h2 className={SECTION_TITLE_CLS}>{t('mods_title')}</h2>
      <ul className="mt-3 space-y-3">
        <li className="flex items-center gap-2.5">
          <Avatar name={owner.displayName} src={owner.avatarUrl} size="sm" handle={owner.handle} />
          <div className="min-w-0 flex-1">
            <Link href={`/users/${owner.handle}`} className="block truncate text-sm font-medium hover:underline">
              {owner.displayName}
            </Link>
            <DeptTag department={owner.department} lab={owner.lab} />
          </div>
          <RolePill role="owner" />
        </li>
        {moderators
          .filter((m) => m.user.handle !== owner.handle)
          .map((m) => (
            <li key={m.id} className="flex items-center gap-2.5">
              <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="sm" handle={m.user.handle} />
              <div className="min-w-0 flex-1">
                <Link href={`/users/${m.user.handle}`} className="block truncate text-sm font-medium hover:underline">
                  {m.user.displayName}
                </Link>
                {m.title ? (
                  <div className="truncate text-xs italic text-zinc-500 dark:text-zinc-400">{m.title}</div>
                ) : (
                  <DeptTag department={m.user.department} lab={m.user.lab} />
                )}
              </div>
              <RolePill role="moderator" />
            </li>
          ))}
      </ul>
      <Link
        href={`${base}/members`}
        className="group mt-3 inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {t('mods_view_all', { count: memberCount })}
        <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
      <Link href={`/users/${owner.handle}`} className={`${BTN_SECONDARY} mt-3 w-full`}>
        <MessageSquare className="h-4 w-4" />
        {t('mods_contact')}
      </Link>
    </section>
  );
}
