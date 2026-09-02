import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { listZoneColumns } from '@/lib/zones/columns';
import { getZonePostDetail } from '@/lib/zones/post-queries';
import { zonePostHref } from '@/lib/zones/shared';
import type { ZoneCurrentUser } from '@/lib/zones/types';
import { PostComposer } from '@/app/zones/_components/post/PostComposer';
import type { CoauthorPick } from '@/app/zones/_components/post/CoauthorPicker';
import type { DesignatedPick } from '@/app/zones/_components/post/PostAccessPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('composer_edit_title') };
}

// Document-first composer: the page is only the container — the composer's own
// top bar carries the back link, the zone name and the actions (no page h1).
export default async function EditZonePostPage({ params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref(`${zonePostHref(params.slug, params.postId)}/edit`));
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  const locale = await getLocale();
  const post = await getZonePostDetail(params.postId, zone, access, viewer, { session, locale });
  if (!post) notFound();
  // Content edits: author / co-author, or the zone's moderators (the PATCH route enforces the same rule).
  if (!post.isAuthor && !access.canModerate) redirect(zonePostHref(zone.slug, post.id));
  // The composer needs co-author and 指定成员 USER IDS (the API contract), which
  // the public views deliberately do not carry — read the join rows here. The
  // designated list is only meaningful (and only readable) for a `restricted`
  // post, and this page is already gated on author-or-moderator above.
  const [rows, columns, options] = await Promise.all([
    prisma.zonePostAuthor.findMany({
      where: { postId: post.id },
      orderBy: { sortOrder: 'asc' },
      select: { userId: true, user: AUTHOR_IDENTITY_SELECT },
    }),
    listZoneColumns(zone.id),
    prisma.zone.findUnique({ where: { id: zone.id }, select: { allowMemberColumns: true } }),
  ]);
  const initialCoauthors: CoauthorPick[] = rows.map((r) => ({ userId: r.userId, user: toPublicAuthor(r.user, access.canSeeIdentity) }));
  // Only a `restricted` post has a designated list; a grant row left over from an
  // earlier restricted phase must never repopulate the picker.
  const initialDesignated: DesignatedPick[] =
    post.visibility === 'restricted'
      ? (
          await prisma.zonePostViewer.findMany({
            where: { postId: post.id, via: 'designated' },
            orderBy: { createdAt: 'asc' },
            take: 200,
            select: { userId: true, user: AUTHOR_IDENTITY_SELECT },
          })
        ).map((r) => ({ userId: r.userId, user: toPublicAuthor(r.user, access.canSeeIdentity) }))
      : [];

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
        post={post}
        initialCoauthors={initialCoauthors}
        initialDesignated={initialDesignated}
        columns={columns}
        allowMemberColumns={options?.allowMemberColumns ?? true}
      />
    </div>
  );
}
