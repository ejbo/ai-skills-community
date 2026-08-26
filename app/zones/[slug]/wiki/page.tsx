import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getZoneDetail } from '@/lib/zones/queries';
import { getWikiTree } from '@/lib/zones/wiki-queries';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { ZoneHeader } from '@/app/zones/_components/ZoneHeader';
import { WikiLayout } from '@/app/zones/_components/wiki/WikiLayout';
import { WikiWelcome } from '@/app/zones/_components/wiki/WikiWelcome';

export const dynamic = 'force-dynamic';

// One zone load per request, shared by generateMetadata and the page body.
const load = cache(async (slug: string) => {
  const session = await auth();
  const viewer = zoneSiteViewer(session?.user);
  const zone = await getZoneDetail(slug, viewer);
  return { session, viewer, zone };
});

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const t = await getTranslations('zones');
  const { zone } = await load(params.slug);
  return { title: zone ? t('wiki_meta_index', { zone: zone.name }) : t('wiki_title') };
}

export default async function ZoneWikiIndexPage({ params }: { params: { slug: string } }) {
  const { session, zone } = await load(params.slug);
  if (!zone) notFound();
  // members-only zone without membership: the zone home renders the locked card + join CTA.
  if (!zone.access.canRead) redirect(zoneHref(zone.slug));

  const tree = await getWikiTree(zone.id);
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
        <WikiLayout zoneSlug={zone.slug} tree={tree} activeId={null} canWiki={zone.access.canWiki}>
          <WikiWelcome zoneSlug={zone.slug} tree={tree} canWiki={zone.access.canWiki} />
        </WikiLayout>
      </div>
    </div>
  );
}
