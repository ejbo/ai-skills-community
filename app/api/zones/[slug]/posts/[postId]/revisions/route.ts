import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { canSeeZonePost, ZONE_POST_ACCESS_SELECT } from '@/lib/zones/post-queries';
import { listZonePostRevisions } from '@/lib/zones/post-revisions';

export const dynamic = 'force-dynamic';

// GET /api/zones/[slug]/posts/[postId]/revisions (can see the post) → { revisions: ZonePostRevisionView[] }
export async function GET(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }
  const post = await prisma.zonePost.findFirst({ where: { id: params.postId, zoneId: ctx.zone.id, deletedAt: null }, select: ZONE_POST_ACCESS_SELECT });
  if (!post || !(await canSeeZonePost(post, ctx.access, ctx.viewer))) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const revisions = await listZonePostRevisions(post.id, 100, ctx.access.canSeeIdentity);
  return NextResponse.json({ revisions });
}
