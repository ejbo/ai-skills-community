import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { decodeSlugParam } from '@/lib/slug';
import { resolveZonePostParam } from '@/lib/title-slugs';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { canViewerEditZonePost } from '@/lib/zones/post-edit';
import { getZonePostDetail } from '@/lib/zones/post-queries';
import { listZonePostRevisions } from '@/lib/zones/post-revisions';
import { zonePostHref } from '@/lib/zones/shared';
import { PostHistory } from '@/app/zones/_components/post/PostHistory';

export const dynamic = 'force-dynamic';

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('zones');
  return { title: t('wiki_history_title') };
}

// 帖子版本历史（docs/contracts/reports.md §4）：能看帖子就能看历史，恢复要编辑权。
export default async function ZonePostHistoryPage({ params, searchParams }: { params: { slug: string; postId: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const session = await auth();
  const postParam = decodeSlugParam(params.postId);
  if (!session?.user) redirect(loginHref(`/zones/${params.slug}/posts/${postParam}/history`));
  const viewer = zoneSiteViewer(session.user);
  const zone = await loadZoneBySlug(params.slug, viewer);
  if (!zone) notFound();
  const access = await resolveZoneAccess(zone, viewer);
  const locale = await getLocale();
  const resolved = await resolveZonePostParam(zone.id, params.postId);
  if (!resolved) notFound();
  const post = await getZonePostDetail(resolved.id, zone, access, viewer, { session, locale });
  if (!post || post.accessLocked) notFound();
  const [revisions, canEdit] = await Promise.all([
    listZonePostRevisions(post.id, 100, access.canSeeIdentity),
    canViewerEditZonePost({ postId: post.id, isAuthor: post.isAuthor, access }),
  ]);
  const rev = firstParam(searchParams.rev).trim();
  return (
    <div className="container max-w-7xl py-6">
      <PostHistory
        zoneSlug={zone.slug}
        post={{ id: post.id, href: zonePostHref(zone.slug, post), title: post.title, bodyMd: post.bodyMd, revision: post.revision, updatedAt: post.updatedAt }}
        revisions={revisions}
        canEdit={canEdit}
        initialRevisionId={rev || null}
      />
    </div>
  );
}
