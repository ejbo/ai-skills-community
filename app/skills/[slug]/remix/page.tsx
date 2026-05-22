import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
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

  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  });

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-semibold tracking-tight">Remix Skill</h1>
        <p className="mt-1 text-sm text-muted">
          基于 <span className="font-medium">{skill.name}</span> fork 出一份属于你自己的版本，可以自由修改后重新发布。
        </p>
        <div className="mt-6">
          <RemixEditor
            source={{
              slug: skill.slug,
              name: skill.name,
              summary: skill.summary,
              descriptionMd: skill.descriptionMd,
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
