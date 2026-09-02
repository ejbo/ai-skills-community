import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getZoneDetail } from '@/lib/zones/queries';
import { getWikiPage, getWikiTree } from '@/lib/zones/wiki-queries';
import { zoneHref } from '@/lib/zones/shared';
import type { WikiTreeNode, ZoneCurrentUser } from '@/lib/zones/types';
import { ZoneMarkdown } from '@/components/zones/ZoneMarkdown';
import { ZoneHeader } from '@/app/zones/_components/ZoneHeader';
import { WikiLayout } from '@/app/zones/_components/wiki/WikiLayout';
import { WikiPageView, type WikiCrumb } from '@/app/zones/_components/wiki/WikiPageView';

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

/** Root → parent crumbs for `id`, or null when the id is not in the tree. */
function findPath(nodes: WikiTreeNode[], id: string, trail: WikiCrumb[] = []): WikiCrumb[] | null {
  for (const n of nodes) {
    if (n.id === id) return trail;
    const hit = findPath(n.children, id, [...trail, { slug: n.slug, title: n.title }]);
    if (hit) return hit;
  }
  return null;
}

function findNode(nodes: WikiTreeNode[], id: string): WikiTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

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
      ? t('wiki_meta_page', { page: page.title, zone: zone.name })
      : t('wiki_meta_index', { zone: zone.name }),
  };
}

export default async function ZoneWikiPage({ params }: { params: { slug: string; pageSlug: string } }) {
  const { session, zone, page } = await load(params.slug, params.pageSlug);
  if (!zone) notFound();
  if (!zone.access.canRead) redirect(zoneHref(zone.slug));
  if (!page) notFound();

  const tree = await getWikiTree(zone.id);
  const ancestors = findPath(tree, page.id) ?? [];
  const node = findNode(tree, page.id);
  const childPages: WikiCrumb[] = node ? node.children.map((c) => ({ slug: c.slug, title: c.title })) : [];
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
      <div className="mt-6">
        <WikiLayout zoneSlug={zone.slug} tree={tree} activeId={page.id} canWiki={zone.access.canWiki}>
          <WikiPageView
            zoneSlug={zone.slug}
            page={page}
            canWiki={zone.access.canWiki}
            ancestors={ancestors}
            childPages={childPages}
            body={<ZoneMarkdown content={page.bodyMd} embeds={page.embeds} />}
          />
        </WikiLayout>
      </div>
    </div>
  );
}
