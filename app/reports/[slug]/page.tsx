import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Settings2 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { domainViewer } from '@/lib/permissions';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getReportDetail } from '@/lib/zones/reports/queries';
import { resolveReportParam } from '@/lib/zones/reports/resolve';
import { canSeeReport, isReportOwner } from '@/lib/zones/reports/visibility';
import { zonePostHref } from '@/lib/zones/shared';
import type { ZonePostReportView } from '@/lib/zones/types';
import { Avatar } from '@/components/Avatar';
import { VisibilityBadge } from '@/components/audience/VisibilityBadge';
import { ReportArticle } from '@/components/reports/ReportArticle';
import { ReportMeta, ReportReader } from '@/components/reports/report-view';
import { RelTime } from '@/app/zones/_components/RelTime';
import { BTN_SECONDARY } from '@/app/zones/_components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const t = await getTranslations('tools');
  const row = await resolveReportParam(params.slug);
  if (!row) return { title: t('chat_report_title') };
  const session = await auth();
  if (!session?.user) return { title: t('chat_report_title') };
  const detail = await getReportDetail(row.id, session.user.id, false);
  return { title: detail?.title ?? t('chat_report_title') };
}

// /reports/[slug] — 报告的独立分享页（docs/contracts/reports.md §3b）：canSeeReport 闸门，
// 原生 ReportArticle + 右栏（ReportReader）；标题下是 类型 · 起止 · 统计（不放标签）；所有者看到「设置」入口（回工具详情页）。
export default async function ReportSharePage({ params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`/reports/${params.slug}`));
  const row = await resolveReportParam(params.slug);
  if (!row) notFound();
  const viewer = domainViewer(session.user, 'zones');
  const siteViewer = zoneSiteViewer(session.user);
  if (!(await canSeeReport(row, viewer, siteViewer))) notFound();
  if (row.needsRedirect && row.slug) permanentRedirect(`/reports/${encodeURIComponent(row.slug)}`);
  const detail = await getReportDetail(row.id, session.user.id, siteViewer.canSeeIdentity);
  if (!detail || !detail.report) notFound();
  const t = await getTranslations('tools');
  const tz = await getTranslations('zones');
  const r = detail.report;
  const speakers: ZonePostReportView['speakers'] = {};
  for (const m of detail.authorMatches) if (m.user) speakers[m.account.toLowerCase()] = m.user;
  const librarySlugs: Record<string, string> = {};
  for (const a of detail.assets) if (a.libraryDoc) librarySlugs[a.name] = a.libraryDoc.slug;
  const urlByKey = new Map(detail.assets.map((a) => [a.key, a.url]));
  const assetUrls: Record<string, string> = {};
  for (const a of r.attachments) if (a.assetKey && urlByKey.has(a.assetKey)) assetUrls[a.id] = urlByKey.get(a.assetKey)!;
  const view: ZonePostReportView = { id: detail.id, slug: detail.slug, report: r, speakers, librarySlugs, assetUrls };
  const owner = isReportOwner(row, viewer);
  const base = `/reports/${encodeURIComponent(detail.slug ?? detail.id)}`;

  const rail = (
    <section className="space-y-2 text-sm">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{tz('rail_strip_authors')}</h3>
      <div className="flex items-center gap-2">
        <Avatar name={detail.createdBy.displayName} src={detail.createdBy.avatarUrl} size="xs" handle={detail.createdBy.handle} />
        <span className="truncate font-medium">{detail.createdBy.displayName}</span>
      </div>
      {detail.post?.coauthors.map(({ userId, user: a }) => (
        <div key={userId} className="flex items-center gap-2">
          <Avatar name={a.displayName} src={a.avatarUrl} size="xs" handle={a.handle} />
          <span className="truncate font-medium">{a.displayName}</span>
        </div>
      ))}
      {detail.post && (
        <Link href={zonePostHref(detail.post.zoneSlug, detail.post)} className="block text-xs text-muted underline-offset-2 hover:underline">
          {t('report_shared_in', { zone: detail.post.zoneName })}
        </Link>
      )}
    </section>
  );

  return (
    <div className="container max-w-6xl py-8">
      <ReportReader report={r} rail={rail}>
        <header className="mb-8 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 text-3xl font-semibold leading-tight tracking-tight">{detail.title}</h1>
            {owner && (
              <Link href={`/tools/chat-report/${detail.id}`} className={BTN_SECONDARY}>
                <Settings2 className="h-4 w-4" />
                {t('report_manage')}
              </Link>
            )}
          </div>
          <ReportMeta report={r} className="text-[13px]" />
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Avatar name={detail.createdBy.displayName} src={detail.createdBy.avatarUrl} size="xs" handle={detail.createdBy.handle} />
            <span>{detail.createdBy.displayName}</span>
            <span>·</span>
            <RelTime at={detail.createdAt} />
            {owner && <VisibilityBadge visibility={detail.visibility} />}
          </p>
        </header>
        <ReportArticle originalsHref={`${base}/messages`} view={view} embeds={{}} />
      </ReportReader>
    </div>
  );
}
