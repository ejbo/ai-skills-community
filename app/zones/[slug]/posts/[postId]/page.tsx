import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadZoneBySlug, resolveZoneAccess, zoneSiteViewer, type ZoneAccessRow, type ZoneSiteViewer } from '@/lib/zones/access';
import { buildLeadRoles, type LeadRoles } from '@/lib/zones/lead-roles';
import { ZONE_MODERATOR_ROLE_KEY } from '@/lib/zones/permissions';
import { getZonePostDetail, listZonePosts, recordZonePostView } from '@/lib/zones/post-queries';
import type { ZoneAccess, ZoneCurrentUser, ZonePostCardView, ZonePostDetailView } from '@/lib/zones/types';
import { PostDetail } from '@/app/zones/_components/post/PostDetail';

export const dynamic = 'force-dynamic';

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/**
 * 主版主 + 版主 handles → LeadRoles for the bylines. Two NARROW reads issued
 * together (one round trip): the owner handle from the access row's `ownerId`,
 * and the active moderators through the role key — never the paged member
 * list (`listZoneMembers` re-reads the zone, counts the page, resolves the
 * member role name and aggregates post counts, all discarded here) and never
 * a first-N member sample. Only handles are selected: they are already public
 * in every author payload, so nothing new travels.
 */
const LEAD_MODERATORS_MAX = 20;

async function loadLeadRoles(zone: ZoneAccessRow): Promise<LeadRoles> {
  try {
    const [owner, mods] = await Promise.all([
      prisma.user.findUnique({ where: { id: zone.ownerId }, select: { handle: true } }),
      prisma.zoneMember.findMany({
        where: {
          zoneId: zone.id,
          status: 'active',
          userId: { not: zone.ownerId },
          role: { is: { key: ZONE_MODERATOR_ROLE_KEY } },
        },
        select: { user: { select: { handle: true } } },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: LEAD_MODERATORS_MAX,
      }),
    ]);
    return buildLeadRoles(
      owner?.handle ?? '',
      mods.map((m) => m.user.handle),
    );
  } catch {
    return {};
  }
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
  const leadRoles = await loadLeadRoles(zone);
  return { session, viewer, zone, access, post, leadRoles };
});

// 相关帖子: a shared first tag, then the same 栏目 (the taxonomy) — merged,
// deduped, ≤ 4. Never the hidden content type.
async function loadRelated(zone: ZoneAccessRow, access: ZoneAccess, viewer: ZoneSiteViewer, post: ZonePostDetailView): Promise<ZonePostCardView[]> {
  try {
    const none = Promise.resolve({ items: [] as ZonePostCardView[] });
    const [byTag, byColumn] = await Promise.all([
      post.tags[0] ? listZonePosts({ zone, access, viewer, tag: post.tags[0], limit: 6 }) : none,
      post.column ? listZonePosts({ zone, access, viewer, column: post.column.slug, limit: 6 }) : none,
    ]);
    const seen = new Set<string>([post.id]);
    const out: ZonePostCardView[] = [];
    for (const p of [...byTag.items, ...byColumn.items]) {
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
  const { session, viewer, zone, access, post, leadRoles } = data;

  // One view per viewer per UTC day (recordZonePostView day-buckets the key).
  // A locked `restricted` post is NOT a read: neither the view nor the related
  // band (which would query the zone on this viewer's behalf) may run for it.
  if (post.status === 'published' && session?.user && !post.accessLocked) {
    await recordZonePostView(post.id, session.user.id);
  }

  const related = post.status === 'published' && !post.accessLocked ? await loadRelated(zone, access, viewer, post) : [];
  const currentUser: ZoneCurrentUser | null = session?.user
    ? { id: session.user.id, handle: session.user.handle, displayName: session.user.displayName, avatarUrl: session.user.avatarUrl ?? null }
    : null;
  const focus = firstParam(searchParams.focus);

  return (
    <div className="container max-w-5xl py-8">
      <PostDetail
        post={post}
        zone={{ id: zone.id, slug: zone.slug, name: zone.name }}
        access={access}
        currentUser={currentUser}
        focusId={focus || undefined}
        related={related}
        leadRoles={leadRoles}
      />
    </div>
  );
}
