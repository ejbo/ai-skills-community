import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getZoneDetail } from '@/lib/zones/queries';
import { getWikiTree } from '@/lib/zones/wiki-queries';
import { zoneHref, zoneWikiHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { ZoneHeader } from '@/app/zones/_components/ZoneHeader';
import { WikiEditor } from '@/app/zones/_components/wiki/WikiEditor';

export const dynamic = 'force-dynamic';

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

const load = cache(async (slug: string) => {
  const session = await auth();
  const viewer = zoneSiteViewer(session?.user);
  const zone = await getZoneDetail(slug, viewer);
  return { session, viewer, zone };
});

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const t = await getTranslations('zones');
  const { zone } = await load(params.slug);
  return { title: zone ? t('wiki_meta_new', { zone: zone.name }) : t('wiki_editor_new_title') };
}

export default async function ZoneWikiNewPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { session, zone } = await load(params.slug);
  if (!zone) notFound();
  if (!zone.access.canRead) redirect(zoneHref(zone.slug));
  if (!zone.access.canWiki) redirect(zoneWikiHref(zone.slug));

  const t = await getTranslations('zones');
  const tree = await getWikiTree(zone.id);
  const parent = firstParam(searchParams.parent).trim();
  const currentUser: ZoneCurrentUser | null = session?.user
    ? {
        id: session.user.id,
        handle: session.user.handle,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      }
    : null;

  return (
    <div className="container max-w-7xl py-6">
      <ZoneHeader zone={zone} activeTab="wiki" currentUser={currentUser} />
      <div className="mx-auto mt-6 max-w-4xl">
        <h1 className="mb-5 text-xl font-semibold tracking-tight">{t('wiki_editor_new_title')}</h1>
        <WikiEditor zoneSlug={zone.slug} tree={tree} initialParentId={parent || null} />
      </div>
    </div>
  );
}
