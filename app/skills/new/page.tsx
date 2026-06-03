import { redirect } from 'next/navigation';
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

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-semibold tracking-tight">上传 Skill</h1>
        <p className="mt-1 text-sm text-muted">
          拖入你的 SKILL.md（单文件、多文件或 .zip 均可），AI 会帮你补全元信息。
        </p>
        <div className="mt-6">
          <SkillForm mode="create" categories={categories} aiEnabled={isLLMConfigured()} />
        </div>
      </div>
    </div>
  );
}
