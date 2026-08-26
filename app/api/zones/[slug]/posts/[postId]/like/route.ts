import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';

export const dynamic = 'force-dynamic';

// POST /api/zones/[slug]/posts/[postId]/like — toggle → { liked, likeCount }
//
// Guarded writes inside one transaction (deleteMany / createMany skipDuplicates
// move the counter by exactly the rows they touched), then an authoritative
// re-read: a same-user race from a second tab just falls through to whatever
// state won instead of 500ing or drifting the counter.
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
    select: { id: true, zoneId: true, status: true, deletedAt: true },
  });
  if (!post || post.zoneId !== ctx.zone.id || post.deletedAt || post.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = { userId: session.user.id, postId: post.id };
  await prisma.$transaction(async (tx) => {
    const removed = await tx.zonePostLike.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.zonePost.update({ where: { id: post.id }, data: { likeCount: { decrement: removed.count } } });
      return;
    }
    const added = await tx.zonePostLike.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.zonePost.update({ where: { id: post.id }, data: { likeCount: { increment: added.count } } });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.zonePost.findUnique({ where: { id: post.id }, select: { likeCount: true } }),
    prisma.zonePostLike.findUnique({ where: { userId_postId: key }, select: { userId: true } }),
  ]);
  return NextResponse.json({ liked: Boolean(mine), likeCount: Math.max(0, fresh?.likeCount ?? 0) });
}
