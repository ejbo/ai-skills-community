import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { ZONE_POST_ACCESS_SELECT, canSeeZonePost, recordZonePostView } from '@/lib/zones/post-queries';

export const dynamic = 'force-dynamic';

// POST /api/zones/[slug]/posts/[postId]/view → { ok }
// Day-bucket deduped per viewer (viewerKey = userId — /zones is login-walled,
// so there is no anonymous branch and no IP key to forge).
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

  await recordZonePostView(post.id, session.user.id);
  return NextResponse.json({ ok: true });
}
