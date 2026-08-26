import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { ZONE_ACCESS_SELECT, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { getZoneCommentThread } from '@/lib/zones/post-queries';

export const dynamic = 'force-dynamic';

// GET /api/zones/comments/[id]/context
// Resolves a deep-linked comment id (?focus= from a notification) to its
// thread root so the client can ensure the root is loaded and (for a reply)
// auto-expand the thread before scrolling. → { exists, postId, rootId, isReply, root }
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const target = await prisma.zonePostComment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      parentId: true,
      postId: true,
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
  if (!target || target.post.deletedAt) return NextResponse.json({ exists: false });

  const viewer = zoneSiteViewer(session.user);
  if (target.post.zone.deletedAt && !viewer.siteAdmin) return NextResponse.json({ exists: false });
  const access = await resolveZoneAccess(target.post.zone, viewer);
  if (!access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }
  // Same post-visibility gate as the comments LIST route: a draft is only
  // readable by its own (co-)authors and the zone's moderators.
  const uid = session.user.id;
  const isPostAuthor = target.post.authorId === uid || target.post.coauthors.some((c) => c.userId === uid);
  if (target.post.status !== 'published' && !isPostAuthor && !access.canModerate) {
    return NextResponse.json({ exists: false });
  }

  const rootId = target.parentId ?? target.id;
  const root = await getZoneCommentThread(rootId, viewer);
  return NextResponse.json({
    exists: true,
    postId: target.postId,
    rootId,
    isReply: target.parentId !== null,
    root,
  });
}
