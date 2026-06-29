import { prisma } from '@/lib/db';
import { AnnouncementEditor, type AnnouncementRow } from './AnnouncementEditor';
import { EmailTestPanel } from './EmailTestPanel';

export const dynamic = 'force-dynamic';

export default async function AnnouncementsAdminPage() {
  const rows = await prisma.announcement.findMany({
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { displayName: true } } },
  });

  const announcements: AnnouncementRow[] = rows.map((a) => ({
    id: a.id,
    title: a.title,
    bodyMd: a.bodyMd,
    published: a.publishedAt !== null,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    author: a.createdBy.displayName,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">公告</h2>
        <p className="mt-1 text-sm text-muted">发布更新公告，会同步到所有用户的通知中心（并按用户的邮件偏好发送邮件）。</p>
      </div>
      <EmailTestPanel />
      <AnnouncementEditor announcements={announcements} />
    </div>
  );
}
