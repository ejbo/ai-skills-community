import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { ZONE_ACCESS_SELECT, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { listZoneCommentReplies } from '@/lib/zones/post-queries';

export const dynamic = 'force-dynamic';

// GET /api/zones/comments/[id]/replies — the full reply list of one thread,
// loaded when "展开其余 N 条回复" is clicked (the thread preview only carries
// the first few). → { replies: ZoneCommentView[] }
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const root = await prisma.zonePostComment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      parentId: true,
      post: {
        select: {
          deletedAt: true,
          status: true,
          authorId: true,
          coauthors: { select: { userId: true } },
          zone: { select: ZONE_ACCESS_SELECT },
        },
      },
    },
  });
  if (!root || root.parentId !== null || root.post.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const viewer = zoneSiteViewer(session.user);
  if (root.post.zone.deletedAt && !viewer.siteAdmin) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const access = await resolveZoneAccess(root.post.zone, viewer);
  if (!access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }
  // Same post-visibility gate as the comments LIST route: a draft is only
  // readable by its own (co-)authors and the zone's moderators.
  const uid = session.user.id;
  const isPostAuthor = root.post.authorId === uid || root.post.coauthors.some((c) => c.userId === uid);
  if (root.post.status !== 'published' && !isPostAuthor && !access.canModerate) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const replies = await listZoneCommentReplies(root.id, viewer);
  return NextResponse.json({ replies });
}
