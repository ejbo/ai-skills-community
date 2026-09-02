import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { prisma } from '@/lib/db';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { listZoneColumns } from '@/lib/zones/columns';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { PostComposer } from '@/app/zones/_components/post/PostComposer';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('composer_new_title') };
}

// Document-first composer: the page is only the container — the composer's own
// top bar carries the back link, the zone name and the actions (no page h1).
export default async function NewZonePostPage({ params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`${zoneHref(params.slug)}/posts/new`));
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  if (!access.canPost) redirect(zoneHref(zone.slug));
  // 栏目 (ask #2): the composer needs the zone's columns and whether members may
  // add one — neither rides on ZONE_ACCESS_SELECT.
  const [columns, options] = await Promise.all([
    listZoneColumns(zone.id),
    prisma.zone.findUnique({ where: { id: zone.id }, select: { allowMemberColumns: true } }),
  ]);

  const currentUser: ZoneCurrentUser = {
    id: session.user.id,
    handle: session.user.handle,
    displayName: session.user.displayName,
    avatarUrl: session.user.avatarUrl ?? null,
  };

  return (
    <div className="container max-w-6xl py-0">
      <PostComposer
        zone={{ id: zone.id, slug: zone.slug, name: zone.name }}
        access={access}
        currentUser={currentUser}
        columns={columns}
        allowMemberColumns={options?.allowMemberColumns ?? true}
      />
    </div>
  );
}
