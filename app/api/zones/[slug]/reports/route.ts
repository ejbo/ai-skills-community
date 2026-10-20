import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { createReportInputSchema, createZoneReport, listZoneReports } from '@/lib/zones/reports/queries';
import { HOUR_MS } from '../../_zone-api';

export const dynamic = 'force-dynamic';

const REPORTS_PER_HOUR = 5;

// GET /api/zones/[slug]/reports (canRead) → { items: ZoneReportView[] }
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  const items = await listZoneReports(ctx.zone.id, ctx.viewer.id, ctx.access.canSeeIdentity);
  return NextResponse.json({ items });
}

// POST /api/zones/[slug]/reports (canPost) { title, kind, subject, periodStart, periodEnd, sourceKey, sourceName, manifestKey, importKey, assets[] }
//   → 201 { id }   files are uploaded first through /attachments/upload (kind 'file' / 'image')
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canPost) return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_post_forbidden') }, { status: 403 });

  const gate = rateLimit(`zones:reports:${session.user.id}`, REPORTS_PER_HOUR, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited', reason: await apiReason('zone_rate_limited_report'), resetAt: gate.resetAt }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = createReportInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', reason: parsed.error.issues[0]?.message ?? (await apiReason('invalid_request')) }, { status: 400 });
  }
  try {
    const { id } = await createZoneReport(ctx.zone.id, session.user.id, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof ZoneError) return NextResponse.json({ error: e.code, reason: await apiReason(`zone_${e.code}`) }, { status: e.status });
    throw e;
  }
}
