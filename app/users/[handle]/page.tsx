import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Calendar,
  Sparkles,
  Download,
  Heart,
  BookOpen,
  MessageSquare,
  MessagesSquare,
  LibraryBig,
  CalendarDays,
  EyeOff,
  LayoutDashboard,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import {
  PROFILE_VISIBILITY_SELECT,
  profileSectionVisibility,
  getProfileDocs,
  getProfilePosts,
  getProfileTopics,
  getProfileComments,
  getProfileShelf,
  getProfileEvents,
} from '@/lib/profile-queries';
import { relativeTime } from '@/lib/i18n-date';
import { discussionTagLabel } from '@/lib/discussion-tags';
import { DEFAULT_EVENT_TIMEZONE } from '@/lib/events/types';
import { withBasePath } from '@/lib/base-path';
import { SkillCard } from '@/components/SkillCard';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';

export const dynamic = 'force-dynamic';

export default async function UserProfilePage({ params }: { params: { handle: string } }) {
  const session = await auth();
  const locale = await getLocale();
  const t = await getTranslations('profile');
  const tl = await getTranslations('labels');

  // `identity` = may see a 隐私账号's department/lab/handle AND the profile sections the user hid.
  const canSeeIdentity = can(session?.user, 'identity');
  const user = await prisma.user.findUnique({
    where: { handle: params.handle },
    include: {
      _count: {
        select: { skills: true, reviews: true, subscriptions: true },
      },
    },
  });
  if (!user || !user.isActive) notFound();

  const isOwner = session?.user?.id === user.id;
  const canSeeHidden = isOwner || canSeeIdentity;

  // 隐私账号: trim department/lab server-side; the @handle text is hidden below.
  const identity = toPublicAuthor(user, canSeeIdentity);
  const hideHandle = user.isPrivate && !canSeeIdentity;

  // Section gate — hidden sections are not even queried for regular viewers.
  const visible = profileSectionVisibility(user);
  const show = (key: keyof typeof visible) => visible[key] || canSeeHidden;

  const [skills, docs, posts, topics, comments, shelf, events] = await Promise.all([
    show('skills')
      ? prisma.skill.findMany({
          where: {
            authorId: user.id,
            deletedAt: null,
            status: 'published',
            // Private skills never appear on the public profile.
            visibility: { not: 'private' },
          },
          orderBy: { trendingScore: 'desc' },
          take: 24,
          select: {
            id: true,
            slug: true,
            name: true,
            summary: true,
            sourceType: true,
            visibility: true,
            updatedAt: true,
            downloadCount: true,
            likeCount: true,
            reviewCount: true,
            avgRating: true,
            tokenCostEstimate: true,
            author: AUTHOR_IDENTITY_SELECT,
          },
        })
      : [],
    show('docs') ? getProfileDocs(user.id) : [],
    show('posts') ? getProfilePosts(user.id) : [],
    show('posts') ? getProfileTopics(user.id) : [],
    show('comments') ? getProfileComments(user.id) : [],
    show('shelf') ? getProfileShelf(user.id) : [],
    show('events') ? getProfileEvents(user.id) : [],
  ]);

  const totalDownloads = skills.reduce((sum, s) => sum + s.downloadCount, 0);
  const totalLikes = skills.reduce((sum, s) => sum + s.likeCount, 0);

  // Non-owners never see empty sections (nor hidden ones — those weren't fetched).
  const sectionVisible = (key: keyof typeof visible, count: number) =>
    isOwner || (count > 0 && (visible[key] || canSeeIdentity));

  return (
    <div className="container py-8">
      <header className="surface rounded-2xl p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={user.displayName} src={user.avatarUrl} size="xl" handle={user.handle} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{user.displayName}</h1>
            {!hideHandle && <p className="mt-0.5 text-sm text-muted">@{user.handle}</p>}
            <DeptTag department={identity.department} lab={identity.lab} className="mt-1.5" full />
            {user.bio && <p className="mt-3 text-sm">{user.bio}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {t('joined', { time: relativeTime(user.createdAt, locale) })}
              </span>
              {user.isAdmin && (
                <span className="rounded-full bg-zinc-900/[0.06] dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-900 dark:text-zinc-50">
                  Admin
                </span>
              )}
              {canSeeIdentity && user.isPrivate && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  {t('private_badge')}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 text-center">
            <Stat icon={<Sparkles className="h-3.5 w-3.5" />} label="Skills" value={user._count.skills} />
            <Stat icon={<Download className="h-3.5 w-3.5" />} label={t('stat_downloads')} value={totalDownloads} />
            <Stat icon={<Heart className="h-3.5 w-3.5" />} label={t('stat_likes')} value={totalLikes} />
          </div>
        </div>

        {isOwner && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <p className="mr-auto text-xs text-muted">{t('owner_hint')}</p>
            <OwnerLink href="/dashboard" icon={<LayoutDashboard className="h-3.5 w-3.5" />}>
              {t('owner_dashboard')}
            </OwnerLink>
            <OwnerLink href="/settings/privacy" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
              {t('owner_privacy')}
            </OwnerLink>
            <OwnerLink href="/settings" icon={<Settings className="h-3.5 w-3.5" />}>
              {t('owner_settings')}
            </OwnerLink>
          </div>
        )}
      </header>

      {sectionVisible('skills', skills.length) && (
        <Section
          title={t('section_skills')}
          count={skills.length}
          hidden={!visible.skills}
          hiddenLabel={t('hidden_badge')}
        >
          {skills.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{isOwner ? t('empty_skills_own') : t('empty_skills')}</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {skills.map((s) => (
                <SkillCard
                  key={s.id}
                  slug={s.slug}
                  name={s.name}
                  summary={s.summary}
                  sourceType={s.sourceType}
                  visibility={s.visibility}
                  author={toPublicAuthor(s.author, canSeeIdentity)}
                  updatedAt={s.updatedAt}
                  stats={{
                    downloads: s.downloadCount,
                    likes: s.likeCount,
                    rating: s.avgRating,
                    reviewCount: s.reviewCount,
                    tokens: s.tokenCostEstimate,
                  }}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      {sectionVisible('docs', docs.length) && (
        <Section
          title={t('section_docs')}
          count={docs.length}
          hidden={!visible.docs}
          hiddenLabel={t('hidden_badge')}
        >
          {docs.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('empty_docs')}</p>
          ) : (
            <div className="surface mt-3 divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <BookOpen className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/library/${d.slug}`}
                      className="block truncate text-sm font-medium hover:text-zinc-900"
                    >
                      {d.title}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
                      <span>{tl(`docType.${d.docType}`)}</span>
                      <span className="font-mono tabular-nums">
                        · {t('n_shelved', { count: d.shelfCount })} · {t('n_views', { count: d.viewCount })} ·{' '}
                        {t('n_comments', { count: d.commentCount })}
                      </span>
                      {d.ratingCount > 0 && (
                        <span className="font-mono tabular-nums">
                          · {t('n_rating', { rating: d.avgRating.toFixed(1), count: d.ratingCount })}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted">
                    {relativeTime(d.createdAt, locale)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Posts and topics share one visibility flag but gate on their own counts —
          otherwise a member with posts but no topics shows an empty topics section. */}
      {sectionVisible('posts', posts.length) && (
        <>
          <Section
            title={t('section_posts')}
            count={posts.length}
            hidden={!visible.posts}
            hiddenLabel={t('hidden_badge')}
          >
            {posts.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t('empty_posts')}</p>
            ) : (
              <div className="surface mt-3 divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
                {posts.map((p) => (
                  <Link
                    key={p.id}
                    href={`/discussion/posts/${p.id}`}
                    className="block px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  >
                    <p className="line-clamp-2 text-sm">{p.excerpt}</p>
                    <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
                      {t('n_likes', { count: p.likeCount })} · {t('n_comments', { count: p.commentCount })} ·{' '}
                      {relativeTime(p.createdAt, locale)}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      {sectionVisible('posts', topics.length) && (
        <>
          <Section
            title={t('section_topics')}
            count={topics.length}
            hidden={!visible.posts}
            hiddenLabel={t('hidden_badge')}
          >
            {topics.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t('empty_topics')}</p>
            ) : (
              <div className="surface mt-3 divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
                {topics.map((topic) => {
                  return (
                    <Link
                      key={topic.id}
                      href={`/discussion/topics/${topic.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    >
                      <MessagesSquare className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{topic.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
                          <span>
                            {topic.tags
                              .map((tag) =>
                                discussionTagLabel(tag, locale, tl as (key: string) => string),
                              )
                              .join(' · ')}
                          </span>
                          <span className="font-mono tabular-nums">
                            · {t('n_replies', { count: topic.replyCount })} ·{' '}
                            {t('n_views', { count: topic.viewCount })}
                          </span>
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted">
                        {relativeTime(topic.createdAt, locale)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      )}

      {sectionVisible('comments', comments.length) && (
        <Section
          title={t('section_comments')}
          count={comments.length}
          hidden={!visible.comments}
          hiddenLabel={t('hidden_badge')}
        >
          {comments.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('empty_comments')}</p>
          ) : (
            <div className="surface mt-3 divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
              {comments.map((c) => (
                <Link
                  key={`${c.kind}:${c.id}`}
                  href={c.href}
                  className="flex items-start gap-3 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                >
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm">{c.excerpt}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {t(`kind_${c.kind}`, { title: c.contextTitle })} · {relativeTime(c.createdAt, locale)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>
      )}

      {sectionVisible('shelf', shelf.length) && (
        <Section
          title={t('section_shelf')}
          count={shelf.length}
          hidden={!visible.shelf}
          hiddenLabel={t('hidden_badge')}
          extra={
            isOwner ? (
              <Link href="/library/shelf" className="ml-auto text-sm text-zinc-900 dark:text-zinc-50 hover:text-zinc-900">
                {t('view_shelf_all')}
              </Link>
            ) : undefined
          }
        >
          {shelf.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('empty_shelf')}</p>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
              {shelf.map((d) => (
                <Link key={d.id} href={`/library/${d.slug}`} className="group block">
                  <div className="aspect-[3/4] overflow-hidden rounded-lg border border-zinc-200/70 bg-zinc-100 shadow-sm transition group-hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                    {d.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={withBasePath(d.coverUrl)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <LibraryBig className="h-6 w-6 text-zinc-400" />
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug group-hover:text-zinc-900">
                    {d.title}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Section>
      )}

      {sectionVisible('events', events.length) && (
        <Section
          title={t('section_events')}
          count={events.length}
          hidden={!visible.events}
          hiddenLabel={t('hidden_badge')}
        >
          {events.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('empty_events')}</p>
          ) : (
            <div className="surface mt-3 divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
              {events.map((e) => (
                <Link
                  key={e.id}
                  href={`/events/${e.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                >
                  <CalendarDays className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {e.cancelledAt && (
                        <span className="mr-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          {t('event_cancelled')}
                        </span>
                      )}
                      {e.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {tl(`eventKind.${e.kind}`)}
                      {e.city ? ` · ${e.city}` : ''} · {formatEventDay(e, locale)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// All-day events are date-only UTC midnight and must be read in UTC; timed events
// store a real UTC instant, so render the day in the ORGANIZER's zone (legacy
// null-zone rows count as the default zone) — formatting those in UTC would slide
// an evening event onto the next day.
function formatEventDay(
  e: { startAt: Date; allDay: boolean; timezone: string | null },
  locale: string,
) {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: e.allDay ? 'UTC' : (e.timezone ?? DEFAULT_EVENT_TIMEZONE),
  }).format(e.startAt);
}

function Section({
  title,
  count,
  hidden,
  hiddenLabel,
  extra,
  children,
}: {
  title: string;
  count: number;
  hidden: boolean;
  hiddenLabel: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span className="text-sm text-muted">{count}</span>
        {hidden && (
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <EyeOff className="h-3 w-3" />
            {hiddenLabel}
          </span>
        )}
        {extra}
      </div>
      {children}
    </section>
  );
}

function OwnerLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
    >
      {icon}
      {children}
    </Link>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-muted">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
