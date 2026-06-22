import Link from 'next/link';
import { ArrowRight, Sparkles, Zap, GitBranch, Bell, Clapperboard } from 'lucide-react';
import { prisma } from '@/lib/db';
import { SkillCard } from '@/components/SkillCard';
import { InstallSnippet } from '@/components/InstallSnippet';
import { getTranslations } from 'next-intl/server';

/** Marketing landing shown to signed-out visitors at `/`. */
export async function Landing() {
  const t = await getTranslations('home');

  const trending = await prisma.skill.findMany({
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
  });

  return (
    <div>
      {/* Hero */}
      <section className="container py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent-500/30 bg-accent-500/10 px-3 py-1 text-xs font-medium text-accent-700 dark:text-accent-300">
            <Sparkles className="h-3 w-3" />
            {t('hero_badge')}
          </div>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{t('hero_title')}</h1>
          <p className="mt-4 text-lg text-muted">{t('hero_subtitle')}</p>
          <div className="mx-auto mt-6 max-w-md">
            <InstallSnippet slug="<your-skill>" />
          </div>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/skills"
              className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-600"
            >
              {t('browse_skills')}
              <ArrowRight className="h-3.5 w-3.5" />
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

      {/* Feature row */}
      <section className="container grid grid-cols-1 gap-4 md:grid-cols-3">
        <Feature
          icon={<Zap className="h-4 w-4" />}
          title={t('feature_install_title')}
          body={t('feature_install_body')}
        />
        <Feature
          icon={<Bell className="h-4 w-4" />}
          title={t('feature_subscribe_title')}
          body={t('feature_subscribe_body')}
        />
        <Feature
          icon={<GitBranch className="h-4 w-4" />}
          title={t('feature_remix_title')}
          body={t('feature_remix_body')}
        />
      </section>

      {/* Trending */}
      <section className="container py-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">{t('trending')}</h2>
          <Link href="/skills" className="text-sm text-accent-600 hover:text-accent-700">
            {t('view_all')} →
          </Link>
        </div>
        {trending.length === 0 ? (
          <div className="surface rounded-2xl px-6 py-12 text-center text-sm text-muted">
            {t('no_skills_yet')}{' '}
            <Link href="/skills/new" className="text-accent-600 hover:underline">
              {t('be_first')}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {trending.map((s) => (
              <SkillCard
                key={s.id}
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
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="surface rounded-2xl p-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500/15 text-accent-600">
        {icon}
      </div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}
