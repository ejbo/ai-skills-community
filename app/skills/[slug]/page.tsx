import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Bell, GitFork, Heart, Star, Calendar, Tag as TagIcon, ExternalLink, Download, Lock } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getSkillBySlug } from '@/lib/skill-queries';
import { prisma } from '@/lib/db';
import { canAccessSkillContent } from '@/lib/access';
import { SourceBadge } from '@/components/SourceBadge';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { InstallSnippet } from '@/components/InstallSnippet';
import { TokenCostBadge } from '@/components/TokenCostBadge';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { BackButton } from '@/components/BackButton';
import { DetailTabs } from './DetailTabs';
import { ActionButtons } from './ActionButtons';
import { ReviewsTab } from './ReviewsTab';
import { ChatPanel } from './ChatPanel';
import { ComparisonTab } from './ComparisonTab';
import { CompositionTab } from './CompositionTab';
import { AccessRequestPanel, type RequestState } from './AccessRequestPanel';
import { FilesTab } from './FilesTab';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
  searchParams: { tab?: string };
}

export default async function SkillDetailPage({ params, searchParams }: PageProps) {
  const skill = await getSkillBySlug(params.slug);
  if (!skill || skill.deletedAt) notFound();

  const session = await auth();
  const actor = session?.user
    ? { id: session.user.id, isAdmin: session.user.isAdmin, via: 'session' as const, scopes: null }
    : null;

  // Viewer's grant status for restricted skills.
  let grantStatus: string | null = null;
  if (actor && skill.visibility === 'restricted' && actor.id !== skill.authorId && !actor.isAdmin) {
    const g = await prisma.skillAccessRequest.findUnique({
      where: { skillId_userId: { skillId: skill.id, userId: actor.id } },
      select: { status: true },
    });
    grantStatus = g?.status ?? null;
  }

  const decision = canAccessSkillContent(skill, actor, grantStatus as never);
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  const canSeeMeta = privileged || (skill.status === 'published' && skill.visibility !== 'private');
  if (!canSeeMeta) notFound();

  const canContent = decision.canContent;
  const restrictedLocked = skill.visibility === 'restricted' && !canContent;
  const requestState: RequestState =
    grantStatus === 'rejected' ? 'rejected' : grantStatus === 'revoked' ? 'revoked' : grantStatus === 'pending' ? 'pending' : 'none';
  const pendingCount = privileged ? skill._count.accessRequests : 0;

  // Legacy/coupled structured skills can have descriptionMd === the gated body
  // (contentInline). For a restricted viewer the always-public Overview tab would
  // then leak the protected content, so hide it when there is no DISTINCT public
  // overview. Data-independent guard (covers legacy rows with no backfill).
  const overviewLeaksBody =
    restrictedLocked &&
    Boolean(skill.descriptionMd) &&
    skill.descriptionMd === (skill.currentVersion?.contentInline ?? null);

  const t = await getTranslations('detail');
  const rawTab = (searchParams.tab as 'overview' | 'files' | 'versions' | 'reviews' | 'composition' | 'comparison' | 'try_it' | 'manage') ?? 'overview';

  const [versionCount, isLiked, isFav, isSub, comparison] = await Promise.all([
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
    prisma.skillComparison.findUnique({ where: { skillId: skill.id } }),
  ]);

  // The Comparison tab shows for owner/admin always; for visitors only when a
  // published comparison exists and they may access the skill's content.
  const hasPublishedComparison = comparison?.status === 'published';
  const comparisonStale = Boolean(
    comparison && comparison.generatedForVersionId && comparison.generatedForVersionId !== skill.currentVersionId,
  );
  const showComparison = privileged || (hasPublishedComparison && !restrictedLocked);

  // `manage` is now its own page (/skills/[slug]/manage); never render it inline.
  const tab =
    rawTab === 'manage' || (rawTab === 'comparison' && !showComparison) ? 'overview' : rawTab;

  return (
    <div className="container py-8">
      <div className="mb-5">
        <BackButton label={t('back')} />
      </div>

      {/* Hero */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={skill.sourceType} />
            <VisibilityBadge visibility={skill.visibility} />
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
          {restrictedLocked ? (
            <AccessRequestPanel slug={skill.slug} state={requestState} loggedIn={Boolean(session?.user)} />
          ) : (
            <>
              <InstallSnippet slug={skill.slug} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>或</span>
                <a
                  href={session?.user ? `/api/skills/${skill.slug}/raw` : `/auth/login?callbackUrl=/skills/${skill.slug}`}
                  download={Boolean(session?.user)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:border-accent-500 hover:bg-accent-500/5 hover:text-accent-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-accent-400 dark:hover:bg-accent-500/10 dark:hover:text-accent-300"
                >
                  <Download className="h-3.5 w-3.5" />
                  下载技能包 (.zip)
                </a>
                <span className="font-mono text-[11px]">
                  解压到 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">~/.claude/skills/{skill.slug}/</code>
                </span>
              </div>
            </>
          )}
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
        <DetailTabs
          slug={skill.slug}
          current={tab}
          hasVersions={versionCount > 1}
          showComparison={showComparison}
          showManage={privileged}
          pendingCount={pendingCount}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_240px]">
        <article>
          {tab === 'overview' &&
            (overviewLeaksBody ? (
              <LockedNote />
            ) : skill.descriptionMd ? (
              <MarkdownRenderer content={skill.descriptionMd} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted">作者还没有为这个 skill 撰写使用指南。下面是简介：</p>
                <MarkdownRenderer content={skill.summary} />
              </div>
            ))}
          {tab === 'files' && (restrictedLocked ? <LockedNote /> : <FilesTab slug={skill.slug} />)}
          {tab === 'versions' && (restrictedLocked ? <LockedNote /> : <VersionsTab skillId={skill.id} />)}
          {tab === 'reviews' && <ReviewsTab skillId={skill.id} slug={skill.slug} />}
          {tab === 'composition' && (restrictedLocked ? <LockedNote /> : <CompositionTab skillId={skill.id} />)}
          {tab === 'comparison' && showComparison && (
            <ComparisonTab
              slug={skill.slug}
              privileged={privileged}
              comparison={comparison}
              stale={comparisonStale}
            />
          )}
          {tab === 'try_it' && (restrictedLocked ? <LockedNote /> : <ChatPanel slug={skill.slug} />)}
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

function LockedNote() {
  return (
    <div className="surface flex items-center gap-2 rounded-2xl border border-warn/30 p-4 text-sm text-muted">
      <Lock className="h-4 w-4 text-warn" />
      此内容为「受限下载」，申请并获得作者批准后即可查看。
    </div>
  );
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
