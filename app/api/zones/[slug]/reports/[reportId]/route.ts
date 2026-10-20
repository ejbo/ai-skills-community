import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { deleteZoneReport, getZoneReportDetail } from '@/lib/zones/reports/queries';

export const dynamic = 'force-dynamic';

// GET /api/zones/[slug]/reports/[reportId] (canRead) → { report: ZoneReportDetailView } — 页面轮询这里
export async function GET(_req: Request, { params }: { params: { slug: string; reportId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  const report = await getZoneReportDetail(ctx.zone.id, params.reportId, ctx.viewer.id, ctx.access.canSeeIdentity);
  if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ report });
}

// DELETE /api/zones/[slug]/reports/[reportId] (创建者 OR canModerate) → { ok }
export async function DELETE(_req: Request, { params }: { params: { slug: string; reportId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const row = await prisma.zoneReport.findFirst({ where: { id: params.reportId, zoneId: ctx.zone.id }, select: { id: true, createdById: true } });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.createdById !== session.user.id && !ctx.access.canModerate) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await deleteZoneReport(row.id);
  return NextResponse.json({ ok: true });
}
