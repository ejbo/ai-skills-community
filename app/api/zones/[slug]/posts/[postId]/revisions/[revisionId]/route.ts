import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { logAdmin } from '@/lib/audit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { canEditZonePostContent, canSeeZonePost, ZONE_POST_ACCESS_SELECT } from '@/lib/zones/post-queries';
import { getZonePostRevision, restoreZonePostRevision } from '@/lib/zones/post-revisions';

export const dynamic = 'force-dynamic';

const POST_SELECT = { ...ZONE_POST_ACCESS_SELECT, title: true, coauthors: { select: { userId: true } } } satisfies Prisma.ZonePostSelect;

async function loadPost(postId: string, zoneId: string) {
  const post = await prisma.zonePost.findFirst({ where: { id: postId, zoneId, deletedAt: null }, select: POST_SELECT });
  return post ?? null;
}

// GET /api/zones/[slug]/posts/[postId]/revisions/[revisionId] (can see the post) → { revision (with bodyMd) }
export async function GET(_req: Request, { params }: { params: { slug: string; postId: string; revisionId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  const post = await loadPost(params.postId, ctx.zone.id);
  if (!post || !(await canSeeZonePost(post, ctx.access, ctx.viewer))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const revision = await getZonePostRevision(post.id, params.revisionId, ctx.access.canSeeIdentity);
  if (!revision) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ revision });
}

// POST /api/zones/[slug]/posts/[postId]/revisions/[revisionId] (canEditZonePostContent) — restore → { ok }
export async function POST(_req: Request, { params }: { params: { slug: string; postId: string; revisionId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const post = await loadPost(params.postId, ctx.zone.id);
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const uid = session.user.id;
  const canEdit = canEditZonePostContent({
    viewerId: uid,
    authorId: post.authorId,
    coauthorIds: post.coauthors.map((c) => c.userId),
    canRead: ctx.access.canRead,
    canModerate: ctx.access.canModerate,
  });
  if (!canEdit) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    await restoreZonePostRevision(post.id, params.revisionId, uid, { canModerate: ctx.access.canModerate });
  } catch (e) {
    if (e instanceof ZoneError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return NextResponse.json({ error: 'conflict', reason: await apiReason('zone_conflict') }, { status: 409 });
    }
    throw e;
  }
  if (ctx.access.siteAdmin && !ctx.access.isMember) {
    await logAdmin({ adminUserId: uid, action: 'restore_zone_post_revision', targetType: 'zone_post', targetId: post.id, details: { zoneSlug: ctx.zone.slug, title: post.title, revisionId: params.revisionId } });
  }
  return NextResponse.json({ ok: true });
}
