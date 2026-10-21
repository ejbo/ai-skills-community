import { NextResponse } from 'next/server';
import { apiReason } from '@/lib/api-errors';
import { prisma } from '@/lib/db';
import { ingestOneReportAsset } from '@/lib/zones/reports/library';
import { gateReport, isResponse, toolContext } from '@/lib/zones/reports/tool-api';

export const dynamic = 'force-dynamic';

// POST /api/tools/chat-report/[reportId]/assets/[assetId]/library (owner)
//   把这一个附件分享进全站知识库 → 200 { docId, slug, existing }（docs/contracts/reports.md §2 收录）
export async function POST(_req: Request, { params }: { params: { reportId: string; assetId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'own');
  if (isResponse(row)) return row;
  const asset = await prisma.zoneReportAsset.findFirst({ where: { id: params.assetId, reportId: row.id }, select: { id: true } });
  if (!asset) return NextResponse.json({ error: 'not_found', reason: await apiReason('report_asset_not_found') }, { status: 404 });
  const res = await ingestOneReportAsset(asset.id, ctx.session.user.id);
  if (!res.ok) {
    const status = res.reason === 'not_found' ? 404 : res.reason === 'unsupported' ? 415 : 500;
    return NextResponse.json({ error: res.reason, reason: res.message ?? (await apiReason(res.reason === 'unsupported' ? 'report_asset_unsupported' : 'report_asset_share_failed')) }, { status });
  }
  return NextResponse.json({ docId: res.docId, slug: res.slug, existing: res.existing });
}
