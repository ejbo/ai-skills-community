import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiReason } from '@/lib/api-errors';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { setReportCoauthors } from '@/lib/zones/reports/queries';
import { gateReport, isResponse, toolContext } from '@/lib/zones/reports/tool-api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ userIds: z.array(z.string().min(1).max(64)).max(ZONE_LIMITS.maxCoauthors) });

// PUT /api/tools/chat-report/[reportId]/coauthors (owner；报告已分享到版块)
//   { userIds } → 200 { postId }   整体替换合著者（docs/contracts/reports.md §3a）
export async function PUT(req: Request, { params }: { params: { reportId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'own');
  if (isResponse(row)) return row;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', reason: await apiReason('invalid_request') }, { status: 400 });
  const res = await setReportCoauthors(row.id, ctx.session.user.id, parsed.data.userIds);
  if (!res) return NextResponse.json({ error: 'not_published', reason: await apiReason('report_not_published') }, { status: 409 });
  return NextResponse.json(res);
}
