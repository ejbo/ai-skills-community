import { NextResponse } from 'next/server';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getReportMessages, parseMessageIds } from '@/lib/zones/reports/messages';
import { gateReport, isResponse, toolContext } from '@/lib/zones/reports/tool-api';

export const dynamic = 'force-dynamic';

// GET /api/tools/chat-report/[reportId]/messages?ids=m12,m13 — 「看原文」的数据（能看报告就能看；≤ 60 条）
// 报告正文里就地展开（docs/contracts/reports.md §3a），不再开新页。
export async function GET(req: Request, { params }: { params: { reportId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'read');
  if (isResponse(row)) return row;
  const ids = parseMessageIds(new URL(req.url).searchParams.get('ids') ?? '');
  const data = await getReportMessages(row.id, ids, zoneSiteViewer(ctx.session.user).canSeeIdentity);
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ...data, requested: ids.length }, { headers: { 'cache-control': 'private, max-age=300' } });
}
