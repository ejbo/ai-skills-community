import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canAccessSkillContent } from '@/lib/access';
import { RemixEditor } from './RemixEditor';

export const dynamic = 'force-dynamic';

export default async function RemixPage({ params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/skills/${params.slug}/remix`);

  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    include: {
      currentVersion: true,
      category: { select: { id: true } },
    },
  });
  if (!skill || skill.deletedAt || skill.status !== 'published') notFound();

  // You can only remix content you can actually read — otherwise this server
  // component would hand a restricted skill's gated body to the client.
  const actor = { id: session.user.id, isAdmin: session.user.isAdmin };
  let grantStatus: string | null = null;
  if (skill.visibility === 'restricted' && actor.id !== skill.authorId && !actor.isAdmin) {
    const g = await prisma.skillAccessRequest.findUnique({
      where: { skillId_userId: { skillId: skill.id, userId: actor.id } },
      select: { status: true },
    });
    grantStatus = g?.status ?? null;
  }
  if (!canAccessSkillContent(skill, actor, grantStatus as never).canContent) {
    redirect(`/skills/${params.slug}`);
  }

  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  });

  const t = await getTranslations('skill_compare');

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-semibold tracking-tight">{t('remix_page_title')}</h1>
        <p className="mt-1 text-sm text-muted">
          {t.rich('remix_page_subtitle', {
            name: skill.name,
            strong: (chunks) => <span className="font-medium">{chunks}</span>,
          })}
        </p>
        <div className="mt-6">
          <RemixEditor
            source={{
              slug: skill.slug,
              name: skill.name,
              summary: skill.summary,
              descriptionMd: skill.descriptionMd,
              bodyMd: skill.currentVersion?.contentInline ?? '',
              categoryId: skill.category?.id ?? null,
              license: skill.license ?? 'MIT',
              tokenCostEstimate: skill.tokenCostEstimate,
            }}
            categories={categories}
          />
        </div>
      </div>
    </div>
  );
}
