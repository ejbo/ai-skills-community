import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Upload } from 'lucide-react';
import { relativeTime } from '@/lib/i18n-date';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { isLLMConfigured } from '@/lib/llm';
import { parseComparisonExample } from '@/lib/comparison';
import {
  getSkillAccessOverview,
  getSkillAnalytics,
  getSkillDownloaders,
} from '@/lib/skill-analytics';
import { TokenCostBadge } from '@/components/TokenCostBadge';
import { SkillForm } from '@/app/skills/_components/SkillForm';
import { ComparisonStudio } from '../ComparisonStudio';
import { AccessSection, AnalyticsSection } from '../ManageTab';
import { ManageNav, type ManageSection } from './ManageNav';
import { VersionUploader } from './VersionUploader';
import { VersionActions } from './VersionActions';
import { DeleteSkillButton } from './DeleteSkillButton';

export const SECTIONS: ManageSection[] = ['overview', 'edit', 'versions', 'comparison', 'access', 'analytics'];

export function coerceSection(raw: string | undefined): ManageSection {
  return SECTIONS.includes(raw as ManageSection) ? (raw as ManageSection) : 'overview';
}

function triggersOf(payload: unknown): string[] {
  const raw = (payload as { triggers?: unknown } | null)?.triggers;
  return Array.isArray(raw) ? raw.map(String) : [];
}

/**
 * The full skill-management UI (nav + sections). Self-contained: it fetches its own data,
 * so it can be dropped into BOTH the standalone /skills/[slug]/manage page and inline on the
 * skill detail page's "Manage" tab. The CALLER is responsible for authorization (author/admin).
 * `inline` switches the sub-nav links between the standalone page and `?tab=manage&section=…`.
 */
export async function ManagePanel({
  slug,
  section,
  inline = false,
}: {
  slug: string;
  section: ManageSection;
  inline?: boolean;
}) {
  const skill = await prisma.skill.findUnique({
    where: { slug },
    include: {
      category: true,
      currentVersion: { select: { id: true, version: true, contentInline: true } },
      tags: { include: { tag: true } },
      _count: { select: { versions: true } },
    },
  });
  if (!skill || skill.deletedAt) notFound();

  const pendingCount = await prisma.skillAccessRequest.count({
    where: { skillId: skill.id, status: 'pending' },
  });

  return (
    <div>
      <ManageNav slug={slug} current={section} pendingCount={pendingCount} inline={inline} />
      <div className="mt-6">
        {section === 'overview' && (
          <OverviewSection skill={skill} versionCount={skill._count.versions} currentVersion={skill.currentVersion?.version ?? null} inline={inline} />
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
        {section === 'versions' && (
          <VersionsSection slug={skill.slug} skillId={skill.id} currentVersionId={skill.currentVersionId} currentVersion={skill.currentVersion?.version ?? null} />
        )}
        {section === 'comparison' && <ComparisonSectionLoader skillId={skill.id} slug={skill.slug} currentVersionId={skill.currentVersionId} />}
        {section === 'access' && <AccessSectionLoader skillId={skill.id} slug={skill.slug} />}
        {section === 'analytics' && <AnalyticsSectionLoader skillId={skill.id} />}
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

async function OverviewSection({
  skill,
  versionCount,
  currentVersion,
  inline,
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
  inline: boolean;
}) {
  const t = await getTranslations('skill_manage');
  const tl = await getTranslations('labels');
  const td = await getTranslations('detail');
  const locale = await getLocale();
  const statusLabel = tl(`skillStatus.${skill.status === 'published' || skill.status === 'draft' ? skill.status : 'archived'}`);
  const visLabel = tl(`visibility.${skill.visibility === 'public' || skill.visibility === 'restricted' ? skill.visibility : 'private'}`);
  const versionsHref = inline ? `/skills/${skill.slug}?tab=manage&section=versions` : `/skills/${skill.slug}/manage?section=versions`;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label={t('status')} value={statusLabel} />
        <StatCard label={t('visibility')} value={visLabel} />
        <StatCard label={t('current_version')} value={currentVersion ? `v${currentVersion}` : '—'} />
        <StatCard label={t('version_count')} value={versionCount} />
        <StatCard label={td('downloads')} value={skill.downloadCount.toLocaleString()} />
        <StatCard label={t('likes')} value={skill.likeCount.toLocaleString()} />
        <StatCard label={t('favorites')} value={skill.favoriteCount.toLocaleString()} />
        <StatCard label={t('subscribers')} value={skill.subscriberCount.toLocaleString()} />
      </div>
      <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <TokenCostBadge tokens={skill.tokenCostEstimate} compact />
          <span>· {t('last_updated', { time: relativeTime(skill.updatedAt, locale) })}</span>
        </div>
        <Link
          href={versionsHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
        >
          <Upload className="h-3.5 w-3.5" />
          {t('upload_new_version')}
        </Link>
      </div>
      <div className="rounded-2xl border border-danger/30 p-4">
        <h3 className="text-sm font-semibold text-danger">{t('danger_zone')}</h3>
        <p className="mt-1 text-xs text-muted">{t('delete_warning')}</p>
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
    sourceType: 'internal' | 'external' | 'curated';
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
        sourceType: skill.sourceType,
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
  const t = await getTranslations('skill_manage');
  const tl = await getTranslations('labels');
  const locale = await getLocale();
  return (
    <div className="space-y-5">
      <div className="surface overflow-hidden rounded-2xl">
        <div className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-zinc-800">{t('version_history')}</div>
        {versions.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">{t('no_versions')}</div>
        ) : (
          <ul>
            {versions.map((v) => {
              const isCurrent = v.id === currentVersionId;
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-3 text-sm last:border-b-0 dark:border-zinc-800/60">
                  <span className="font-mono font-semibold">v{v.version}</span>
                  {isCurrent && (
                    <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold text-accent-600 dark:text-accent-300">{t('badge_current')}</span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      v.status === 'published' ? 'bg-ok/15 text-ok' : v.status === 'yanked' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'
                    }`}
                  >
                    {v.status === 'published' ? tl('skillStatus.published') : v.status === 'yanked' ? t('version_yanked') : tl('skillStatus.draft')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {v.changelogMd ? `「${v.changelogMd}」 · ` : ''}
                    {relativeTime(v.publishedAt ?? v.createdAt, locale)}
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
        <h3 className="mb-3 text-sm font-semibold">{t('upload_new_version')}</h3>
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
    comparison && comparison.generatedForVersionId && comparison.generatedForVersionId !== currentVersionId,
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
  const [session, overview] = await Promise.all([auth(), getSkillAccessOverview(skillId)]);
  return (
    <AccessSection overview={overview} slug={slug} viewerCanSeeIdentity={can(session?.user, 'identity')} />
  );
}

async function AnalyticsSectionLoader({ skillId }: { skillId: string }) {
  const [session, analytics, downloaders] = await Promise.all([
    auth(),
    getSkillAnalytics(skillId),
    getSkillDownloaders(skillId, 100),
  ]);
  return (
    <AnalyticsSection
      analytics={analytics}
      downloaders={downloaders}
      viewerCanSeeIdentity={can(session?.user, 'identity')}
    />
  );
}
