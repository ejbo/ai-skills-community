import { notFound } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { format } from 'date-fns';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { BackButton } from '@/components/BackButton';

export const dynamic = 'force-dynamic';

export default async function AnnouncementPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('announcements');
  const session = await auth();
  const a = await prisma.announcement.findUnique({
    where: { id: params.id },
    include: { createdBy: { select: { displayName: true } } },
  });
  // Drafts are visible to 公告 managers (`announcements` permission) only; everyone else (and missing ids) 404.
  if (!a || (a.publishedAt === null && !can(session?.user, 'announcements'))) notFound();

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-5">
        <BackButton label={t('back')} />
      </div>
      <article className="space-y-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">
          <Megaphone className="h-4 w-4" />
          {t('kicker')}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{a.title}</h1>
        <div className="text-sm text-muted">
          {a.createdBy.displayName}
          {a.publishedAt && <> · {format(a.publishedAt, 'yyyy-MM-dd HH:mm')}</>}
          {a.publishedAt === null && <> · {t('draft_admin_only')}</>}
        </div>
        <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
          <MarkdownRenderer content={a.bodyMd} />
        </div>
      </article>
    </div>
  );
}
