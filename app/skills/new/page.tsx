import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { UploadWizard } from './UploadWizard';

export default async function NewSkillPage() {
  const session = await auth();
  if (!session?.user) redirect('/auth/login?callbackUrl=/skills/new');

  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true },
  });

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">上传 Skill</h1>
        <p className="mt-1 text-sm text-muted">
          用表单填写，或者直接拖拽你的 SKILL.md zip 包。
        </p>
        <div className="mt-6">
          <UploadWizard
            categories={categories}
            canPublishInternal={Boolean(session.user.isAdmin)}
          />
        </div>
      </div>
    </div>
  );
}
