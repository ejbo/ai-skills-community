import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Bell, GitFork, Heart, Star, Calendar, Tag as TagIcon, ExternalLink, Download, Lock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { relativeTime } from '@/lib/i18n-date';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getSkillBySlug } from '@/lib/skill-queries';
import { prisma } from '@/lib/db';
import { canAccessSkillContent } from '@/lib/access';
import { SourceBadge } from '@/components/SourceBadge';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { InstallSnippet } from '@/components/InstallSnippet';
import { TokenCostBadge } from '@/components/TokenCostBadge';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { BackButton } from '@/components/BackButton';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { toPublicAuthor } from '@/lib/user-identity';
import { DetailTabs } from './DetailTabs';
import { ActionButtons } from './ActionButtons';
import { ReviewsTab } from './ReviewsTab';
import { ChatPanel } from './ChatPanel';
import { ComparisonTab } from './ComparisonTab';
import { CompositionTab } from './CompositionTab';
import { AccessRequestPanel, type RequestState } from './AccessRequestPanel';
import { DownloadButton } from './DownloadButton';
import { FilesTab } from './FilesTab';
import { ManagePanel, coerceSection } from './manage/ManagePanel';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
  searchParams: { tab?: string; section?: string };
}

export default async function SkillDetailPage({ params, searchParams }: PageProps) {
  const skill = await getSkillBySlug(params.slug);
  if (!skill || skill.deletedAt) notFound();

  const session = await auth();
  const actor = session?.user
    ? {
        id: session.user.id,
        roleKey: session.user.roleKey,
        permissions: session.user.permissions,
        via: 'session' as const,
        scopes: null,
      }
    : null;
  // The "Manage" tab is for the skill's OWNER only (admins use the admin panel).
  const isAuthor = actor?.id === skill.authorId;

  // Viewer's grant status for restricted skills.
  let grantStatus: string | null = null;
  if (actor && skill.visibility === 'restricted' && actor.id !== skill.authorId && !can(actor, 'skills')) {
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

  // 隐私账号：department/lab trimmed server-side before rendering.
  const author = toPublicAuthor(skill.author, can(session?.user, 'identity'));

  const t = await getTranslations('detail');
  const ts = await getTranslations('skill_detail');
  const locale = await getLocale();
  const rawTab = (searchParams.tab as 'overview' | 'files' | 'versions' | 'reviews' | 'composition' | 'comparison' | 'playground' | 'manage') ?? 'overview';

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
  const showComparison = privileged || (hasPublishedComparison && !restrictedLocked);

  // `manage` renders inline (the ManagePanel) for the author; everyone else falls to overview.
  const tab =
    (rawTab === 'manage' && !isAuthor) || (rawTab === 'comparison' && !showComparison)
      ? 'overview'
      : rawTab;

  return (
    <div className="container py-8">
      <div className="mb-5">
        <BackButton label={t('back')} />
      </div>

      {/* Hero — single column; author + stats moved in from the old right sidebar. */}
      <section className="space-y-5">
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
                <span>{ts('or')}</span>
                {session?.user ? (
                  <DownloadButton
                    slug={skill.slug}
                    version={skill.currentVersion?.version}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-900/10 dark:hover:bg-white/[0.14] hover:text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:text-zinc-50"
                  />
                ) : (
                  <a
                    href={`/auth/login?callbackUrl=/skills/${skill.slug}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-900/10 dark:hover:bg-white/[0.14] hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:text-zinc-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {ts('download_zip')}
                  </a>
                )}
                <span className="font-mono text-[11px]">
                  {ts('unzip_to')}{' '}
                  <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">~/.claude/skills/{skill.slug}/</code>
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
        <div className="surface space-y-4 rounded-2xl p-4 text-sm">
          {/* Author identity + stats share one horizontal row; author pinned far-left. */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href={`/users/${author.handle}`}
              className="flex min-w-0 items-center gap-2.5 border-zinc-200 pr-6 transition hover:opacity-80 dark:border-zinc-800 sm:border-r"
            >
              <Avatar name={author.displayName} src={author.avatarUrl} size="md" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{author.displayName}</div>
                {!author.isPrivate && <div className="truncate text-xs text-muted">@{author.handle}</div>}
                <DeptTag department={author.department} lab={author.lab} className="mt-0.5" />
              </div>
            </Link>
            <StatBlock label={t('downloads')} value={skill.downloadCount.toLocaleString()} icon={<Download className="h-3.5 w-3.5" />} />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Token</div>
              <div className="mt-0.5">
                <TokenCostBadge tokens={skill.tokenCostEstimate} compact />
              </div>
            </div>
              <StatBlock label={t('subscribers')} value={skill.subscriberCount.toLocaleString()} icon={<Bell className="h-3.5 w-3.5" />} />
              <StatBlock label={t('like')} value={skill.likeCount.toLocaleString()} icon={<Heart className="h-3.5 w-3.5" />} />
              <StatBlock
                label={ts('rating')}
                value={skill.avgRating > 0 ? `${skill.avgRating.toFixed(1)} (${skill.reviewCount})` : '—'}
                icon={<Star className="h-3.5 w-3.5" />}
              />
              <StatBlock
                label={t('last_published')}
                value={
                  skill.currentVersion?.publishedAt
                    ? relativeTime(skill.currentVersion.publishedAt, locale)
                    : '—'
                }
                icon={<Calendar className="h-3.5 w-3.5" />}
              />
              {skill.license && (
                <StatBlock label={t('license')} value={skill.license} icon={<span className="font-mono text-[10px]">©</span>} />
              )}
            </div>
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
            {skill.externalSourceUrl && (
              <a
                href={skill.externalSourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-900 dark:text-zinc-50 hover:text-zinc-900"
              >
                <ExternalLink className="h-3 w-3" />
                {ts('view_upstream')}
              </a>
            )}
            {skill.forkedFrom && (
              <div className="text-xs">
                <span className="text-muted">{ts('forked_from')} </span>
                <Link href={`/skills/${skill.forkedFrom.slug}`} className="text-zinc-900 dark:text-zinc-50 hover:underline">
                  {skill.forkedFrom.name}
                </Link>
              </div>
            )}
            {skill._count.forks > 0 && (
              <div className="text-xs text-muted">
                {ts.rich('remixed_count', {
                  count: skill._count.forks,
                  num: (chunks) => <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">{chunks}</span>,
                })}
                <GitFork className="ml-1 inline h-3 w-3 text-muted" />
              </div>
            )}
          </div>
        </section>

      {/* Tabs */}
      <div className="mt-8">
        <DetailTabs
          slug={skill.slug}
          current={tab}
          hasVersions={versionCount > 1}
          showComparison={showComparison}
          showManage={isAuthor}
          pendingCount={pendingCount}
        />
      </div>

      <div className="mt-6">
        <article>
          {tab === 'overview' &&
            (overviewLeaksBody ? (
              <LockedNote />
            ) : skill.descriptionMd ? (
              <MarkdownRenderer content={skill.descriptionMd} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted">{ts('no_guide')}</p>
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
            />
          )}
          {tab === 'playground' && (restrictedLocked ? <LockedNote /> : <ChatPanel slug={skill.slug} />)}
          {tab === 'manage' && isAuthor && (
            <ManagePanel slug={skill.slug} section={coerceSection(searchParams.section)} inline />
          )}
        </article>
      </div>
    </div>
  );
}

async function LockedNote() {
  const ts = await getTranslations('skill_detail');
  return (
    <div className="surface flex items-center gap-2 rounded-2xl border border-warn/30 p-4 text-sm text-muted">
      <Lock className="h-4 w-4 text-warn" />
      {ts('locked_note')}
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
  const ts = await getTranslations('skill_detail');
  const locale = await getLocale();
  const versions = await prisma.skillVersion.findMany({
    where: { skillId, status: { in: ['published', 'yanked'] } },
    orderBy: [{ major: 'desc' }, { minor: 'desc' }, { patch: 'desc' }],
  });
  if (versions.length === 0) {
    return <div className="text-sm text-muted">{ts('no_versions')}</div>;
  }
  return (
    <ul className="space-y-3">
      {versions.map((v) => (
        <li key={v.id} className="surface rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="rounded bg-zinc-900/[0.06] dark:bg-white/10 px-2 py-0.5 font-mono text-xs text-zinc-900 dark:text-zinc-50">
                v{v.version}
              </span>
              {v.publishedAt && (
                <span className="text-xs text-muted">
                  {relativeTime(v.publishedAt, locale)}
                </span>
              )}
              {v.status === 'yanked' && (
                <span className="text-xs text-warn">{ts('yanked')}</span>
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
