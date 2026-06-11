import Link from 'next/link';
import { ArrowRight, Flame, Clapperboard, Upload } from 'lucide-react';
import { prisma } from '@/lib/db';
import { SkillCard } from '@/components/SkillCard';
import { VideoGrid } from '@/components/video/VideoGrid';
import { trendingVideos } from '@/lib/video/queries';
import { getTranslations } from 'next-intl/server';

/** Community home shown to signed-in users at `/`: trending skills + trending geek videos. */
export async function CommunityHome({ displayName }: { displayName: string }) {
  const t = await getTranslations('home');

  const [skills, videos] = await Promise.all([
    prisma.skill.findMany({
      where: { status: 'published', deletedAt: null },
      orderBy: { trendingScore: 'desc' },
      take: 6,
      select: {
        id: true,
        slug: true,
        name: true,
        summary: true,
        sourceType: true,
        updatedAt: true,
        downloadCount: true,
        likeCount: true,
        reviewCount: true,
        avgRating: true,
        tokenCostEstimate: true,
        author: { select: { handle: true, displayName: true } },
      },
    }),
    trendingVideos(8),
  ]);

  return (
    <div>
      {/* Welcome band */}
      <section className="relative overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent-500/10 via-transparent to-transparent" />
        <div className="container relative py-10 md:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-600 dark:text-accent-400">
            {t('community_kicker')}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            {t('welcome_back', { name: displayName })}
          </h1>
          <p className="mt-2 max-w-xl text-base text-muted">{t('community_subtitle')}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/skills/new"
              className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-600"
            >
              <Upload className="h-3.5 w-3.5" />
              {t('post_skill')}
            </Link>
            <Link
              href="/videos"
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <Clapperboard className="h-3.5 w-3.5" />
              {t('browse_videos')}
            </Link>
          </div>
        </div>
      </section>

      {/* Trending skills */}
      <section className="container py-10 md:py-12">
        <SectionHeader
          icon={<Flame className="h-4 w-4" />}
          title={t('hot_skills')}
          href="/skills"
          linkLabel={t('view_all')}
        />
        {skills.length === 0 ? (
          <div className="surface rounded-2xl px-6 py-12 text-center text-sm text-muted">
            {t('no_skills_yet')}{' '}
            <Link href="/skills/new" className="text-accent-600 hover:underline">
              {t('be_first')}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {skills.map((s, i) => (
              <div key={s.id} className="group relative">
                <RankBadge rank={i + 1} />
                <SkillCard
                  slug={s.slug}
                  name={s.name}
                  summary={s.summary}
                  sourceType={s.sourceType}
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
        )}
      </section>

      {/* Trending geek videos */}
      {videos.length > 0 && (
        <section className="container pb-16">
          <SectionHeader
            icon={<Clapperboard className="h-4 w-4" />}
            title={t('hot_videos')}
            href="/videos"
            linkLabel={t('view_all')}
          />
          <VideoGrid videos={videos} />
        </section>
      )}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  href,
  linkLabel,
}: {
  icon: React.ReactNode;
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-500/15 text-accent-600">
          {icon}
        </span>
        {title}
      </h2>
      <Link
        href={href}
        className="flex items-center gap-1 text-sm text-accent-600 transition hover:text-accent-700"
      >
        {linkLabel}
        <ArrowRight className="h-3.5 w-3.5" />
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
