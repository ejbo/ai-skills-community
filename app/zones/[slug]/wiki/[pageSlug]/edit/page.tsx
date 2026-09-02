import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getZoneDetail } from '@/lib/zones/queries';
import { getWikiPage, getWikiTree } from '@/lib/zones/wiki-queries';
import { zoneHref, zoneWikiHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { ZoneHeader } from '@/app/zones/_components/ZoneHeader';
import { WikiEditor } from '@/app/zones/_components/wiki/WikiEditor';

export const dynamic = 'force-dynamic';

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
      ? t('wiki_meta_edit', { page: page.title, zone: zone.name })
      : t('wiki_meta_index', { zone: zone.name }),
  };
}

export default async function ZoneWikiEditPage({ params }: { params: { slug: string; pageSlug: string } }) {
  const { session, zone, page } = await load(params.slug, params.pageSlug);
  if (!zone) notFound();
  if (!zone.access.canRead) redirect(zoneHref(zone.slug));
  if (!page) notFound();
  if (!zone.access.canWiki) redirect(zoneWikiHref(zone.slug, page.slug));

  const t = await getTranslations('zones');
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
    <div className="container max-w-7xl py-6">
      <ZoneHeader zone={zone} activeTab="wiki" currentUser={currentUser} />
      <div className="mx-auto mt-6 max-w-4xl">
        <h1 className="mb-5 text-xl font-semibold tracking-tight">{t('wiki_editor_edit_title')}</h1>
        <WikiEditor
          zoneSlug={zone.slug}
          tree={tree}
          page={{
            id: page.id,
            slug: page.slug,
            title: page.title,
            bodyMd: page.bodyMd,
            parentId: page.parentId,
          }}
        />
      </div>
    </div>
  );
}
