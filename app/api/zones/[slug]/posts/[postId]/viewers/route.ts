import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { listZonePostViewers } from '@/lib/zones/post-queries';

export const dynamic = 'force-dynamic';

// GET /api/zones/[slug]/posts/[postId]/viewers（超级管理员）→ { viewers: [{ user, days, firstAt, lastAt }], anonymousDays }
// 「谁看过这篇帖子」（owner 2026-10-22）。只有超级管理员：这是对读者的追踪，不下放给版主。
export async function GET(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const gate = await gateApi('super');
  if (!gate.ok) return gate.response;
  const post = await prisma.zonePost.findFirst({ where: { id: params.postId, zone: { slug: params.slug } }, select: { id: true } });
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(await listZonePostViewers(post.id));
}
