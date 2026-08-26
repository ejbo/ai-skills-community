import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BackButton } from '@/components/BackButton';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { getZonePostDetail } from '@/lib/zones/post-queries';
import { zoneHref, zonePostHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { PostComposer } from '@/app/zones/_components/post/PostComposer';
import type { CoauthorPick } from '@/app/zones/_components/post/CoauthorPicker';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('composer_edit_title') };
}

export default async function EditZonePostPage({ params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) redirect('/auth/login');
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  const locale = await getLocale();
  const post = await getZonePostDetail(params.postId, zone, access, viewer, { session, locale });
  if (!post) notFound();
  // Content edits: author / co-author, or the zone's moderators (the PATCH route enforces the same rule).
  if (!post.isAuthor && !access.canModerate) redirect(zonePostHref(zone.slug, post.id));
  const t = await getTranslations('zones');

  // The composer needs co-author USER IDS (the API contract), which the public
  // view deliberately does not carry — read the join rows here.
  const rows = await prisma.zonePostAuthor.findMany({
    where: { postId: post.id },
    orderBy: { sortOrder: 'asc' },
    select: { userId: true, user: AUTHOR_IDENTITY_SELECT },
  });
  const initialCoauthors: CoauthorPick[] = rows.map((r) => ({ userId: r.userId, user: toPublicAuthor(r.user, access.canSeeIdentity) }));

  const currentUser: ZoneCurrentUser = {
    id: session.user.id,
    handle: session.user.handle,
    displayName: session.user.displayName,
    avatarUrl: session.user.avatarUrl ?? null,
  };

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref={post.status === 'published' ? zonePostHref(zone.slug, post.id) : zoneHref(zone.slug)} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('composer_edit_title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('composer_edit_subtitle', { zone: zone.name })}</p>
      <div className="mt-6">
        <PostComposer
          zone={{ id: zone.id, slug: zone.slug, name: zone.name }}
          access={access}
          currentUser={currentUser}
          post={post}
          initialCoauthors={initialCoauthors}
        />
      </div>
    </div>
  );
}
