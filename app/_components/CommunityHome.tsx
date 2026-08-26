import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clapperboard,
  Flame,
  MessagesSquare,
  Play,
  Plus,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { getLocale } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { DISCOVERABLE_SKILL_WHERE, SKILL_CARD_SELECT } from '@/lib/skill-queries';
import { SkillCard } from '@/components/SkillCard';
import { VideoGrid } from '@/components/video/VideoGrid';
import { ShortsShowcase } from './home/ShortsShowcase';
import { GithubTrending } from './home/GithubTrending';
import { trendingVideos } from '@/lib/video/queries';
import { annotateShortsViewer, featuredShorts, toShortView } from '@/lib/video/shorts-queries';
import { getTrendingWithin, warmTrending } from '@/lib/github-trending';
import { listTopics } from '@/lib/discussion-queries';
import { eventViewerFromSession, listEvents } from '@/lib/event-queries';
import { browseDocs } from '@/lib/library-queries';
import { EventTimeCard } from '@/app/events/_components/EventTime';
import { DocCover } from '@/components/library/DocCover';
import { CATEGORY_META } from '@/app/discussion/_components/badges';
import { KIND_META } from '@/app/events/_components/badges';
import { getTranslations } from 'next-intl/server';
import { Reveal } from './home/Reveal';
import { SectionHeader } from './home/SectionHeader';
import { HeroBackdrop } from './home/HeroBackdrop';

interface HomeUser {
  id: string;
  displayName: string;
  /** Role claims from the session; every per-surface permission is derived here via `can`. */
  roleKey: string;
  permissions: string[];
}

/**
 * Community home shown to signed-in users at `/`.
 *
 * Visual contract: ink chrome, colourful content. Every pixel the page itself
 * owns — headings, rules, buttons, links, the backdrop — is zinc and hairlines,
 * so nothing competes with the material. Everything that IS the material keeps
 * its real colour: book spines, GitHub's per-language dot, forum categories,
 * event kinds, people's avatars, video frames. Do not reintroduce tinted icon
 * chips, accent link colours or blurred colour glows (that combination is what
 * made the page read as a template) — and do not grey out the content again
 * either, which is what made it read as a spreadsheet.
 *
 * Band order, top to bottom: hero (greeting + today's figures, GitHub 热榜,
 * shorts player), 社区此刻, 热门 Skills, 热门视频.
 */
export async function CommunityHome({ user }: { user: HomeUser }) {
  const t = await getTranslations('home');
  const tl = await getTranslations('labels');
  const ts = await getTranslations('shorts');
  const locale = await getLocale();

  // Per-surface permissions — never the coarse staff flag: `identity` trims
  // author payloads, `shorts` moderates the embedded player.
  const canSeeIdentity = can(user, 'identity');
  const canModerateShorts = can(user, 'shorts');

  // 今日 figures count from the server's local midnight.
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
    trending,
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
    listEvents({ tab: 'upcoming' }, eventViewerFromSession({ user })),
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
    // Bounded: github.com sits behind a corporate proxy on the intranet deploy
    // and this page is force-dynamic. Past the budget we render without it and
    // the client leaf picks the data up from /api/github-trending.
    getTrendingWithin('daily', 1500),
  ]);

  // Pull the other two windows into the server cache so the day/week/month
  // switch is instant. No-ops while the cache is warm or the last fetch failed.
  warmTrending();

  // Player payload: viewer like/favorite flags + identity trim, same contract
  // as the 随刷 feed page.
  const shortItems = (await annotateShortsViewer(shorts, user.id)).map((s) =>
    toShortView(s, canSeeIdentity),
  );

  // Panels only render title/counts — raw author identities from listTopics
  // never cross into client components, so no toPublicAuthor mapping needed.
  const topics = topicsRes.items;
  const events = eventsRes.items.filter((e) => !e.cancelled).slice(0, 3);
  const docs = docsRes.items;
  const panelCount = [topics.length, events.length, docs.length].filter((n) => n > 0).length;
  const panelCols = panelCount >= 3 ? 'lg:grid-cols-3' : panelCount === 2 ? 'lg:grid-cols-2' : '';

  const nf = new Intl.NumberFormat(locale);
  const today = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());

  return (
    <div>
      {/* HERO BAND. Two columns split by a rule, not by a gap: greeting and the
          GitHub list stack on the left, the shorts player runs the full height
          on the right. The band gets a definite height at lg so the list has
          something to scroll inside; below lg it is three stacked blocks. */}
      {/* No `contain: paint` here, tempting as it is for the grain layer: paint
          containment makes this section a containing block for `position: fixed`
          descendants, which is the same trap that broke lightbox overlays under
          `card-hover`'s transform. */}
      <section className="relative overflow-hidden border-b border-zinc-200/90 dark:border-zinc-800">
        <HeroBackdrop />
        <div className="container relative py-7 md:py-9">
          <div className="grid gap-6 lg:h-[clamp(580px,calc(100vh-200px),780px)] lg:grid-cols-[minmax(0,1fr),372px] lg:grid-rows-[auto,minmax(0,1fr)] lg:gap-x-0 lg:gap-y-6 xl:grid-cols-[minmax(0,1fr),400px]">
            {/* Greeting + today's figures */}
            <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:pr-8">
              <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] md:text-[28px]">
                {t('welcome_back', { name: user.displayName })}
              </h1>
              <p className="mt-2 max-w-[52ch] text-sm text-muted">{t('community_sub_v2')}</p>

              <div className="mt-5 border-y border-zinc-200/90 py-3.5 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex divide-x divide-zinc-200/90 dark:divide-zinc-800">
                    <Figure value={nf.format(newSkillsToday)} label={t('stat_new_skills')} />
                    <Figure value={nf.format(newPostsToday)} label={t('stat_new_posts')} />
                    <Figure value={nf.format(newShortsToday)} label={t('stat_new_shorts')} />
                  </div>
                  <span className="shrink-0 text-xs text-muted">{today}</span>
                </div>

                {(events.length > 0 || announcement) && (
                  <div className="mt-3.5 space-y-1.5">
                    {events.length > 0 && (
                      <BriefLine
                        label={t('briefing_events_label')}
                        href={`/events/${events[0].id}`}
                        text={events[0].title}
                        dot={KIND_META[events[0].kind]?.dot}
                      />
                    )}
                    {announcement && (
                      <BriefLine
                        label={t('announcement_label')}
                        href={`/announcements/${announcement.id}`}
                        text={announcement.title}
                        dot="bg-amber-500"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* GitHub 热榜 — the slot 热门 Skills used to occupy. */}
            <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:min-h-0 lg:pr-8">
              <GithubTrending initial={trending} className="h-[440px] lg:h-full" />
            </div>

            {/* Shorts player, full band height on the right of the rule. */}
            <div className="flex min-w-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:border-l lg:border-zinc-200/90 lg:pl-8 dark:lg:border-zinc-800">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                  <Play className="h-4 w-4 text-zinc-400 dark:text-zinc-500" aria-hidden />
                  {t('shorts_title')}
                </h2>
                <Link
                  href="/videos/shorts"
                  className="group flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  {t('view_all')}
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              </div>
              {shortItems.length > 0 ? (
                <ShortsShowcase
                  items={shortItems}
                  className="min-h-[520px] flex-1 lg:min-h-0"
                  currentUser={{ id: user.id, canModerate: canModerateShorts }}
                />
              ) : (
                <div className="surface flex min-h-[520px] flex-1 flex-col items-center justify-center gap-2 rounded-xl px-6 text-center lg:min-h-0">
                  <p className="text-sm font-medium">{ts('empty_title')}</p>
                  <p className="max-w-xs text-xs text-muted">{ts('empty_hint')}</p>
                  {/* The slot is 520px tall; without a way out it is just a
                      void on the most valuable part of the page. */}
                  <Link
                    href="/videos/shorts?upload=1"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-700 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {ts('upload')}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 社区此刻 — list panels, not feature cards. */}
      {panelCount > 0 && (
        <section className="container pb-10 pt-10 md:pb-12 md:pt-12">
          <Reveal>
            <SectionHeader icon={<Activity className="h-4 w-4" />} title={t('community_now')} />
          </Reveal>
          <div className={`grid grid-cols-1 gap-4 ${panelCols}`}>
            {topics.length > 0 && (
              <Reveal className="h-full">
                <Panel
                  icon={<MessagesSquare className="h-3.5 w-3.5" />}
                  title={t('panel_topics')}
                  href="/discussion"
                  linkLabel={t('go_discussion')}
                >
                  {topics.map((topic) => (
                    <Row key={topic.id} href={`/discussion/topics/${topic.id}`}>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {topic.title}
                        </span>
                        <TaxonomyChip
                          cls={CATEGORY_META[topic.categories[0] ?? topic.category]?.className}
                        >
                          {tl(`discussionCategory.${topic.categories[0] ?? topic.category}`)}
                        </TaxonomyChip>
                      </div>
                      <p className="mt-0.5 text-xs tabular-nums text-muted">
                        {t('topic_meta', { replies: topic.replyCount, views: topic.viewCount })}
                      </p>
                    </Row>
                  ))}
                </Panel>
              </Reveal>
            )}
            {events.length > 0 && (
              <Reveal className="h-full">
                <Panel
                  icon={<CalendarDays className="h-3.5 w-3.5" />}
                  title={t('panel_events')}
                  href="/events"
                  linkLabel={t('go_events')}
                >
                  {events.map((ev) => (
                    <Row key={ev.id} href={`/events/${ev.id}`}>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {ev.title}
                        </span>
                        <TaxonomyChip cls={KIND_META[ev.kind]?.badge}>
                          {tl(`eventKind.${ev.kind}`)}
                        </TaxonomyChip>
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
                    </Row>
                  ))}
                </Panel>
              </Reveal>
            )}
            {docs.length > 0 && (
              <Reveal className="h-full">
                <Panel
                  icon={<BookOpen className="h-3.5 w-3.5" />}
                  title={t('panel_library')}
                  href="/library"
                  linkLabel={t('go_library')}
                >
                  {docs.map((doc) => (
                    <Row key={doc.id} href={`/library/${doc.slug}`}>
                      <div className="flex items-center gap-3">
                        <DocCover
                          title={doc.title}
                          coverUrl={doc.coverUrl}
                          docType={doc.docType}
                          className="h-11 w-8 shrink-0 rounded shadow-sm ring-1 ring-black/5 dark:ring-white/10"
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
                      </div>
                    </Row>
                  ))}
                </Panel>
              </Reveal>
            )}
          </div>
        </section>
      )}

      {/* 热门 Skills — moved below 社区此刻, now full width. */}
      <section className="container pb-12 md:pb-14">
        <Reveal>
          <SectionHeader
            icon={<Flame className="h-4 w-4" />}
            title={t('hot_skills')}
            href="/skills"
            linkLabel={t('view_all')}
          />
        </Reveal>
        {skills.length === 0 ? (
          <div className="surface rounded-xl px-6 py-12 text-center text-sm text-muted">
            {t('no_skills_yet')}{' '}
            <Link
              href="/skills/new"
              className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 dark:text-zinc-100 dark:decoration-zinc-600"
            >
              {t('be_first')}
            </Link>
          </div>
        ) : (
          <Reveal>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {skills.map((s, i) => (
                <div key={s.id} className="h-full">
                  <span className="sr-only">{t('rank_sr', { rank: i + 1 })}</span>
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
              ))}
            </div>
          </Reveal>
        )}
      </section>

      {/* 热门视频 */}
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
          <Reveal>
            <VideoGrid videos={videos} />
          </Reveal>
        </section>
      )}
    </div>
  );
}

/** One of today's three figures. Mono digits, plain-text label. */
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <div className="font-mono text-[22px] font-medium leading-none tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}

/**
 * "活动 · <title>" line under the figures. The dot is the only colour, and it
 * is the same hue the row's own board uses for that kind, so the two lines are
 * told apart before either label is read.
 */
function BriefLine({
  label,
  href,
  text,
  dot,
}: {
  label: string;
  href: string;
  text: string;
  dot?: string;
}) {
  return (
    <Link href={href} className="group flex min-w-0 items-baseline gap-2 text-xs">
      <span
        aria-hidden
        className={`mt-[1px] h-1.5 w-1.5 shrink-0 self-center rounded-full ${dot ?? 'bg-zinc-400'}`}
      />
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate decoration-zinc-300 underline-offset-2 group-hover:underline dark:decoration-zinc-600">
        {text}
      </span>
    </Link>
  );
}

/**
 * Taxonomy chip. The colour is not invented here: it is passed in from the
 * board that owns the taxonomy (CATEGORY_META for the forum, KIND_META for
 * events), so a category reads the same on the homepage as it does on the page
 * the row links to. Unknown values fall back to ink.
 */
function TaxonomyChip({ cls, children }: { cls?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        cls ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
      }`}
    >
      {children}
    </span>
  );
}

/** Compact list panel for the 社区此刻 band: header, ruled rows, footer link. */
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
    <div className="surface flex h-full flex-col overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800/80">
        <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="flex-1 divide-y divide-zinc-100 dark:divide-zinc-800/70">{children}</div>
      <Link
        href={href}
        className="group flex items-center gap-1 border-t border-zinc-100 px-4 py-2.5 text-xs font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:border-zinc-800/80 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {linkLabel}
        <ArrowRight className="h-3 w-3" aria-hidden />
      </Link>
    </div>
  );
}

function Row({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block px-4 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
    >
      {children}
    </Link>
  );
}
