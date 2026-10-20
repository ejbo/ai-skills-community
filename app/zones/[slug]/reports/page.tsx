import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FileBarChart2 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getZoneDetail } from '@/lib/zones/queries';
import { listZoneLibraryDocs } from '@/lib/zones/reports/library';
import { listZoneReports } from '@/lib/zones/reports/queries';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { ZoneHeader } from '@/app/zones/_components/ZoneHeader';
import { ReportList } from '@/app/zones/_components/reports/ReportList';
import { ZoneLibraryRail } from '@/app/zones/_components/reports/ZoneLibraryRail';
import { BTN_PRIMARY } from '@/app/zones/_components/ui';

export const dynamic = 'force-dynamic';

const load = cache(async (slug: string) => {
  const session = await auth();
  const viewer = zoneSiteViewer(session?.user);
  const zone = await getZoneDetail(slug, viewer);
  return { session, viewer, zone };
});

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const t = await getTranslations('zones');
  const { zone } = await load(params.slug);
  return { title: zone ? `${t('reports_title')} · ${zone.name}` : t('reports_title') };
}

// 版块报告列表（docs/contracts/reports.md）：本版块所有生成任务 + 右栏「资料」（收录进知识库的文档）。
export default async function ZoneReportsPage({ params }: { params: { slug: string } }) {
  const { session, viewer, zone } = await load(params.slug);
  if (!zone) notFound();
  if (!zone.access.canRead) redirect(zoneHref(zone.slug));
  const t = await getTranslations('zones');
  const [items, docs] = await Promise.all([listZoneReports(zone.id, viewer.id, zone.access.canSeeIdentity), listZoneLibraryDocs(zone.id, 20)]);
  const currentUser: ZoneCurrentUser | null = session?.user
    ? { id: session.user.id, handle: session.user.handle, displayName: session.user.displayName, avatarUrl: session.user.avatarUrl }
    : null;
  return (
    <div className="container max-w-7xl py-6">
      <ZoneHeader zone={zone} activeTab="posts" currentUser={currentUser} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t('reports_title')}</h1>
              <p className="mt-1 text-sm text-muted">{t('reports_subtitle')}</p>
            </div>
            {zone.access.canPost && (
              <Link href={`${zoneHref(zone.slug)}/reports/new`} className={BTN_PRIMARY}>
                <FileBarChart2 className="h-4 w-4" />
                {t('reports_new')}
              </Link>
            )}
          </div>
          <ReportList zoneSlug={zone.slug} items={items} />
        </div>
        <ZoneLibraryRail docs={docs} />
      </div>
    </div>
  );
}
