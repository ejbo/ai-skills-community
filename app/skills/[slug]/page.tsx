import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Bell, GitFork, Heart, Star, Calendar, Tag as TagIcon, ExternalLink, Download } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getSkillBySlug } from '@/lib/skill-queries';
import { prisma } from '@/lib/db';
import { SourceBadge } from '@/components/SourceBadge';
import { InstallSnippet } from '@/components/InstallSnippet';
import { TokenCostBadge } from '@/components/TokenCostBadge';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { DetailTabs } from './DetailTabs';
import { ActionButtons } from './ActionButtons';
import { ReviewsTab } from './ReviewsTab';
import { TryItTab } from './TryItTab';
import { CompositionTab } from './CompositionTab';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
  searchParams: { tab?: string };
}

export default async function SkillDetailPage({ params, searchParams }: PageProps) {
  const skill = await getSkillBySlug(params.slug);
  if (!skill || skill.deletedAt || (skill.status !== 'published' && !(await isOwner(skill.authorId)))) {
    notFound();
  }

  const t = await getTranslations('detail');
  const session = await auth();
  const tab = (searchParams.tab as 'overview' | 'versions' | 'reviews' | 'composition' | 'try_it') ?? 'overview';

  const [versionCount, isLiked, isFav, isSub] = await Promise.all([
    prisma.skillVersion.count({ where: { skillId: skill.id, status: 'published' } }),
    session?.user
      ? prisma.like.findUnique({ where: { userId_skillId: { userId: session.user.id, skillId: skill.id } } })
      : null,
    session?.user
      ? prisma.favorite.findUnique({ where: { userId_skillId: { userId: session.user.id, skillId: skill.id } } })
      : null,
    session?.user
      ? prisma.subscription.findUnique({ where: { userId_skillId: { userId: session.user.id, skillId: skill.id } } })
      : null,
  ]);

  return (
    <div className="container py-8">
      {/* Hero */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={skill.sourceType} />
            {skill.currentVersion?.version && (
              <span className="rounded-full border border-zinc-200 px-2 py-0.5 font-mono text-[11px] text-muted dark:border-zinc-800">
                v{skill.currentVersion.version}
              </span>
            )}
            {skill.category && (
              <Link
                href={`/skills?category=${skill.category.slug}`}
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              >
                {skill.category.name}
              </Link>
            )}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{skill.name}</h1>
          <p className="text-lg text-muted">{skill.summary}</p>
          <InstallSnippet slug={skill.slug} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>或</span>
            <a
              href={`/api/skills/${skill.slug}/raw`}
              download
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:border-accent-500 hover:bg-accent-500/5 hover:text-accent-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-accent-400 dark:hover:bg-accent-500/10 dark:hover:text-accent-300"
            >
              <Download className="h-3.5 w-3.5" />
              下载 SKILL.md
            </a>
            <span className="font-mono text-[11px]">
              手动放到 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">~/.claude/skills/{skill.slug}/</code>
            </span>
          </div>
          <ActionButtons
            slug={skill.slug}
            initiallyLiked={Boolean(isLiked)}
            initiallyFavorited={Boolean(isFav)}
            initiallySubscribed={Boolean(isSub)}
            likeCount={skill.likeCount}
            subscriberCount={skill.subscriberCount}
            canRemix={Boolean(session?.user)}
          />
        </div>
        <aside className="surface space-y-3 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-500 text-sm font-semibold text-white">
              {skill.author.displayName.charAt(0)}
            </div>
            <div>
              <div className="text-sm font-medium">{skill.author.displayName}</div>
              <Link href={`/users/${skill.author.handle}`} className="text-xs text-muted hover:underline">
                @{skill.author.handle}
              </Link>
            </div>
          </div>
          {skill.author.bio && <p className="text-xs text-muted">{skill.author.bio}</p>}
        </aside>
      </section>

      {/* Tabs */}
      <div className="mt-8">
        <DetailTabs slug={skill.slug} current={tab} hasVersions={versionCount > 1} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_240px]">
        <article>
          {tab === 'overview' && <MarkdownRenderer content={skill.descriptionMd || skill.summary} />}
          {tab === 'versions' && <VersionsTab skillId={skill.id} />}
          {tab === 'reviews' && <ReviewsTab skillId={skill.id} slug={skill.slug} />}
          {tab === 'composition' && <CompositionTab skillId={skill.id} />}
          {tab === 'try_it' && <TryItTab slug={skill.slug} />}
        </article>
        <aside className="space-y-5 text-sm">
          <StatBlock label={t('downloads')} value={skill.downloadCount.toLocaleString()} icon={<TokenCostBadge tokens={skill.tokenCostEstimate} compact />} />
          <StatBlock label={t('subscribers')} value={skill.subscriberCount.toLocaleString()} icon={<Bell className="h-3.5 w-3.5" />} />
          <StatBlock label="点赞" value={skill.likeCount.toLocaleString()} icon={<Heart className="h-3.5 w-3.5" />} />
          <StatBlock
            label="评分"
            value={skill.avgRating > 0 ? `${skill.avgRating.toFixed(1)} (${skill.reviewCount})` : '—'}
            icon={<Star className="h-3.5 w-3.5" />}
          />
          <StatBlock
            label={t('last_published')}
            value={
              skill.currentVersion?.publishedAt
                ? formatDistanceToNowStrict(skill.currentVersion.publishedAt, { addSuffix: true })
                : '—'
            }
            icon={<Calendar className="h-3.5 w-3.5" />}
          />
          {skill.tags.length > 0 && (
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t('tags')}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map(({ tag }) => (
                  <Link
                    key={tag.id}
                    href={`/skills?tag=${tag.slug}`}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    <TagIcon className="h-2.5 w-2.5" />
                    {tag.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {skill.license && (
            <StatBlock label={t('license')} value={skill.license} icon={<span className="font-mono text-[10px]">©</span>} />
          )}
          {skill.externalSourceUrl && (
            <a
              href={skill.externalSourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700"
            >
              <ExternalLink className="h-3 w-3" />
              查看上游来源
            </a>
          )}
          {skill.forkedFrom && (
            <div className="text-xs">
              <span className="text-muted">Fork 自 </span>
              <Link href={`/skills/${skill.forkedFrom.slug}`} className="text-accent-600 hover:underline">
                {skill.forkedFrom.name}
              </Link>
            </div>
          )}
          {skill._count.forks > 0 && (
            <div className="text-xs">
              <span className="text-muted">被 Remix </span>
              <span className="font-mono tabular-nums">{skill._count.forks}</span>
              <span className="text-muted"> 次</span>
              <GitFork className="ml-1 inline h-3 w-3 text-muted" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

async function isOwner(authorId: string) {
  const session = await auth();
  return session?.user?.id === authorId;
}

function StatBlock({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono tabular-nums text-sm">
        {icon}
        {value}
      </div>
    </div>
  );
}

async function VersionsTab({ skillId }: { skillId: string }) {
  const versions = await prisma.skillVersion.findMany({
    where: { skillId, status: { in: ['published', 'yanked'] } },
    orderBy: [{ major: 'desc' }, { minor: 'desc' }, { patch: 'desc' }],
  });
  if (versions.length === 0) {
    return <div className="text-sm text-muted">还没有发布过版本。</div>;
  }
  return (
    <ul className="space-y-3">
      {versions.map((v) => (
        <li key={v.id} className="surface rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="rounded bg-accent-500/10 px-2 py-0.5 font-mono text-xs text-accent-700 dark:text-accent-300">
                v{v.version}
              </span>
              {v.publishedAt && (
                <span className="text-xs text-muted">
                  {formatDistanceToNowStrict(v.publishedAt, { addSuffix: true })}
                </span>
              )}
              {v.status === 'yanked' && (
                <span className="text-xs text-warn">已撤回</span>
              )}
            </div>
            <span className="font-mono text-[11px] text-muted">{(v.totalBytes / 1024).toFixed(1)} KB</span>
          </div>
          {v.changelogMd && (
            <div className="prose prose-sm mt-3 max-w-none dark:prose-invert">
              <MarkdownRenderer content={v.changelogMd} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
