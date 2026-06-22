import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import { ExternalLink, Upload } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isLLMConfigured } from '@/lib/llm';
import { parseComparisonExample } from '@/lib/comparison';
import {
  getSkillAccessOverview,
  getSkillAnalytics,
  getSkillDownloaders,
} from '@/lib/skill-analytics';
import { TokenCostBadge } from '@/components/TokenCostBadge';
import { BackButton } from '@/components/BackButton';
import { SkillForm } from '@/app/skills/_components/SkillForm';
import { ComparisonStudio } from '../ComparisonStudio';
import { AccessSection, AnalyticsSection } from '../ManageTab';
import { ManageNav, type ManageSection } from './ManageNav';
import { VersionUploader } from './VersionUploader';
import { VersionActions } from './VersionActions';
import { DeleteSkillButton } from './DeleteSkillButton';

export const dynamic = 'force-dynamic';

const SECTIONS: ManageSection[] = ['overview', 'edit', 'versions', 'comparison', 'access', 'analytics'];

function triggersOf(payload: unknown): string[] {
  const t = (payload as { triggers?: unknown } | null)?.triggers;
  return Array.isArray(t) ? t.map(String) : [];
}

export default async function ManageSkillPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { section?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/skills/${params.slug}/manage`);

  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    include: {
      category: true,
      currentVersion: { select: { id: true, version: true, contentInline: true } },
      tags: { include: { tag: true } },
      _count: { select: { versions: true } },
    },
  });
  if (!skill || skill.deletedAt) notFound();
  if (skill.authorId !== session.user.id && !session.user.isAdmin) {
    redirect(`/skills/${params.slug}`);
  }

  const section: ManageSection = SECTIONS.includes(searchParams.section as ManageSection)
    ? (searchParams.section as ManageSection)
    : 'overview';

  const pendingCount = await prisma.skillAccessRequest.count({
    where: { skillId: skill.id, status: 'pending' },
  });

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4">
          <BackButton fallbackHref={`/skills/${skill.slug}`} />
        </div>
        <div className="text-xs text-muted">
          <Link href="/dashboard" className="hover:text-accent-600">
            我的面板
          </Link>{' '}
          / {skill.name}
        </div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {skill.name} <span className="text-muted">· 管理</span>
          </h1>
          <Link
            href={`/skills/${skill.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-accent-600 hover:text-accent-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            查看公开页
          </Link>
        </div>

        <div className="mt-5">
          <ManageNav slug={skill.slug} current={section} pendingCount={pendingCount} />
        </div>

        <div className="mt-6">
          {section === 'overview' && (
            <OverviewSection
              skill={skill}
              versionCount={skill._count.versions}
              currentVersion={skill.currentVersion?.version ?? null}
            />
          )}

          {section === 'edit' && (
            <EditSection
              slug={skill.slug}
              skill={skill}
              tags={skill.tags.map((t) => t.tag.name)}
              triggers={triggersOf(skill.structuredPayload)}
              skillMd={skill.currentVersion?.contentInline ?? ''}
            />
          )}

          {section === 'versions' && <VersionsSection slug={skill.slug} skillId={skill.id} currentVersionId={skill.currentVersionId} currentVersion={skill.currentVersion?.version ?? null} />}

          {section === 'comparison' && <ComparisonSectionLoader skillId={skill.id} slug={skill.slug} currentVersionId={skill.currentVersionId} />}

          {section === 'access' && <AccessSectionLoader skillId={skill.id} slug={skill.slug} />}

          {section === 'analytics' && <AnalyticsSectionLoader skillId={skill.id} />}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="surface rounded-xl p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-xl tabular-nums">{value}</div>
    </div>
  );
}

function OverviewSection({
  skill,
  versionCount,
  currentVersion,
}: {
  skill: {
    slug: string;
    status: string;
    visibility: string;
    downloadCount: number;
    likeCount: number;
    favoriteCount: number;
    subscriberCount: number;
    reviewCount: number;
    avgRating: number;
    tokenCostEstimate: number;
    updatedAt: Date;
  };
  versionCount: number;
  currentVersion: string | null;
}) {
  const statusLabel =
    skill.status === 'published' ? '已发布' : skill.status === 'draft' ? '草稿' : '已归档';
  const visLabel =
    skill.visibility === 'public' ? '公开' : skill.visibility === 'restricted' ? '受限' : '私密';
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="状态" value={statusLabel} />
        <StatCard label="可见性" value={visLabel} />
        <StatCard label="当前版本" value={currentVersion ? `v${currentVersion}` : '—'} />
        <StatCard label="版本数" value={versionCount} />
        <StatCard label="下载" value={skill.downloadCount.toLocaleString()} />
        <StatCard label="点赞" value={skill.likeCount.toLocaleString()} />
        <StatCard label="收藏" value={skill.favoriteCount.toLocaleString()} />
        <StatCard label="订阅" value={skill.subscriberCount.toLocaleString()} />
      </div>
      <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <TokenCostBadge tokens={skill.tokenCostEstimate} compact />
          <span>· 最后更新 {formatDistanceToNowStrict(skill.updatedAt, { addSuffix: true })}</span>
        </div>
        <Link
          href={`/skills/${skill.slug}/manage?section=versions`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
        >
          <Upload className="h-3.5 w-3.5" />
          上传新版本
        </Link>
      </div>
      <div className="rounded-2xl border border-danger/30 p-4">
        <h3 className="text-sm font-semibold text-danger">危险操作</h3>
        <p className="mt-1 text-xs text-muted">删除后该 Skill 会被移除，无法恢复。</p>
        <div className="mt-3">
          <DeleteSkillButton slug={skill.slug} />
        </div>
      </div>
    </div>
  );
}

async function EditSection({
  slug,
  skill,
  tags,
  triggers,
  skillMd,
}: {
  slug: string;
  skill: {
    name: string;
    summary: string;
    descriptionMd: string;
    categoryId: string | null;
    license: string | null;
    status: 'draft' | 'published' | 'archived';
    visibility: 'public' | 'restricted' | 'private';
    tokenCostEstimate: number;
  };
  tags: string[];
  triggers: string[];
  skillMd: string;
}) {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  });
  return (
    <SkillForm
      mode="edit"
      categories={categories}
      aiEnabled={isLLMConfigured()}
      initial={{
        slug,
        name: skill.name,
        summary: skill.summary,
        descriptionMd: skill.descriptionMd,
        categoryId: skill.categoryId,
        license: skill.license ?? 'MIT',
        status: skill.status,
        visibility: skill.visibility,
        tokenCostEstimate: skill.tokenCostEstimate,
        tags,
        triggers,
        skillMd,
      }}
    />
  );
}

async function VersionsSection({
  slug,
  skillId,
  currentVersionId,
  currentVersion,
}: {
  slug: string;
  skillId: string;
  currentVersionId: string | null;
  currentVersion: string | null;
}) {
  const versions = await prisma.skillVersion.findMany({
    where: { skillId },
    orderBy: [{ major: 'desc' }, { minor: 'desc' }, { patch: 'desc' }],
  });
  return (
    <div className="space-y-5">
      <div className="surface overflow-hidden rounded-2xl">
        <div className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-zinc-800">
          版本历史
        </div>
        {versions.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">还没有任何版本。</div>
        ) : (
          <ul>
            {versions.map((v) => {
              const isCurrent = v.id === currentVersionId;
              return (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-3 text-sm last:border-b-0 dark:border-zinc-800/60"
                >
                  <span className="font-mono font-semibold">v{v.version}</span>
                  {isCurrent && (
                    <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold text-accent-600 dark:text-accent-300">
                      当前
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      v.status === 'published'
                        ? 'bg-ok/15 text-ok'
                        : v.status === 'yanked'
                          ? 'bg-danger/15 text-danger'
                          : 'bg-warn/15 text-warn'
                    }`}
                  >
                    {v.status === 'published' ? '已发布' : v.status === 'yanked' ? '已撤回' : '草稿'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {v.changelogMd ? `「${v.changelogMd}」 · ` : ''}
                    {v.publishedAt
                      ? formatDistanceToNowStrict(v.publishedAt, { addSuffix: true })
                      : formatDistanceToNowStrict(v.createdAt, { addSuffix: true })}
                    {' · '}⬇ {v.downloadCount}
                  </span>
                  <VersionActions slug={slug} versionId={v.id} status={v.status} isCurrent={isCurrent} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="surface rounded-2xl p-4">
        <h3 className="mb-3 text-sm font-semibold">上传新版本</h3>
        <VersionUploader slug={slug} currentVersion={currentVersion} />
      </div>
    </div>
  );
}

async function ComparisonSectionLoader({
  skillId,
  slug,
  currentVersionId,
}: {
  skillId: string;
  slug: string;
  currentVersionId: string | null;
}) {
  const comparison = await prisma.skillComparison.findUnique({ where: { skillId } });
  const stale = Boolean(
    comparison &&
      comparison.generatedForVersionId &&
      comparison.generatedForVersionId !== currentVersionId,
  );
  return (
    <ComparisonStudio
      slug={slug}
      initial={{
        status: comparison?.status ?? null,
        bodyMd: comparison?.bodyMd ?? '',
        example: parseComparisonExample(comparison?.example),
        guidancePrompt: comparison?.guidancePrompt ?? '',
        model: comparison?.model ?? null,
        stale,
      }}
    />
  );
}

async function AccessSectionLoader({ skillId, slug }: { skillId: string; slug: string }) {
  const overview = await getSkillAccessOverview(skillId);
  return <AccessSection overview={overview} slug={slug} />;
}

async function AnalyticsSectionLoader({ skillId }: { skillId: string }) {
  const [analytics, downloaders] = await Promise.all([
    getSkillAnalytics(skillId),
    getSkillDownloaders(skillId, 100),
  ]);
  return <AnalyticsSection analytics={analytics} downloaders={downloaders} />;
}
