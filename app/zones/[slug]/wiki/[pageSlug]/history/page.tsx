import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getZoneDetail } from '@/lib/zones/queries';
import { getWikiPage, listWikiRevisions } from '@/lib/zones/wiki-queries';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { ZoneHeader } from '@/app/zones/_components/ZoneHeader';
import { WikiHistory } from '@/app/zones/_components/wiki/WikiHistory';

export const dynamic = 'force-dynamic';

const REVISIONS_TAKE = 100;

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

const load = cache(async (slug: string, pageSlug: string) => {
  const session = await auth();
  const viewer = zoneSiteViewer(session?.user);
  const zone = await getZoneDetail(slug, viewer);
  if (!zone || !zone.access.canRead) return { session, viewer, zone, page: null };
  const locale = await getLocale();
  const page = await getWikiPage(zone.id, pageSlug, { viewer, session, locale });
  return { session, viewer, zone, page };
});

export async function generateMetadata({
  params,
}: {
  params: { slug: string; pageSlug: string };
}): Promise<Metadata> {
  const t = await getTranslations('zones');
  const { zone, page } = await load(params.slug, params.pageSlug);
  if (!zone) return { title: t('wiki_title') };
  return {
    title: page
      ? t('wiki_meta_history', { page: page.title, zone: zone.name })
      : t('wiki_meta_index', { zone: zone.name }),
  };
}

export default async function ZoneWikiHistoryPage({
  params,
  searchParams,
}: {
  params: { slug: string; pageSlug: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { session, viewer, zone, page } = await load(params.slug, params.pageSlug);
  if (!zone) notFound();
  if (!zone.access.canRead) redirect(zoneHref(zone.slug));
  if (!page) notFound();

  const revisions = await listWikiRevisions(page.id, REVISIONS_TAKE, viewer.canSeeIdentity);
  const rev = firstParam(searchParams.rev).trim();
  const currentUser: ZoneCurrentUser | null = session?.user
    ? {
        id: session.user.id,
        handle: session.user.handle,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      }
    : null;

  return (
    <div className="container max-w-6xl py-8">
      <ZoneHeader zone={zone} activeTab="wiki" currentUser={currentUser} />
      <div className="mt-6">
        <WikiHistory
          zoneSlug={zone.slug}
          page={{
            id: page.id,
            slug: page.slug,
            title: page.title,
            bodyMd: page.bodyMd,
            revisionCount: page.revisionCount,
            updatedAt: page.updatedAt,
          }}
          revisions={revisions}
          canWiki={zone.access.canWiki}
          initialRevisionId={rev || null}
        />
      </div>
    </div>
  );
}
