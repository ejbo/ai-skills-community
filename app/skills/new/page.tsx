import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isLLMConfigured } from '@/lib/llm';
import { SkillForm } from '@/app/skills/_components/SkillForm';

export default async function NewSkillPage() {
  const session = await auth();
  if (!session?.user) redirect('/auth/login?callbackUrl=/skills/new');

  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  });

  const t = await getTranslations('skills_misc');
  const tUp = await getTranslations('upload');

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-semibold tracking-tight">{tUp('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('new_skill_subtitle')}</p>
        <div className="mt-6">
          <SkillForm mode="create" categories={categories} aiEnabled={isLLMConfigured()} />
        </div>
      </div>
    </div>
  );
}
