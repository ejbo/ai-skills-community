// 版块主页: ZoneHeader + (帖子 tab: PostFilters + PostList | 关于 tab) + right rail.
// A `members` zone the viewer cannot read shows the header plus a locked card
// with the join / apply CTA instead of any content.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ExternalLink, Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { ZoneMarkdown } from '@/components/zones/ZoneMarkdown';
import { auth } from '@/lib/auth';
import { zoneContext } from '@/lib/zones/access';
import { getZoneDetail, listZoneMembers } from '@/lib/zones/queries';
import { listMyDrafts, listZonePosts } from '@/lib/zones/post-queries';
import { ZONE_MODERATOR_ROLE_KEY } from '@/lib/zones/permissions';
import { hostnameOf, isZonePostType, parseZonePostSort, zoneHref } from '@/lib/zones/shared';
import type { ZoneMemberView, ZonePostCardView } from '@/lib/zones/types';
import { JoinButton } from '../_components/JoinButton';
import { PostFilters } from '../_components/PostFilters';
import { PostList } from '../_components/PostList';
import { ZoneHeader } from '../_components/ZoneHeader';
import { ZoneSidebar } from '../_components/ZoneSidebar';
import { CARD_CLS, PILL_INK, PILL_MONO, SECTION_TITLE_CLS, loginHref } from '../_components/ui';

export const dynamic = 'force-dynamic';

interface SearchParams {
  tab?: string | string[];
  type?: string | string[];
  tag?: string | string[];
  q?: string | string[];
  sort?: string | string[];
  column?: string | string[];
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : (v ?? '')).trim();
}

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
  const typeRaw = firstParam(searchParams.type);
  const type = isZonePostType(typeRaw) ? typeRaw : undefined;
  const tag = firstParam(searchParams.tag) || undefined;
  const q = firstParam(searchParams.q) || undefined;
  const column = firstParam(searchParams.column) || undefined;
  const sort = parseZonePostSort(firstParam(searchParams.sort));
  const locked = !access.canRead;

  let posts: { items: ZonePostCardView[]; hasMore: boolean; nextCursor: string | null } = {
    items: [],
    hasMore: false,
    nextCursor: null,
  };
  let drafts: ZonePostCardView[] = [];
  let members: ZoneMemberView[] = [];
  if (!locked) {
    [posts, drafts, members] = await Promise.all([
      tab === 'posts'
        ? listZonePosts({ zone: row, access, viewer, type, tag, q, column, sort, limit: 20 })
        : Promise.resolve(posts),
      // Gated on READ inside listMyDrafts, NOT on `post`: an author who lost the
      // permission must still see and clean up their own drafts (the API agrees).
      listMyDrafts(row.id, viewer, access),
      listZoneMembers(row.id, { status: 'active', take: 12, includeMessage: false, canSeeIdentity: access.canSeeIdentity }).then(
        (r) => r.items,
      ),
    ]);
  }

  const leads = members.filter((m) => m.isOwner || m.roleKey === ZONE_MODERATOR_ROLE_KEY);
  const created = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(zone.createdAt));
  const streamKey = `${type ?? ''}|${tag ?? ''}|${q ?? ''}|${column ?? ''}|${sort}`;

  return (
    <div className="container max-w-6xl py-6">
      <ZoneHeader zone={zone} activeTab={tab === 'about' ? 'about' : 'posts'} />

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
      ) : (
        <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {tab === 'posts' ? (
              <>
                <PostFilters slug={zone.slug} canPost={access.canPost} columns={zone.columns} />
                <div className="mt-4">
                  <PostList
                    key={streamKey}
                    slug={zone.slug}
                    initialItems={posts.items}
                    initialHasMore={posts.hasMore}
                    initialCursor={posts.nextCursor}
                    query={{ type: type ?? null, tag: tag ?? null, column: column ?? null, q: q ?? null, sort }}
                    emptyTitle={q || type || tag || column ? t('post_list_empty_filtered_title') : undefined}
                    emptyDescription={
                      q || type || tag || column
                        ? t('post_list_empty_filtered_desc')
                        : access.canPost
                          ? t('post_list_empty_can_post_desc')
                          : undefined
                    }
                  />
                </div>
              </>
            ) : (
              <div className="space-y-6">
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
                </section>

                {leads.length > 0 && (
                  <section className={`${CARD_CLS} p-5 sm:p-6`}>
                    <h2 className={SECTION_TITLE_CLS}>{t('about_moderators')}</h2>
                    <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                      {leads.map((m) => (
                        <li key={m.id} className="flex items-center gap-3">
                          <Avatar name={m.user.displayName} src={m.user.avatarUrl} size="lg" />
                          <div className="min-w-0 flex-1">
                            <Link href={`/users/${m.user.handle}`} className="block truncate text-sm font-medium hover:underline">
                              {m.user.displayName}
                            </Link>
                            {m.title && <div className="truncate text-xs italic text-zinc-500">{m.title}</div>}
                            <DeptTag department={m.user.department} lab={m.user.lab} />
                          </div>
                          <span className={m.isOwner ? PILL_INK : PILL_MONO}>{m.isOwner ? tl('zoneRole.owner') : m.roleName}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

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
          <div className="hidden xl:block">
            <ZoneSidebar zone={zone} members={members} drafts={drafts} />
          </div>
        </div>
      )}
    </div>
  );
}
