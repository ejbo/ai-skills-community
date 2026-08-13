import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clapperboard,
  Flame,
  Megaphone,
  MessagesSquare,
  Newspaper,
  Play,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { getLocale } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { DISCOVERABLE_SKILL_WHERE, SKILL_CARD_SELECT } from '@/lib/skill-queries';
import { SkillCard } from '@/components/SkillCard';
import { VideoGrid } from '@/components/video/VideoGrid';
import { ShortsShowcase } from './home/ShortsShowcase';
import { trendingVideos } from '@/lib/video/queries';
import { annotateShortsViewer, featuredShorts, toShortView } from '@/lib/video/shorts-queries';
import { listTopics } from '@/lib/discussion-queries';
import { listEvents } from '@/lib/event-queries';
import { browseDocs } from '@/lib/library-queries';
import { CategoryChip } from '@/app/discussion/_components/badges';
import { EventTimeCard } from '@/app/events/_components/EventTime';
import { DocCover } from '@/components/library/DocCover';
import { getTranslations } from 'next-intl/server';
import { Reveal } from './home/Reveal';
import { SectionHeader } from './home/SectionHeader';
import { HeroBackdrop } from './home/HeroBackdrop';

interface HomeUser {
  id: string;
  displayName: string;
  isAdmin: boolean;
}

/** Community home shown to signed-in users at `/`. */
export async function CommunityHome({ user }: { user: HomeUser }) {
  const t = await getTranslations('home');
  const tl = await getTranslations('labels');
  const ts = await getTranslations('shorts');
  const locale = await getLocale();

  // 今日简报 counts from the server's local midnight.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    skills,
    videos,
    shorts,
    topicsRes,
    eventsRes,
    docsRes,
    announcement,
    newSkillsToday,
    newPostsToday,
    newShortsToday,
  ] = await Promise.all([
    prisma.skill.findMany({
      where: DISCOVERABLE_SKILL_WHERE,
      orderBy: { trendingScore: 'desc' },
      take: 4,
      select: SKILL_CARD_SELECT,
    }),
    trendingVideos(8),
    featuredShorts(10),
    listTopics({ sort: 'top', pageSize: 4 }),
    listEvents({ tab: 'upcoming' }, { id: user.id, isAdmin: user.isAdmin }),
    browseDocs({ sort: 'newest', pageSize: 4 }),
    prisma.announcement.findFirst({
      where: { publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, title: true },
    }),
    prisma.skill.count({
      where: { ...DISCOVERABLE_SKILL_WHERE, createdAt: { gte: todayStart } },
    }),
    prisma.post.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.video.count({
      where: { isShort: true, status: 'published', deletedAt: null, createdAt: { gte: todayStart } },
    }),
  ]);

  // Player payload: viewer like/favorite flags + identity trim, same contract
  // as the 随刷 feed page.
  const shortItems = (await annotateShortsViewer(shorts, user.id)).map((s) =>
    toShortView(s, user.isAdmin),
  );

  // Panels only render title/counts — raw author identities from listTopics
  // never cross into client components, so no toPublicAuthor mapping needed.
  const topics = topicsRes.items;
  const events = eventsRes.items.filter((e) => !e.cancelled).slice(0, 3);
  const docs = docsRes.items;
  const panelCount = [topics.length, events.length, docs.length].filter((n) => n > 0).length;
  const panelCols =
    panelCount >= 3 ? 'lg:grid-cols-3' : panelCount === 2 ? 'lg:grid-cols-2' : '';

  return (
    <div>
      {/* Hero band v3 — LEFT: greeting → 今日简报 → 热门 Skills (2×2);
          RIGHT: 刷视频 player stretching the full band height (welcome top to
          skills bottom). One grid row with default stretch does the height. */}
      <section className="relative overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
        <HeroBackdrop intensity="soft" />
        <div className="container relative py-6 md:py-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr),370px] xl:grid-cols-[minmax(0,1fr),400px]">
            {/* LEFT column */}
            <div className="min-w-0">
              <p className="animate-rise text-xs font-semibold uppercase tracking-[0.2em] text-accent-600 dark:text-accent-400">
                {t('community_kicker')}
              </p>
              <h1
                className="animate-rise mt-1.5 text-2xl font-semibold tracking-tight md:text-3xl"
                style={{ animationDelay: '60ms' }}
              >
                {t('welcome_back', { name: user.displayName })}
              </h1>
              <p
                className="animate-rise mt-1.5 max-w-xl text-sm text-muted md:text-base"
                style={{ animationDelay: '120ms' }}
              >
                {t('community_sub_v2')}
              </p>

              {/* 今日简报 — directly under the welcome copy */}
              <div className="animate-rise mt-5" style={{ animationDelay: '160ms' }}>
                <div className="surface rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-500/15 text-accent-600 dark:text-accent-400">
                        <Newspaper className="h-3.5 w-3.5" />
                      </span>
                      {t('briefing_title')}
                    </p>
                    <span className="text-xs text-muted">
                      {new Intl.DateTimeFormat(locale, {
                        month: 'long',
                        day: 'numeric',
                        weekday: 'short',
                      }).format(new Date())}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-500" />
                      <p className="min-w-0 text-zinc-700 dark:text-zinc-300">
                        <span className="text-muted">{t('briefing_new_label')}</span>{' '}
                        {t('briefing_skills', { count: newSkillsToday })} ·{' '}
                        {t('briefing_posts', { count: newPostsToday })} ·{' '}
                        {t('briefing_shorts', { count: newShortsToday })}
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-500" />
                      {events.length > 0 ? (
                        <Link
                          href={`/events/${events[0].id}`}
                          className="min-w-0 truncate text-zinc-700 hover:text-accent-600 hover:underline dark:text-zinc-300 dark:hover:text-accent-400"
                        >
                          <span className="text-muted">{t('briefing_events_label')}</span>{' '}
                          {events[0].title}
                        </Link>
                      ) : (
                        <p className="text-muted">
                          {t('briefing_events_label')} {t('briefing_no_events')}
                        </p>
                      )}
                    </div>
                    {announcement && (
                      <div className="flex items-start gap-2">
                        <Megaphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-500" />
                        <Link
                          href={`/announcements/${announcement.id}`}
                          className="min-w-0 truncate text-zinc-700 hover:text-accent-600 hover:underline dark:text-zinc-300 dark:hover:text-accent-400"
                        >
                          <span className="text-muted">{t('announcement_label')}</span>{' '}
                          {announcement.title}
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 热门 Skills — 2×2 inside the left column */}
              <div className="mt-8">
                <SectionHeader
                  icon={<Flame className="h-4 w-4" />}
                  title={t('hot_skills')}
                  href="/skills"
                  linkLabel={t('view_all')}
                />
                {skills.length === 0 ? (
                  <div className="surface rounded-2xl px-6 py-12 text-center text-sm text-muted">
                    {t('no_skills_yet')}{' '}
                    <Link
                      href="/skills/new"
                      className="text-accent-600 hover:underline dark:text-accent-400"
                    >
                      {t('be_first')}
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {skills.map((s, i) => (
                      <Reveal key={s.id} delay={(i % 2) * 0.06} className="h-full">
                        <div className="group relative h-full">
                          <span className="sr-only">{t('rank_sr', { rank: i + 1 })}</span>
                          <RankBadge rank={i + 1} />
                          <SkillCard
                            slug={s.slug}
                            name={s.name}
                            summary={s.summary}
                            sourceType={s.sourceType}
                            visibility={s.visibility}
                            author={s.author}
                            updatedAt={s.updatedAt}
                            stats={{
                              downloads: s.downloadCount,
                              likes: s.likeCount,
                              rating: s.avgRating,
                              reviewCount: s.reviewCount,
                              tokens: s.tokenCostEstimate,
                            }}
                          />
                        </div>
                      </Reveal>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT column — 刷视频, full band height (same unified player as
                the 随刷 feed; ShortsShowcase only adds embed chrome) */}
            <div className="animate-rise flex min-w-0 flex-col" style={{ animationDelay: '200ms' }}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-500/15 text-accent-600 dark:text-accent-400">
                    <Play className="h-4 w-4" />
                  </span>
                  {t('shorts_title')}
                </h2>
                <Link
                  href="/videos/shorts"
                  className="group flex shrink-0 items-center gap-1 text-sm font-medium text-accent-600 transition hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300"
                >
                  {t('view_all')}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
              {shortItems.length > 0 ? (
                <ShortsShowcase
                  items={shortItems}
                  className="min-h-[520px] flex-1"
                  currentUser={{ id: user.id, isAdmin: user.isAdmin }}
                />
              ) : (
                <div className="surface flex min-h-[520px] flex-1 flex-col items-center justify-center gap-3 rounded-2xl px-6 text-center">
                  <p className="text-sm font-medium">{ts('empty_title')}</p>
                  <p className="max-w-xs text-xs text-muted">{ts('empty_hint')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Community now — light list panels, not heavy cards. */}
      {panelCount > 0 && (
        <section className="container pb-10 md:pb-12">
          <Reveal>
            <SectionHeader icon={<Activity className="h-4 w-4" />} title={t('community_now')} />
          </Reveal>
          <div className={`grid grid-cols-1 gap-4 ${panelCols}`}>
            {topics.length > 0 && (
              <Reveal delay={0.05} className="h-full">
                <Panel
                  icon={<MessagesSquare className="h-3.5 w-3.5" />}
                  title={t('panel_topics')}
                  href="/discussion"
                  linkLabel={t('go_discussion')}
                >
                  {topics.map((topic) => (
                    <Link
                      key={topic.id}
                      href={`/discussion/topics/${topic.id}`}
                      className="block rounded-xl px-2.5 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {topic.title}
                        </span>
                        <CategoryChip category={topic.categories[0] ?? topic.category} />
                      </div>
                      <p className="mt-0.5 text-xs tabular-nums text-muted">
                        {t('topic_meta', { replies: topic.replyCount, views: topic.viewCount })}
                      </p>
                    </Link>
                  ))}
                </Panel>
              </Reveal>
            )}
            {events.length > 0 && (
              <Reveal delay={0.1} className="h-full">
                <Panel
                  icon={<CalendarDays className="h-3.5 w-3.5" />}
                  title={t('panel_events')}
                  href="/events"
                  linkLabel={t('go_events')}
                >
                  {events.map((ev) => (
                    <Link
                      key={ev.id}
                      href={`/events/${ev.id}`}
                      className="block rounded-xl px-2.5 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {ev.title}
                        </span>
                        <span className="inline-flex shrink-0 items-center rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300">
                          {tl(`eventKind.${ev.kind}`)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        <EventTimeCard
                          startAt={ev.startAt}
                          endAt={ev.endAt}
                          allDay={ev.allDay}
                          timezone={ev.timezone}
                          showDate
                        />
                        {ev.city ? ` · ${ev.city}` : ''}
                      </p>
                    </Link>
                  ))}
                </Panel>
              </Reveal>
            )}
            {docs.length > 0 && (
              <Reveal delay={0.15} className="h-full">
                <Panel
                  icon={<BookOpen className="h-3.5 w-3.5" />}
                  title={t('panel_library')}
                  href="/library"
                  linkLabel={t('go_library')}
                >
                  {docs.map((doc) => (
                    <Link
                      key={doc.id}
                      href={`/library/${doc.slug}`}
                      className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    >
                      <DocCover
                        title={doc.title}
                        coverUrl={doc.coverUrl}
                        docType={doc.docType}
                        className="h-11 w-8 shrink-0 rounded-md"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{doc.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {doc.author || doc.siteName || doc.uploader.displayName}
                          {doc.estReadMinutes > 0
                            ? ` · ${t('doc_read_minutes', { min: doc.estReadMinutes })}`
                            : ''}
                        </p>
                      </div>
                    </Link>
                  ))}
                </Panel>
              </Reveal>
            )}
          </div>
        </section>
      )}

      {/* Trending geek videos */}
      {videos.length > 0 && (
        <section className="container pb-16">
          <Reveal>
            <SectionHeader
              icon={<Clapperboard className="h-4 w-4" />}
              title={t('hot_videos')}
              href="/videos"
              linkLabel={t('view_all')}
            />
          </Reveal>
          <Reveal delay={0.05}>
            <VideoGrid videos={videos} />
          </Reveal>
        </section>
      )}
    </div>
  );
}

/** Compact list panel for the 社区此刻 band: header, rows, footer link. */
function Panel({
  icon,
  title,
  href,
  linkLabel,
  children,
}: {
  icon: ReactNode;
  title: string;
  href: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="surface flex h-full flex-col rounded-2xl p-2">
      <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/15 text-accent-600 dark:text-accent-400">
          {icon}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="flex-1">{children}</div>
      <Link
        href={href}
        className="group mt-1 flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-medium text-accent-600 transition hover:bg-accent-500/5 dark:text-accent-400"
      >
        {linkLabel}
        <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const top3 = rank <= 3;
  return (
    // pointer-events-none keeps the card fully clickable; group-hover mirrors .card-hover's lift.
    <span
      aria-hidden
      className={`pointer-events-none absolute -left-2 -top-2 z-10 grid h-7 w-7 place-items-center rounded-full text-xs font-bold tabular-nums ring-2 ring-white transition-transform duration-[180ms] group-hover:-translate-y-0.5 dark:ring-zinc-950 ${
        top3
          ? 'bg-accent-500 text-white'
          : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
      }`}
    >
      {rank}
    </span>
  );
}
