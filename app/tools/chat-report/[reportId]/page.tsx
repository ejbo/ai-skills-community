import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { domainViewer } from '@/lib/permissions';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getReportDetail } from '@/lib/zones/reports/queries';
import { canSeeReport, isReportOwner, REPORT_GATE_SELECT } from '@/lib/zones/reports/visibility';
import { prisma } from '@/lib/db';
import { ReportDetail } from '@/components/reports/ReportDetail';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tools');
  return { title: t('chat_report_title') };
}

// 报告详情：进度 / 预览 / 导出 / 分享页设置 / 分享到版块（所有者）；能看分享页的人也能进来看预览与导出。
export default async function ChatReportDetailPage({ params }: { params: { reportId: string } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`/tools/chat-report/${params.reportId}`));
  const viewer = domainViewer(session.user, 'zones');
  const siteViewer = zoneSiteViewer(session.user);
  const gate = await prisma.zoneReport.findUnique({ where: { id: params.reportId }, select: REPORT_GATE_SELECT });
  if (!gate || !(await canSeeReport(gate, viewer, siteViewer))) notFound();
  const owner = isReportOwner(gate, viewer);
  const report = await getReportDetail(gate.id, session.user.id, siteViewer.canSeeIdentity, { withAudience: owner });
  if (!report) notFound();
  return (
    <div className="container max-w-6xl py-8">
      <ReportDetail initial={report} currentUser={{ id: session.user.id, handle: session.user.handle ?? null }} isOwner={owner} />
    </div>
  );
}
