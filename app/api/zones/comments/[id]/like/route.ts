import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { ZONE_ACCESS_SELECT, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';

export const dynamic = 'force-dynamic';

// POST /api/zones/comments/[id]/like — toggle → { liked, likeCount }
// Guarded writes + authoritative re-read (same contract as the post like route).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const comment = await prisma.zonePostComment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
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
  if (!comment || comment.status === 'deleted' || comment.post.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const viewer = zoneSiteViewer(session.user);
  if (comment.post.zone.deletedAt && !viewer.siteAdmin) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const access = await resolveZoneAccess(comment.post.zone, viewer);
  if (!access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }
  // Same post-visibility gate as the comments LIST route: a draft is only
  // readable (and therefore likeable) by its own (co-)authors and moderators.
  const uid = session.user.id;
  const isPostAuthor = comment.post.authorId === uid || comment.post.coauthors.some((c) => c.userId === uid);
  if (comment.post.status !== 'published' && !isPostAuthor && !access.canModerate) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = { userId: uid, commentId: comment.id };
  await prisma.$transaction(async (tx) => {
    const removed = await tx.zonePostCommentLike.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.zonePostComment.update({
        where: { id: comment.id },
        data: { likeCount: { decrement: removed.count } },
      });
      return;
    }
    const added = await tx.zonePostCommentLike.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.zonePostComment.update({
        where: { id: comment.id },
        data: { likeCount: { increment: added.count } },
      });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.zonePostComment.findUnique({ where: { id: comment.id }, select: { likeCount: true } }),
    prisma.zonePostCommentLike.findUnique({ where: { userId_commentId: key }, select: { userId: true } }),
  ]);
  return NextResponse.json({ liked: Boolean(mine), likeCount: Math.max(0, fresh?.likeCount ?? 0) });
}
