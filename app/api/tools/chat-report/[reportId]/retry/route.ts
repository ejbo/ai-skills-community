import { NextResponse } from 'next/server';
import { apiReason } from '@/lib/api-errors';
import { retryZoneReport } from '@/lib/zones/reports/queries';
import { gateReport, isResponse, toolContext } from '@/lib/zones/reports/tool-api';

export const dynamic = 'force-dynamic';

// POST /api/tools/chat-report/[reportId]/retry (owner; failed / 中断 only) → { ok }
export async function POST(_req: Request, { params }: { params: { reportId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'own');
  if (isResponse(row)) return row;
  const ok = await retryZoneReport(row.id);
  if (!ok) return NextResponse.json({ error: 'report_not_failed', reason: await apiReason('zone_report_not_failed') }, { status: 409 });
  return NextResponse.json({ ok: true });
}
