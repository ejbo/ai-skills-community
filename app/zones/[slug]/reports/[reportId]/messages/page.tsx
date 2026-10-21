import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { getReportMessages, parseMessageIds } from '@/lib/zones/reports/messages';
import { zoneHref } from '@/lib/zones/shared';
import { ReportMessages } from '@/app/zones/_components/reports/ReportMessages';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('report_messages_title') };
}

// 报告「看原文」页：?ids=m12,m13 → 这些原始消息（时间 / 发言人 / 原话 / 图片 / 引用）。
// 通常被帖子里的 ReportArticle 以 `page` 目标装进右侧 dock；直接打开也能看（canRead）。
export default async function ZoneReportMessagesPage({ params, searchParams }: { params: { slug: string; reportId: string }; searchParams: { ids?: string | string[] } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`/zones/${params.slug}/reports/${params.reportId}/messages`));
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  if (!access.canRead) redirect(zoneHref(zone.slug));
  const ids = parseMessageIds(searchParams.ids);
  const data = await getReportMessages(zone.id, params.reportId, ids, access.canSeeIdentity);
  if (!data) notFound();
  return (
    <div className="container max-w-3xl py-6">
      <ReportMessages subject={data.subject} messages={data.messages} requested={ids.length} />
    </div>
  );
}
