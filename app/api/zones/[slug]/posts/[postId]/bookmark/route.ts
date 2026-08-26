import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { ZONE_POST_ACCESS_SELECT, canSeeZonePost } from '@/lib/zones/post-queries';

export const dynamic = 'force-dynamic';

// POST /api/zones/[slug]/posts/[postId]/bookmark — toggle → { bookmarked, bookmarkCount }
// Same guarded-transaction + authoritative re-read contract as the like route.
export async function POST(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const post = await prisma.zonePost.findUnique({
    where: { id: params.postId },
    select: { ...ZONE_POST_ACCESS_SELECT, zoneId: true },
  });
  if (!post || post.zoneId !== ctx.zone.id || post.deletedAt || post.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // The zone gate above is not enough: post visibility narrows within the zone,
  // so a 仅成员可见 / 未解锁的指定成员可见 post is 404 here too.
  if (!(await canSeeZonePost(post, ctx.access, ctx.viewer))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = { userId: session.user.id, postId: post.id };
  await prisma.$transaction(async (tx) => {
    const removed = await tx.zonePostBookmark.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.zonePost.update({ where: { id: post.id }, data: { bookmarkCount: { decrement: removed.count } } });
      return;
    }
    const added = await tx.zonePostBookmark.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.zonePost.update({ where: { id: post.id }, data: { bookmarkCount: { increment: added.count } } });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.zonePost.findUnique({ where: { id: post.id }, select: { bookmarkCount: true } }),
    prisma.zonePostBookmark.findUnique({ where: { userId_postId: key }, select: { userId: true } }),
  ]);
  return NextResponse.json({
    bookmarked: Boolean(mine),
    bookmarkCount: Math.max(0, fresh?.bookmarkCount ?? 0),
  });
}
