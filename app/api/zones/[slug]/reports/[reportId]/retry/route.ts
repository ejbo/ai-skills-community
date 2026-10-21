import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { retryZoneReport } from '@/lib/zones/reports/queries';

export const dynamic = 'force-dynamic';

// POST /api/zones/[slug]/reports/[reportId]/retry (创建者 OR canModerate; failed / 中断 only) → { ok }
export async function POST(_req: Request, { params }: { params: { slug: string; reportId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canPost && !ctx.access.canModerate) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_post_forbidden') }, { status: 403 });
  }
  const row = await prisma.zoneReport.findFirst({ where: { id: params.reportId, zoneId: ctx.zone.id }, select: { id: true, createdById: true } });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.createdById !== session.user.id && !ctx.access.canModerate) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const ok = await retryZoneReport(row.id);
  if (!ok) return NextResponse.json({ error: 'report_not_failed', reason: await apiReason('zone_report_not_failed') }, { status: 409 });
  return NextResponse.json({ ok: true });
}
