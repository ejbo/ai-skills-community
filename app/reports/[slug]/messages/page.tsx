import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { domainViewer } from '@/lib/permissions';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getReportMessages, parseMessageIds } from '@/lib/zones/reports/messages';
import { resolveReportParam } from '@/lib/zones/reports/resolve';
import { canSeeReport } from '@/lib/zones/reports/visibility';
import { ReportMessages } from '@/components/reports/ReportMessages';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('report_messages_title') };
}

// 「看原文」：?ids=m12,m13 → 原始消息。闸门同分享页（canSeeReport，含「已分享的帖子对你可见」）。
// 通常被 ReportArticle 以 page 目标装进右侧 dock；直接打开也能看。
export default async function ReportMessagesPage({ params, searchParams }: { params: { slug: string }; searchParams: { ids?: string | string[] } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`/reports/${params.slug}/messages`));
  const row = await resolveReportParam(params.slug);
  if (!row) notFound();
  if (!(await canSeeReport(row, domainViewer(session.user, 'zones'), zoneSiteViewer(session.user)))) notFound();
  const ids = parseMessageIds(searchParams.ids);
  const data = await getReportMessages(row.id, ids, zoneSiteViewer(session.user).canSeeIdentity);
  if (!data) notFound();
  return (
    <div className="container max-w-3xl py-6">
      <ReportMessages subject={data.subject} messages={data.messages} requested={ids.length} />
    </div>
  );
}
