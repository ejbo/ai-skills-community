import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { zoneContext } from '@/lib/zones/access';
import { canEditZonePostContent, canSeeZonePost, ZONE_POST_ACCESS_SELECT } from '@/lib/zones/post-queries';
import { heartbeatEditor, leaveEditor, listActiveEditors } from '@/lib/zones/post-presence';

export const dynamic = 'force-dynamic';

const SELECT = { ...ZONE_POST_ACCESS_SELECT, coauthors: { select: { userId: true } } };

async function load(slug: string, postId: string) {
  const session = await auth();
  if (!session?.user) return { status: 401 as const };
  const ctx = await zoneContext(slug, session);
  if (!ctx) return { status: 404 as const };
  const post = await prisma.zonePost.findFirst({ where: { id: postId, zoneId: ctx.zone.id, deletedAt: null }, select: SELECT });
  if (!post || !(await canSeeZonePost(post, ctx.access, ctx.viewer))) return { status: 404 as const };
  const uid = session.user.id;
  const canEdit = canEditZonePostContent({ viewerId: uid, authorId: post.authorId, coauthorIds: post.coauthors.map((c) => c.userId), canRead: ctx.access.canRead, canModerate: ctx.access.canModerate });
  return { status: 200 as const, ctx, post, uid, canEdit };
}

// GET /api/zones/[slug]/posts/[postId]/editors (can see) → { editors } — 阅读页「正在编辑」
export async function GET(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const r = await load(params.slug, params.postId);
  if (r.status !== 200) return NextResponse.json({ error: r.status === 401 ? 'unauthenticated' : 'not_found' }, { status: r.status });
  const editors = await listActiveEditors(r.post.id, null, r.ctx.access.canSeeIdentity);
  return NextResponse.json({ editors });
}

// PUT /api/zones/[slug]/posts/[postId]/editors (canEditZonePostContent) — 心跳 → { editors: 其他人 }
export async function PUT(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const r = await load(params.slug, params.postId);
  if (r.status !== 200) return NextResponse.json({ error: r.status === 401 ? 'unauthenticated' : 'not_found' }, { status: r.status });
  if (!r.canEdit) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const editors = await heartbeatEditor(r.post.id, r.uid, r.ctx.access.canSeeIdentity);
  return NextResponse.json({ editors });
}

// DELETE /api/zones/[slug]/posts/[postId]/editors — 离开（navigator.sendBeacon 也打这里）
export async function DELETE(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const r = await load(params.slug, params.postId);
  if (r.status !== 200) return NextResponse.json({ error: r.status === 401 ? 'unauthenticated' : 'not_found' }, { status: r.status });
  await leaveEditor(r.post.id, r.uid);
  return NextResponse.json({ ok: true });
}

// POST = DELETE 的别名：sendBeacon 只能 POST。
export const POST = DELETE;
