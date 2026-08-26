import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { BackButton } from '@/components/BackButton';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { PostComposer } from '@/app/zones/_components/post/PostComposer';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('composer_new_title') };
}

export default async function NewZonePostPage({ params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) redirect('/auth/login');
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  if (!access.canPost) redirect(zoneHref(zone.slug));
  const t = await getTranslations('zones');

  const currentUser: ZoneCurrentUser = {
    id: session.user.id,
    handle: session.user.handle,
    displayName: session.user.displayName,
    avatarUrl: session.user.avatarUrl ?? null,
  };

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref={zoneHref(zone.slug)} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('composer_new_title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('composer_new_subtitle', { zone: zone.name })}</p>
      <div className="mt-6">
        <PostComposer zone={{ id: zone.id, slug: zone.slug, name: zone.name }} access={access} currentUser={currentUser} />
      </div>
    </div>
  );
}
