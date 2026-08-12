import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clapperboard,
  Flame,
  MessagesSquare,
  PenLine,
  Play,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { prisma } from '@/lib/db';
import { DISCOVERABLE_SKILL_WHERE, SKILL_CARD_SELECT } from '@/lib/skill-queries';
import { SkillCard } from '@/components/SkillCard';
import { VideoGrid } from '@/components/video/VideoGrid';
import { ShortsStrip } from '@/components/video/ShortsStrip';
import { trendingVideos } from '@/lib/video/queries';
import { featuredShorts } from '@/lib/video/shorts-queries';
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

  const [skills, videos, shorts, topicsRes, eventsRes, docsRes, announcement] = await Promise.all([
    prisma.skill.findMany({
      where: DISCOVERABLE_SKILL_WHERE,
      orderBy: { trendingScore: 'desc' },
      take: 6,
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
  ]);

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
      {/* Welcome band — CSS-staggered entrance, renders without JS. */}
      <section className="relative overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
        <HeroBackdrop intensity="soft" />
        <div className="container relative py-10 md:py-14">
          <p className="animate-rise text-xs font-semibold uppercase tracking-[0.2em] text-accent-600 dark:text-accent-400">
            {t('community_kicker')}
          </p>
          <h1
            className="animate-rise mt-2 text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ animationDelay: '60ms' }}
          >
            {t('welcome_back', { name: user.displayName })}
          </h1>
          <p
            className="animate-rise mt-2 max-w-xl text-base text-muted"
            style={{ animationDelay: '120ms' }}
          >
            {t('community_sub_v2')}
          </p>
          {announcement && (
            <div className="animate-rise mt-4" style={{ animationDelay: '170ms' }}>
              <Link
                href={`/announcements/${announcement.id}`}
                className="group inline-flex max-w-full items-center gap-2 rounded-full border border-accent-500/25 bg-accent-500/5 py-1 pl-1.5 pr-3 text-xs transition hover:border-accent-500/50 hover:bg-accent-500/10"
              >
                <span className="rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {t('announcement_label')}
                </span>
                <span className="truncate text-zinc-700 dark:text-zinc-200">
                  {announcement.title}
                </span>
                <ArrowRight className="h-3 w-3 shrink-0 text-accent-600 transition-transform duration-200 group-hover:translate-x-0.5 dark:text-accent-400" />
              </Link>
            </div>
          )}
          <div
            className="animate-rise mt-5 flex flex-wrap items-center gap-3"
            style={{ animationDelay: '220ms' }}
          >
            <Link
              href="/skills/new"
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
            >
              <Upload className="h-3.5 w-3.5" />
              {t('post_skill')}
            </Link>
            <Link
              href="/discussion"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <PenLine className="h-3.5 w-3.5" />
              {t('post_update')}
            </Link>
          </div>
        </div>
      </section>

      {/* Trending skills */}
      <section className="container py-10 md:py-12">
        <Reveal>
          <SectionHeader
            icon={<Flame className="h-4 w-4" />}
            title={t('hot_skills')}
            href="/skills"
            linkLabel={t('view_all')}
          />
        </Reveal>
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {skills.map((s, i) => (
              <Reveal key={s.id} delay={(i % 3) * 0.06} className="h-full">
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

      {/* 精选短视频 (featured shorts strip → 随刷 feed) */}
      {shorts.length > 0 && (
        <section className="container pb-10 md:pb-12">
          <Reveal>
            <ShortsStrip
              title={t('shorts_title')}
              viewAllLabel={t('view_all')}
              icon={<Play className="h-4 w-4" />}
              items={shorts.map((s) => ({
                id: s.id,
                title: s.title,
                summary: s.summary,
                posterUrl: s.posterUrl,
                durationSec: s.durationSec,
                viewCount: s.viewCount,
                likeCount: s.likeCount,
              }))}
            />
          </Reveal>
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
