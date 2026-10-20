import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { listZoneColumns } from '@/lib/zones/columns';
import { getZoneReportDetail } from '@/lib/zones/reports/queries';
import { zoneHref } from '@/lib/zones/shared';
import { ReportDetail } from '@/app/zones/_components/reports/ReportDetail';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('reports_title') };
}

// 报告进度 / 预览 / 发布页（canRead 看；发布 = canPost 且是创建者或版主，由 API 再把关）。
export default async function ZoneReportPage({ params }: { params: { slug: string; reportId: string } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`/zones/${params.slug}/reports/${params.reportId}`));
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  if (!access.canRead) redirect(zoneHref(zone.slug));
  const [report, columns] = await Promise.all([getZoneReportDetail(zone.id, params.reportId, viewer.id, access.canSeeIdentity), listZoneColumns(zone.id)]);
  if (!report) notFound();
  const canPublish = access.canPost && (report.isMine || access.canModerate);
  return (
    <div className="container max-w-5xl py-8">
      <ReportDetail zoneSlug={zone.slug} initial={report} columns={columns} currentUserId={session.user.id} canPublish={canPublish} canModerate={access.canModerate} />
    </div>
  );
}
