import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { listZoneColumns } from '@/lib/zones/columns';
import { canViewerEditZonePost } from '@/lib/zones/post-edit';
import { getZonePostDetail } from '@/lib/zones/post-queries';
import { isAutoPostSummary } from '@/lib/zones/post-summary';
import { zonePostEditHref, zonePostHref } from '@/lib/zones/shared';
import { resolveZonePostParam } from '@/lib/title-slugs';
import { decodeSlugParam } from '@/lib/slug';
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
  if (!session?.user) redirect(loginHref(zonePostEditHref(params.slug, decodeSlugParam(params.postId))));
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  const locale = await getLocale();
  // Edit URLs are id-based (zonePostEditHref), but a slug or an old link still
  // opens the composer — no canonical redirect here on purpose.
  const resolved = await resolveZonePostParam(zone.id, params.postId);
  if (!resolved) notFound();
  const post = await getZonePostDetail(resolved.id, zone, access, viewer, { session, locale });
  if (!post) notFound();
  // Content edits go through the SAME policy the PATCH route enforces
  // (`canEditZonePostContent`): the 主作者, a co-author who can still read the
  // zone, or a moderator. Deciding with `isAuthor || canModerate` here used to
  // hand a co-author outside a 仅成员可见 版块 a composer whose save then 403s.
  if (!(await canViewerEditZonePost({ postId: post.id, isAuthor: post.isAuthor, access }))) {
    redirect(zonePostHref(zone.slug, post));
  }
  // The composer needs co-author and 指定成员 USER IDS (the API contract), which
  // the public views deliberately do not carry — read the join rows here. The
  // designated list is only meaningful (and only readable) for a `restricted`
  // post, and this page is already gated on the edit policy above.
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

  // 摘要 left blank at save time is stored as an excerpt of the body. Loading
  // that excerpt into the input would turn it into a "typed" summary on the next
  // save and freeze the card on today's body — so the composer gets it back as
  // blank (the 留空则自动截取正文 placeholder), exactly as the author left it.
  // updateZonePost recognises the echo too; this keeps the INPUT honest.
  const composerPost = isAutoPostSummary(post.summary, post.bodyMd) ? { ...post, summary: '' } : post;

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
        post={composerPost}
        initialCoauthors={initialCoauthors}
        initialDesignated={initialDesignated}
        columns={columns}
        allowMemberColumns={options?.allowMemberColumns ?? true}
      />
    </div>
  );
}
