import { notFound } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { format } from 'date-fns';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { BackButton } from '@/components/BackButton';

export const dynamic = 'force-dynamic';

export default async function AnnouncementPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const a = await prisma.announcement.findUnique({
    where: { id: params.id },
    include: { createdBy: { select: { displayName: true } } },
  });
  // Drafts are visible to admins only; everyone else (and missing ids) 404.
  if (!a || (a.publishedAt === null && !session?.user?.isAdmin)) notFound();

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-5">
        <BackButton label="返回" />
      </div>
      <article className="space-y-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent-600">
          <Megaphone className="h-4 w-4" />
          公告
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{a.title}</h1>
        <div className="text-sm text-muted">
          {a.createdBy.displayName}
          {a.publishedAt && <> · {format(a.publishedAt, 'yyyy-MM-dd HH:mm')}</>}
          {a.publishedAt === null && <> · 草稿（仅管理员可见）</>}
        </div>
        <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
          <MarkdownRenderer content={a.bodyMd} />
        </div>
      </article>
    </div>
  );
}
