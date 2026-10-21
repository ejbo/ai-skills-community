import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { apiReason } from '@/lib/api-errors';
import { ZoneError } from '@/lib/zones/queries';
import { deleteZoneReport, getReportDetail, reportSettingsInputSchema, updateReportSettings } from '@/lib/zones/reports/queries';
import { gateReport, isResponse, toolContext } from '@/lib/zones/reports/tool-api';
import { isReportOwner } from '@/lib/zones/reports/visibility';

export const dynamic = 'force-dynamic';

// GET /api/tools/chat-report/[reportId] (canSeeReport) → { report: ZoneReportDetailView } — 详情页轮询这里
export async function GET(_req: Request, { params }: { params: { reportId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'read');
  if (isResponse(row)) return row;
  const report = await getReportDetail(row.id, ctx.session.user.id, ctx.siteViewer.canSeeIdentity, { withAudience: isReportOwner(row, ctx.viewer) });
  if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ report });
}

// PATCH /api/tools/chat-report/[reportId] (owner) { title?, visibility?, audienceUserIds? } → { ok }
export async function PATCH(req: Request, { params }: { params: { reportId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'own');
  if (isResponse(row)) return row;
  const parsed = reportSettingsInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', reason: await apiReason('invalid_request') }, { status: 400 });
  try {
    await updateReportSettings(row.id, ctx.session.user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ZoneError) return NextResponse.json({ error: e.code, reason: await apiReason(`zone_${e.code}`) }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return NextResponse.json({ error: 'conflict' }, { status: 409 });
    throw e;
  }
}

// DELETE /api/tools/chat-report/[reportId] (owner) → { ok }   已分享的帖子保留（它自己有删除路径）
export async function DELETE(_req: Request, { params }: { params: { reportId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'own');
  if (isResponse(row)) return row;
  await deleteZoneReport(row.id);
  return NextResponse.json({ ok: true });
}
