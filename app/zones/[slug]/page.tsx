// 版块主页: compact ZoneHeader + (帖子 tab: 栏目 rail | notice · pinned · column
// band · controls · list | fixed-order right rail) or the 关于 tab. A `members`
// zone the viewer cannot read shows the header plus a locked card with the
// join / apply CTA instead of any content.
//
// Data contract (readable zone): ONE Promise.all — page-1 stream, own drafts,
// the 12-member avatar wall, EVERY moderator (dedicated role query — lead
// roles are never derived from the first-12 list), the 7-day pulse, the newest
// `announcement` (unfiltered stream only) and the `rules` wiki page. The
// notice dismissal cookie is parsed here (cookies() — the route is
// force-dynamic) so SSR and client agree on whether the band exists.

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ExternalLink, Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { ZoneMarkdown } from '@/components/zones/ZoneMarkdown';
import { auth } from '@/lib/auth';
import { zoneContext } from '@/lib/zones/access';
import { buildLeadRoles } from '@/lib/zones/lead-roles';
import { NOTICE_COOKIE, parseNoticeCookie } from '@/lib/zones/notice-cookie';
import { getZoneDetail, listZoneMembers, zoneActivityPulse } from '@/lib/zones/queries';
import { listMyDrafts, listZonePosts } from '@/lib/zones/post-queries';
import { ZONE_MODERATOR_ROLE_KEY } from '@/lib/zones/permissions';
import { ZONE_RULES_WIKI_SLUG } from '@/lib/zones/rules';
import { UNCATEGORIZED_COLUMN_PARAM, hostnameOf, parseZonePostSort, zoneHref } from '@/lib/zones/shared';
import type { WikiPageView, ZoneMemberView, ZonePostCardView } from '@/lib/zones/types';
import { getWikiPage } from '@/lib/zones/wiki-queries';
import { ColumnBand } from '../_components/ColumnBand';
import { ColumnRail } from '../_components/ColumnRail';
import { JoinButton } from '../_components/JoinButton';
import { OnboardingChecklist } from '../_components/OnboardingChecklist';
import { PinnedBand } from '../_components/PinnedBand';
import { PostFilters } from '../_components/PostFilters';
import { PostList } from '../_components/PostList';
import { RolePill } from '../_components/RolePill';
import { RulesAccordion } from '../_components/RulesAccordion';
import { ZoneHeader } from '../_components/ZoneHeader';
import { ZoneNotice } from '../_components/ZoneNotice';
import { ZoneSidebar } from '../_components/ZoneSidebar';
import { ZoneStats } from '../_components/ZoneStats';
import { CARD_CLS, PILL_COLUMN, PILL_COLUMN_MEMBER, PILL_MONO, SECTION_TITLE_CLS, hrefWith, loginHref } from '../_components/ui';

export const dynamic = 'force-dynamic';

interface SearchParams {
  tab?: string | string[];
  tag?: string | string[];
  q?: string | string[];
  sort?: string | string[];
  column?: string | string[];
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : (v ?? '')).trim();
}

const PAGE_SIZE = 20;
const MODERATOR_TAKE = 20;
const WALL_TAKE = 12;

type Stream = { items: ZonePostCardView[]; hasMore: boolean; nextCursor: string | null };
const EMPTY_STREAM: Stream = { items: [], hasMore: false, nextCursor: null };

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const [t, session] = await Promise.all([getTranslations('zones'), auth()]);
  const ctx = await zoneContext(params.slug, session);
  return { title: ctx ? `${ctx.zone.name} · ${t('hub_title')}` : t('hub_title') };
}

export default async function ZoneHomePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(zoneHref(params.slug)));
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) notFound();
  const { zone: row, access, viewer } = ctx;
  const [t, tl, locale, zone] = await Promise.all([
    getTranslations('zones'),
    getTranslations('labels'),
    getLocale(),
    getZoneDetail(params.slug, viewer),
  ]);
  if (!zone) notFound();

  const tab = firstParam(searchParams.tab) === 'about' ? 'about' : 'posts';
  // `type` is no longer parsed — a stale `?type=` bookmark simply shows everything.
  const tag = firstParam(searchParams.tag) || undefined;
  const q = firstParam(searchParams.q) || undefined;
  const column = firstParam(searchParams.column) || undefined;
  const sort = parseZonePostSort(firstParam(searchParams.sort));
  const locked = !access.canRead;
  const base = zoneHref(zone.slug);
  const dismissed = parseNoticeCookie(cookies().get(NOTICE_COOKIE)?.value);
  // The bands (notice / pinned) belong to the unfiltered, newest-first stream only.
  const unfiltered = tab === 'posts' && !column && !q && !tag && sort === 'new';

  let posts: Stream = EMPTY_STREAM;
  let drafts: ZonePostCardView[] = [];
  let members: ZoneMemberView[] = [];
  let moderators: { items: ZoneMemberView[]; total: number } = { items: [], total: 0 };
  let pulse = { postsThisWeek: 0, newMembersThisWeek: 0 };
  let announcement: ZonePostCardView | null = null;
  let rulesPage: WikiPageView | null = null;
  if (!locked) {
    [posts, drafts, members, moderators, pulse, announcement, rulesPage] = await Promise.all([
      tab === 'posts'
        ? listZonePosts({ zone: row, access, viewer, tag, q, column, sort, limit: PAGE_SIZE })
        : Promise.resolve(EMPTY_STREAM),
      // Gated on READ inside listMyDrafts, NOT on `post`: an author who lost the
      // permission must still see and clean up their own drafts (the API agrees).
      listMyDrafts(row.id, viewer, access),
      listZoneMembers(row.id, { status: 'active', take: WALL_TAKE, includeMessage: false, canSeeIdentity: access.canSeeIdentity }).then(
        (r) => r.items,
      ),
      listZoneMembers(row.id, {
        status: 'active',
        roleKey: ZONE_MODERATOR_ROLE_KEY,
        take: MODERATOR_TAKE,
        includeMessage: false,
        canSeeIdentity: access.canSeeIdentity,
      }),
      zoneActivityPulse(row.id),
      unfiltered
        ? listZonePosts({ zone: row, access, viewer, type: 'announcement', sort: 'new', limit: 1 }).then((r) => r.items[0] ?? null)
        : Promise.resolve(null),
      getWikiPage(row.id, ZONE_RULES_WIKI_SLUG, { viewer, session, locale }),
    ]);
  }

  const leadRoles = buildLeadRoles(
    zone.owner.handle,
    moderators.items.map((m) => m.user.handle),
  );
  const leadCount = locked ? undefined : 1 + moderators.total;
  const notice = announcement && dismissed.get(zone.id) !== announcement.id ? announcement : null;
  // Pinned posts appear ONCE (the band), and the notice post is not repeated in the list either.
  const pinnedItems = unfiltered ? posts.items.filter((p) => p.pinned && p.id !== notice?.id) : [];
  const banded = new Set<string>([...pinnedItems.map((p) => p.id), ...(notice ? [notice.id] : [])]);
  const listItems = posts.items.filter((p) => !banded.has(p.id));
  const uncategorized = Math.max(0, zone.postCount - zone.columns.reduce((n, c) => n + c.postCount, 0));
  const activeColumn =
    column && column !== UNCATEGORIZED_COLUMN_PARAM
      ? (zone.columns.find((c) => c.slug === column || c.id === column) ?? null)
      : null;
  const showBand = Boolean(column) && (column === UNCATEGORIZED_COLUMN_PARAM || activeColumn !== null);
  const filtered = Boolean(q || tag || column);
  const carry = { sort: sort === 'hot' ? 'hot' : '', q: q ?? '', tag: tag ?? '' };
  // 清除筛选 drops every narrowing (sort is a view, not a filter); the column
  // band's ✕ drops ONLY `?column` — searching inside a column and stepping out of
  // it must keep the search, exactly as the chip row below xl does.
  const clearHref = hrefWith(base, { sort: carry.sort });
  const bandClearHref = hrefWith(base, carry);
  // Page 1 entirely consumed by the notice / pinned bands: the list has nothing
  // left to show, but it is NOT empty — PostList must not offer 「发布第一篇」
  // underneath cards that show the zone's posts.
  const bandedCount = posts.items.length - listItems.length;
  const showOnboarding = access.canManage && zone.postCount === 0 && !column && !q;
  // An empty, column-less zone has nothing for the rail to list — unless a moderator can create columns.
  const railCollapsed = zone.postCount === 0 && zone.columns.length === 0 && !access.canModerate;
  const streamKey = `${tag ?? ''}|${q ?? ''}|${column ?? ''}|${sort}`;
  const created = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(zone.createdAt));
  const leads = [
    ...(members.find((m) => m.isOwner) ? [members.find((m) => m.isOwner) as ZoneMemberView] : []),
    ...moderators.items.filter((m) => !m.isOwner),
  ];

  return (
    <div className="container max-w-7xl py-6">
      <ZoneHeader zone={zone} activeTab={tab} leadCount={leadCount} />

      {locked ? (
        <div className="mx-auto mt-8 max-w-lg">
          <div className={`${CARD_CLS} flex flex-col items-center px-8 py-12 text-center`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800">
              <Lock className="h-5 w-5 text-zinc-500" />
            </span>
            <h2 className="mt-4 text-lg font-semibold tracking-tight">{t('zone_locked_title')}</h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
              {access.membershipStatus === 'pending'
                ? t('zone_locked_pending_desc')
                : zone.joinPolicy === 'invite'
                  ? t('zone_locked_invite_desc')
                  : t('zone_locked_desc')}
            </p>
            <div className="mt-5">
              <JoinButton slug={zone.slug} name={zone.name} access={zone.access} joinPolicy={zone.joinPolicy} />
            </div>
            <Link href="/zones" className="mt-4 text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
              {t('hub_browse_all')}
            </Link>
          </div>
        </div>
      ) : tab === 'posts' ? (
        <div
          className={`mt-5 grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_296px] ${
            railCollapsed ? '' : 'xl:grid-cols-[200px_minmax(0,1fr)_296px]'
          }`}
        >
          {!railCollapsed && (
            <div className="hidden xl:block">
              <ColumnRail
                slug={zone.slug}
                columns={zone.columns}
                postCount={zone.postCount}
                uncategorized={uncategorized}
                drafts={drafts}
                active={column ?? ''}
                carry={carry}
                canModerate={access.canModerate}
              />
            </div>
          )}

          <div className="min-w-0 space-y-5">
            {unfiltered && (
              <ZoneNotice zoneId={zone.id} slug={zone.slug} post={notice} leadRoles={leadRoles} canModerate={access.canModerate} />
            )}
            <PinnedBand items={pinnedItems} leadRoles={leadRoles} />
            {showBand && (
              <ColumnBand
                column={activeColumn}
                uncategorizedCount={uncategorized}
                canModerate={access.canModerate}
                clearHref={bandClearHref}
                settingsHref={`${base}/settings?tab=columns`}
              />
            )}
            <PostFilters slug={zone.slug} canPost={access.canPost} columns={zone.columns} uncategorized={uncategorized} />
            {showOnboarding ? (
              <OnboardingChecklist zone={zone} />
            ) : (
              <PostList
                key={streamKey}
                slug={zone.slug}
                initialItems={listItems}
                initialHasMore={posts.hasMore}
                initialCursor={posts.nextCursor}
                query={{ tag: tag ?? null, column: column ?? null, q: q ?? null, sort }}
                leadRoles={leadRoles}
                canPost={access.canPost}
                filtered={filtered}
                clearHref={clearHref}
                bandedCount={bandedCount}
              />
            )}
          </div>

          <div className="min-w-0">
            {/* With the rail collapsed the sidebar is the ONLY drafts surface — at xl too. */}
            <ZoneSidebar
              zone={zone}
              members={members}
              moderators={moderators.items}
              drafts={drafts}
              draftsOnXl={railCollapsed}
              pulse={pulse}
              rulesPage={rulesPage}
            />
          </div>
        </div>
      ) : (
        <div className="mx-auto mt-6 max-w-3xl space-y-6">
          <section className={`${CARD_CLS} p-5 sm:p-6`}>
            <h2 className={SECTION_TITLE_CLS}>{t('about_description')}</h2>
            <div className="mt-3">
              {zone.descriptionMd.trim() ? (
                <ZoneMarkdown content={zone.descriptionMd} />
              ) : (
                <p className="text-sm text-muted">{t('sidebar_about_empty')}</p>
              )}
            </div>
          </section>

          <RulesAccordion slug={zone.slug} page={rulesPage} canWiki={zone.access.canWiki} allOpen className="p-5 sm:p-6" />

          {leads.length > 0 && (
            <section className={`${CARD_CLS} p-5 sm:p-6`}>
              <h2 className={SECTION_TITLE_CLS}>{t('about_moderators')}</h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {leads.map((m) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="lg" handle={m.user.handle} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/users/${m.user.handle}`} className="block truncate text-sm font-medium hover:underline">
                        {m.user.displayName}
                      </Link>
                      {m.title && <div className="truncate text-xs italic text-zinc-500">{m.title}</div>}
                      <DeptTag department={m.user.department} lab={m.user.lab} />
                    </div>
                    <RolePill role={m.isOwner ? 'owner' : 'moderator'} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={`${CARD_CLS} p-5 sm:p-6`}>
            <h2 className={SECTION_TITLE_CLS}>{t('about_facts')}</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="text-zinc-500">{t('create_lab')}</dt>
              <dd>{zone.lab || <span className="text-zinc-400">—</span>}</dd>
              <dt className="text-zinc-500">{t('create_department')}</dt>
              <dd>{zone.department || <span className="text-zinc-400">—</span>}</dd>
              <dt className="text-zinc-500">{t('zone_visibility_label')}</dt>
              <dd>
                <span className={PILL_MONO}>{tl(`zoneVisibility.${zone.visibility}`)}</span>
              </dd>
              <dt className="text-zinc-500">{t('zone_join_policy_label')}</dt>
              <dd>
                <span className={PILL_MONO}>{tl(`zoneJoinPolicy.${zone.joinPolicy}`)}</span>
              </dd>
              <dt className="text-zinc-500">{t('sidebar_created')}</dt>
              <dd className="tabular-nums">{created}</dd>
            </dl>
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <ZoneStats members={zone.memberCount} posts={zone.postCount} wiki={zone.wikiCount} />
            </div>
          </section>

          <section className={`${CARD_CLS} p-5 sm:p-6`}>
            <h2 className={SECTION_TITLE_CLS}>{t('home_about_columns')}</h2>
            {zone.columns.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t('home_about_columns_empty')}</p>
            ) : (
              <div className="-mx-5 mt-3 overflow-x-auto sm:-mx-6">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                      <th className="px-5 py-2 font-medium sm:px-6">{t('home_about_column_name')}</th>
                      <th className="px-3 py-2 font-medium">{t('home_about_column_desc')}</th>
                      <th className="px-3 py-2 font-medium">{t('home_about_column_kind')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('home_about_column_posts')}</th>
                      <th className="px-5 py-2 font-medium sm:px-6">{t('home_about_column_by')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {zone.columns.map((c) => (
                      <tr key={c.id}>
                        <td className="px-5 py-2.5 sm:px-6">
                          <Link href={`${base}?column=${encodeURIComponent(c.slug)}`} className="font-medium hover:underline">
                            {c.name}
                          </Link>
                        </td>
                        <td className="max-w-[18rem] px-3 py-2.5 text-zinc-600 dark:text-zinc-400">
                          <span className="line-clamp-2">{c.description || '—'}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={c.official ? PILL_COLUMN : PILL_COLUMN_MEMBER}>
                            {c.official ? t('home_about_column_official') : t('home_about_column_member')}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{c.postCount}</td>
                        <td className="px-5 py-2.5 text-zinc-600 dark:text-zinc-400 sm:px-6">{c.createdBy ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {zone.links.length > 0 && (
            <section className={`${CARD_CLS} p-5 sm:p-6`}>
              <h2 className={SECTION_TITLE_CLS}>{t('sidebar_links')}</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {zone.links.map((l) => (
                  <li key={l.url}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      <span className="min-w-0 flex-1 truncate font-medium">{l.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-zinc-400">{hostnameOf(l.url)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
