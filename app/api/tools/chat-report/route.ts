import { NextResponse } from 'next/server';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { ZoneError } from '@/lib/zones/queries';
import { createReport, createReportInputSchema, listMyReports } from '@/lib/zones/reports/queries';
import { isResponse, toolContext } from '@/lib/zones/reports/tool-api';

export const dynamic = 'force-dynamic';

const REPORTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

// GET /api/tools/chat-report → { items: ZoneReportView[] }   我创建的
export async function GET() {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const items = await listMyReports(ctx.session.user.id, ctx.siteViewer.canSeeIdentity);
  return NextResponse.json({ items });
}

// POST /api/tools/chat-report { title, kind, subject, periodStart, periodEnd, bundleKey | sourceKey…, instructions, instructionMode } → 201 { id }
export async function POST(req: Request) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const gate = rateLimit(`tools:chat-report:${ctx.session.user.id}`, REPORTS_PER_HOUR, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited', reason: await apiReason('zone_rate_limited_report'), resetAt: gate.resetAt }, { status: 429 });
  const body = await req.json().catch(() => null);
  const parsed = createReportInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', reason: parsed.error.issues[0]?.message ?? (await apiReason('invalid_request')) }, { status: 400 });
  }
  try {
    const { id } = await createReport(ctx.session.user.id, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof ZoneError) return NextResponse.json({ error: e.code, reason: await apiReason(`zone_${e.code}`) }, { status: e.status });
    throw e;
  }
}
