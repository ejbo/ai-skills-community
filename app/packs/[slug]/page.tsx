import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Boxes, Download, Layers, Pencil } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { relativeTime } from '@/lib/i18n-date';
import { auth } from '@/lib/auth';
import { getPackBySlug } from '@/lib/pack-queries';
import { InstallSnippet } from '@/components/InstallSnippet';
import { withBasePath } from '@/lib/base-path';
import { isIconImage } from '@/lib/pack-icon';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { BackButton } from '@/components/BackButton';
import { SkillCard } from '@/components/SkillCard';

export const dynamic = 'force-dynamic';

export default async function PackDetailPage({ params }: { params: { slug: string } }) {
  const pack = await getPackBySlug(params.slug);
  if (!pack) notFound();

  // Draft packs are admin-preview only (mirrors how draft skills behave).
  const session = await auth();
  const isAdmin = Boolean(session?.user?.isAdmin);
  if (!pack.isPublished && !isAdmin) notFound();

  const skills = pack.items.map((i) => i.skill);
  const t = await getTranslations('skills_misc');
  const tb = await getTranslations('browse');
  const tn = await getTranslations('nav');
  const tu = await getTranslations('ui');
  const locale = await getLocale();

  return (
    <div className="container py-8">
      <div className="mb-5">
        <BackButton fallbackHref="/skills?source=packs" />
      </div>

      <section className="space-y-5">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300">
              <Boxes className="h-3 w-3" />
              {tb('packs')}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-muted dark:border-zinc-800">
              <Layers className="h-3 w-3" />
              {tu('pack_skill_count', { count: skills.length })}
            </span>
            {!pack.isPublished && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                {t('pack_draft_admin_only')}
              </span>
            )}
            {isAdmin && (
              <Link
                href="/manage/packs"
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-muted transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-800"
              >
                <Pencil className="h-3 w-3" />
                {tn('manage')}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            {pack.icon &&
              (isIconImage(pack.icon) ? (
                <img
                  src={withBasePath(pack.icon)}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <span className="shrink-0 text-4xl leading-none">{pack.icon}</span>
              ))}
            <h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight md:text-4xl">
              {pack.name}
            </h1>
          </div>
          {pack.summary && <p className="text-lg text-muted">{pack.summary}</p>}

          {skills.length > 0 && (
            <>
              <InstallSnippet slug={`pack:${pack.slug}`} />
              <p className="text-xs text-muted">{t('pack_install_note', { count: skills.length })}</p>
            </>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
            <span className="flex items-center gap-1 font-mono tabular-nums">
              <Download className="h-3.5 w-3.5" />
              {tu('pack_install_count', { count: pack.installCount })}
            </span>
            <span>{t('pack_updated_at', { time: relativeTime(pack.updatedAt, locale) })}</span>
          </div>
        </div>

        {pack.descriptionMd && (
          <div className="surface rounded-2xl p-5">
            <MarkdownRenderer content={pack.descriptionMd} />
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">{t('pack_included_skills')}</h2>
          {skills.length === 0 ? (
            <p className="text-sm text-muted">{t('pack_empty')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {skills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  slug={skill.slug}
                  name={skill.name}
                  summary={skill.summary}
                  sourceType={skill.sourceType}
                  visibility={skill.visibility}
                  author={skill.author}
                  updatedAt={skill.updatedAt}
                  stats={{
                    downloads: skill.downloadCount,
                    likes: skill.likeCount,
                    rating: skill.avgRating,
                    reviewCount: skill.reviewCount,
                    tokens: skill.tokenCostEstimate,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
