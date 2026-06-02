import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { EditForm } from './EditForm';

export const dynamic = 'force-dynamic';

export default async function EditSkillPage({ params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/skills/${params.slug}/edit`);

  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
  });
  if (!skill || skill.deletedAt) notFound();
  if (skill.authorId !== session.user.id && !session.user.isAdmin) {
    redirect(`/skills/${params.slug}`);
  }

  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  });

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">编辑 Skill</h1>
        <p className="mt-1 text-sm text-muted">{skill.name}</p>
        <div className="mt-6">
          <EditForm
            skill={{
              slug: skill.slug,
              name: skill.name,
              summary: skill.summary,
              descriptionMd: skill.descriptionMd,
              categoryId: skill.categoryId,
              license: skill.license ?? 'MIT',
              status: skill.status,
              visibility: skill.visibility,
              tokenCostEstimate: skill.tokenCostEstimate,
            }}
            categories={categories}
          />
        </div>
      </div>
    </div>
  );
}
