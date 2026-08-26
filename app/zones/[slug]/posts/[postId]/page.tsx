import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer, type ZoneAccessRow, type ZoneSiteViewer } from '@/lib/zones/access';
import { getZonePostDetail, listZonePosts, recordZonePostView } from '@/lib/zones/post-queries';
import type { ZoneAccess, ZoneCurrentUser, ZonePostCardView, ZonePostDetailView } from '@/lib/zones/types';
import { PostDetail } from '@/app/zones/_components/post/PostDetail';

export const dynamic = 'force-dynamic';

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

// Shared by generateMetadata and the page (React request cache) so the post
// is resolved ONCE per request.
const loadPost = cache(async (slug: string, postId: string) => {
  const session = await auth();
  const viewer = zoneSiteViewer(session?.user);
  const zone = await loadZoneBySlug(slug, viewer);
  if (!zone) return null;
  const access = await resolveZoneAccess(zone, viewer);
  const locale = await getLocale();
  const post = await getZonePostDetail(postId, zone, access, viewer, { session, locale });
  if (!post) return null;
  return { session, viewer, zone, access, post };
});

async function loadRelated(zone: ZoneAccessRow, access: ZoneAccess, viewer: ZoneSiteViewer, post: ZonePostDetailView): Promise<ZonePostCardView[]> {
  try {
    const [byTag, byType] = await Promise.all([
      post.tags[0] ? listZonePosts({ zone, access, viewer, tag: post.tags[0], limit: 6 }) : Promise.resolve({ items: [] as ZonePostCardView[] }),
      listZonePosts({ zone, access, viewer, type: post.type, limit: 6 }),
    ]);
    const seen = new Set<string>([post.id]);
    const out: ZonePostCardView[] = [];
    for (const p of [...byTag.items, ...byType.items]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: { slug: string; postId: string } }): Promise<Metadata> {
  const t = await getTranslations('zones');
  const data = await loadPost(params.slug, params.postId);
  if (!data) return { title: t('post_not_found') };
  return { title: `${data.post.title} · ${data.zone.name}`, description: data.post.summary || undefined };
}

export default async function ZonePostPage({
  params,
  searchParams,
}: {
  params: { slug: string; postId: string };
  searchParams: { focus?: string | string[] };
}) {
  const data = await loadPost(params.slug, params.postId);
  if (!data) notFound();
  const { session, viewer, zone, access, post } = data;

  // One view per viewer per UTC day (recordZonePostView day-buckets the key).
  if (post.status === 'published' && session?.user) {
    await recordZonePostView(post.id, session.user.id);
  }

  const related = post.status === 'published' ? await loadRelated(zone, access, viewer, post) : [];
  const currentUser: ZoneCurrentUser | null = session?.user
    ? { id: session.user.id, handle: session.user.handle, displayName: session.user.displayName, avatarUrl: session.user.avatarUrl ?? null }
    : null;
  const focus = firstParam(searchParams.focus);

  return (
    <div className="container max-w-4xl py-8">
      <PostDetail
        post={post}
        zone={{ id: zone.id, slug: zone.slug, name: zone.name }}
        access={access}
        currentUser={currentUser}
        focusId={focus || undefined}
        related={related}
      />
    </div>
  );
}
