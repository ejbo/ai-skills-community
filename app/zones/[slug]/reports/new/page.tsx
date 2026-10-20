import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { zoneHref } from '@/lib/zones/shared';
import { ReportWizard } from '@/app/zones/_components/reports/ReportWizard';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('reports_new') };
}

// 新建报告向导（canPost）：上传聊天记录 / report.json + 图片文件 → 建任务 → 进度页。
export default async function NewZoneReportPage({ params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`/zones/${params.slug}/reports/new`));
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  if (!access.canPost) redirect(`${zoneHref(zone.slug)}/reports`);
  const t = await getTranslations('zones');
  return (
    <div className="container max-w-5xl py-8">
      <Link href={`${zoneHref(zone.slug)}/reports`} className="text-xs text-muted hover:text-zinc-900 dark:hover:text-zinc-50">
        ← {t('reports_title')}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('reports_new')}</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-muted">{t('reports_new_subtitle')}</p>
      <ReportWizard zoneSlug={zone.slug} zoneName={zone.name} />
    </div>
  );
}
