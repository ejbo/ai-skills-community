// 技术专区 — zone home right rail (server component), FIXED order — Reddit's
// rule that a board's sidebar reads the same everywhere:
//   1. 关于     owner byline · excerpt · 更多 · facts · policy sentence · 加入
//   2. 本周动态  (ZonePulse — omitted when both counts are 0)
//   3. 版规     (RulesAccordion — the `rules` wiki page; 添加版规 for wiki editors)
//   4. 成员     count → /members · avatar wall · 本周新增
//   5. 版主     (ModeratorsCard — last, with 联系版主)
//   6. 外链
//   7. 我的草稿 — below xl (on xl the ColumnRail owns the drafts link), and at
//      EVERY width when the rail is collapsed (`draftsOnXl`): an empty,
//      column-less zone renders no rail for a plain member, and a draft there
//      keeps postCount at 0 — without this card it had no link at ≥1280px.
// No SpotlightCard / TiltCard here: a rail is reference, not a showcase.

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowRight, ExternalLink, FileEdit } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { excerptOf, hostnameOf, zoneHref } from '@/lib/zones/shared';
import type { WikiPageView, ZoneDetailView, ZoneMemberView, ZonePostCardView } from '@/lib/zones/types';
import { JoinButton } from './JoinButton';
import { ModeratorsCard } from './ModeratorsCard';
import { PostRow } from './PostRow';
import { RolePill } from './RolePill';
import { RulesAccordion } from './RulesAccordion';
import { ZonePulse, type ZonePulseData } from './ZonePulse';
import { CARD_CLS, SECTION_TITLE_CLS } from './ui';

const AVATAR_WALL = 8;

export async function ZoneSidebar({
  zone,
  members,
  moderators,
  drafts,
  draftsOnXl = false,
  pulse,
  rulesPage,
}: {
  zone: ZoneDetailView;
  /** Active members, owner first then by role (what listZoneMembers returns) — the avatar wall. */
  members: ZoneMemberView[];
  /** Every active `moderator` (dedicated query, owner excluded). */
  moderators: ZoneMemberView[];
  drafts: ZonePostCardView[];
  /** The 栏目 rail is not rendered (collapsed), so this card must stay visible on xl too. */
  draftsOnXl?: boolean;
  pulse: ZonePulseData;
  rulesPage: WikiPageView | null;
}) {
  const [t, locale] = await Promise.all([getTranslations('zones'), getLocale()]);
  const base = zoneHref(zone.slug);
  const about = excerptOf(zone.descriptionMd, 220);
  const created = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(zone.createdAt));
  const policy = t(`home_policy_${zone.visibility}_${zone.joinPolicy}`);
  const wall = members.slice(0, AVATAR_WALL);

  return (
    <aside className="space-y-5">
      {/* 1. 关于 */}
      <section className={`${CARD_CLS} p-4`}>
        <h2 className={SECTION_TITLE_CLS}>{t('sidebar_about')}</h2>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Avatar name={zone.owner.displayName} src={zone.owner.avatarUrl} size="sm" handle={zone.owner.handle} />
          <Link href={`/users/${zone.owner.handle}`} className="min-w-0 truncate font-medium hover:underline">
            {zone.owner.displayName}
          </Link>
          <RolePill role="owner" />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {about || zone.tagline || t('sidebar_about_empty')}
        </p>
        <Link
          href={`${base}?tab=about`}
          className="group mt-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {t('sidebar_about_more')}
          <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
        {/* 研究所 / 部门 in full — the grid's `minmax(0,1fr)` value column wraps, never truncates. */}
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
          {zone.lab && (
            <>
              <dt className="text-zinc-400">{t('create_lab')}</dt>
              <dd className="min-w-0 break-words text-zinc-700 dark:text-zinc-300">{zone.lab}</dd>
            </>
          )}
          {zone.department && (
            <>
              <dt className="text-zinc-400">{t('create_department')}</dt>
              <dd className="min-w-0 break-words text-zinc-700 dark:text-zinc-300">{zone.department}</dd>
            </>
          )}
          <dt className="text-zinc-400">{t('sidebar_created')}</dt>
          <dd className="tabular-nums text-zinc-600 dark:text-zinc-400">{created}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">{policy}</p>
        {!zone.access.isMember && zone.access.canJoin && (
          <div className="mt-3 [&>button]:w-full">
            <JoinButton slug={zone.slug} name={zone.name} access={zone.access} joinPolicy={zone.joinPolicy} magnetic={false} />
          </div>
        )}
      </section>

      {/* 2. 本周动态 */}
      <ZonePulse pulse={pulse} lastActivityAt={zone.lastActivityAt} />

      {/* 3. 版规 */}
      <RulesAccordion slug={zone.slug} page={rulesPage} canWiki={zone.access.canWiki} />

      {/* 4. 成员 */}
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
        {wall.length > 0 && (
          <Link href={`${base}/members`} className="mt-3 flex -space-x-2" aria-label={t('sidebar_members')}>
            {wall.map((m) => (
              <span key={m.id} className="rounded-full ring-2 ring-white dark:ring-zinc-950" title={m.user.displayName}>
                <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="md" handle={m.user.handle} />
              </span>
            ))}
            {zone.memberCount > AVATAR_WALL && (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 font-mono text-[10px] tabular-nums text-zinc-600 ring-2 ring-white dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-950">
                +{zone.memberCount - AVATAR_WALL}
              </span>
            )}
          </Link>
        )}
        {pulse.newMembersThisWeek > 0 && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t('home_members_new_week', { count: pulse.newMembersThisWeek })}
          </p>
        )}
      </section>

      {/* 5. 版主 */}
      <ModeratorsCard slug={zone.slug} owner={zone.owner} moderators={moderators} memberCount={zone.memberCount} />

      {/* 6. 外链 */}
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

      {/* 7. 我的草稿 — below xl (the 栏目 rail carries the link on xl) unless the rail is collapsed. */}
      {drafts.length > 0 && (
        <section className={`${CARD_CLS} p-4 ${draftsOnXl ? '' : 'xl:hidden'}`}>
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
