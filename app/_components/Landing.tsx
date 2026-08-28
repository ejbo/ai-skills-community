import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  CalendarDays,
  Clapperboard,
  Flame,
  MessagesSquare,
  Package,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { prisma } from '@/lib/db';
import { DISCOVERABLE_SKILL_WHERE, SKILL_CARD_SELECT } from '@/lib/skill-queries';
import { SkillCard } from '@/components/SkillCard';
import { InstallSnippet } from '@/components/InstallSnippet';
import { getLocale, getTranslations } from 'next-intl/server';
import { Reveal } from './home/Reveal';
import { SectionHeader } from './home/SectionHeader';
import { HeroBackdrop } from './home/HeroBackdrop';

// The six community surfaces highlighted below the hero. Copy lives in the
// `home` i18n namespace (surface_*_title / surface_*_body).
const SURFACES: { key: string; href: string; icon: LucideIcon }[] = [
  { key: 'skills', href: '/skills', icon: Blocks },
  { key: 'packs', href: '/skills?source=packs', icon: Package },
  { key: 'videos', href: '/videos', icon: Clapperboard },
  { key: 'discussion', href: '/discussion', icon: MessagesSquare },
  { key: 'library', href: '/library', icon: BookOpen },
  { key: 'events', href: '/events', icon: CalendarDays },
];

/** Marketing landing shown to signed-out visitors at `/`. */
export async function Landing() {
  const [t, locale] = await Promise.all([getTranslations('home'), getLocale()]);

  const [trending, skillCount, memberCount, downloads] = await Promise.all([
    prisma.skill.findMany({
      where: DISCOVERABLE_SKILL_WHERE,
      orderBy: { trendingScore: 'desc' },
      take: 6,
      select: SKILL_CARD_SELECT,
    }),
    prisma.skill.count({ where: DISCOVERABLE_SKILL_WHERE }),
    prisma.user.count(),
    prisma.skill.aggregate({ _sum: { downloadCount: true } }),
  ]);

  const nf = new Intl.NumberFormat(locale);
  const stats = [
    { value: skillCount, label: t('stat_skills') },
    { value: memberCount, label: t('stat_members') },
    { value: downloads._sum.downloadCount ?? 0, label: t('stat_installs') },
  ].filter((s) => s.value > 0);

  return (
    <div>
      {/* Hero — CSS-staggered entrance so it renders (and animates) without JS. */}
      <section className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="container relative flex flex-col items-center py-16 text-center md:py-24">
          <div className="animate-rise inline-flex items-center gap-2 rounded-full border border-zinc-900/40 dark:border-zinc-100/40 bg-zinc-900/[0.06] dark:bg-white/10 px-3.5 py-1 text-xs font-medium text-zinc-900 dark:text-zinc-50 dark:border-zinc-100/30">
            <Sparkles className="h-3 w-3" />
            {t('hero_badge_v2')}
          </div>
          <h1
            className="animate-rise mt-6 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl"
            style={{ animationDelay: '70ms' }}
          >
            {t('hero_heading_pre')}
            <span className="bg-gradient-to-r from-zinc-900 to-zinc-500 bg-clip-text text-transparent dark:from-zinc-100 dark:to-zinc-400">
              {t('hero_heading_em')}
            </span>
          </h1>
          <p
            className="animate-rise mt-4 max-w-xl text-lg text-muted"
            style={{ animationDelay: '140ms' }}
          >
            {t('hero_sub_v2')}
          </p>
          <div className="animate-rise mt-7 w-full max-w-md" style={{ animationDelay: '210ms' }}>
            <InstallSnippet slug="<your-skill>" />
          </div>
          <div
            className="animate-rise mt-6 flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: '280ms' }}
          >
            <Link
              href="/skills"
              className="flex h-10 items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 text-sm font-medium text-white dark:text-zinc-900 shadow-lg shadow-zinc-900/15 dark:shadow-black/40 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 hover:shadow-zinc-900/15"
            >
              {t('browse_skills')}
              <ArrowRight className="h-4 w-4" />
            </Link>
            {/* 自助注册已关闭（账号来自 W3 首次登录 / 种子脚本），落地页的第二个
                CTA 因此是「登录」而不是「加入社区」。 */}
            <Link
              href="/auth/login"
              className="flex h-10 items-center rounded-xl border border-zinc-300 bg-white/60 px-5 text-sm font-medium backdrop-blur transition hover:border-zinc-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/60 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
            >
              {t('sign_in')}
            </Link>
          </div>
          {stats.length > 0 && (
            <div
              className="animate-rise mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2"
              style={{ animationDelay: '350ms' }}
            >
              {stats.map((s) => (
                <div key={s.label} className="flex items-baseline gap-1.5">
                  <span className="font-mono text-xl font-semibold tabular-nums">
                    {nf.format(s.value)}
                  </span>
                  <span className="text-xs text-muted">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Community surfaces */}
      <section className="container pt-4 md:pt-8">
        <Reveal className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {t('explore_title')}
          </h2>
          <p className="mt-2 text-base text-muted">{t('explore_sub')}</p>
        </Reveal>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map((s, i) => (
            <Reveal key={s.key} delay={(i % 3) * 0.07} className="h-full">
              <Link href={s.href} className="card-hover surface group flex h-full flex-col rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50 transition-colors duration-200 group-hover:bg-zinc-900 group-hover:text-white dark:group-hover:bg-zinc-100 dark:group-hover:text-white">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 -translate-x-1 text-muted opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                </div>
                <h3 className="mt-3.5 text-base font-semibold">{t(`surface_${s.key}_title`)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {t(`surface_${s.key}_body`)}
                </p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Trending skills */}
      {trending.length > 0 && (
        <section className="container py-12 md:py-16">
          <Reveal>
            <SectionHeader
              icon={<Flame className="h-4 w-4" />}
              title={t('trending')}
              href="/skills"
              linkLabel={t('view_all')}
            />
          </Reveal>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {trending.map((s, i) => (
              <Reveal key={s.id} delay={(i % 3) * 0.07} className="h-full">
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
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* Closing CTA */}
      <section className={`container pb-16 md:pb-24 ${trending.length === 0 ? 'pt-12' : ''}`}>
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-zinc-900/40 dark:border-zinc-100/40 bg-gradient-to-br from-zinc-900/10 via-transparent to-sky-500/10 px-6 py-14 text-center dark:border-zinc-100/30">
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-[-140px] h-[260px] w-[520px] -translate-x-1/2 rounded-full bg-zinc-900/[0.06] dark:bg-white/10 blur-3xl"
            />
            <h2 className="relative text-2xl font-semibold tracking-tight md:text-3xl">
              {t('cta_title')}
            </h2>
            <p className="relative mx-auto mt-2 max-w-md text-base text-muted">{t('cta_sub')}</p>
            <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/auth/login"
                className="flex h-10 items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-5 text-sm font-medium text-white dark:text-zinc-900 shadow-lg shadow-zinc-900/15 dark:shadow-black/40 transition hover:bg-zinc-700 dark:hover:bg-zinc-300"
              >
                {t('sign_in')}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/skills"
                className="flex h-10 items-center rounded-xl px-5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-white"
              >
                {t('browse_skills')}
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
