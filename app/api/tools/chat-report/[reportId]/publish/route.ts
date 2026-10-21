import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { publishReportInputSchema, publishZoneReport } from '@/lib/zones/reports/queries';
import { gateReport, isResponse, toolContext } from '@/lib/zones/reports/tool-api';

export const dynamic = 'force-dynamic';

const bodySchema = publishReportInputSchema.extend({ zoneSlug: z.string().trim().min(1).max(120) });

// POST /api/tools/chat-report/[reportId]/publish (owner；目标版块要 canPost)
//   { zoneSlug, coauthorUserIds, columnId, visibility, status, includeStats } → 201 { id, slug }
export async function POST(req: Request, { params }: { params: { reportId: string } }) {
  const ctx = await toolContext();
  if (isResponse(ctx)) return ctx;
  const row = await gateReport(ctx, params.reportId, 'own');
  if (isResponse(row)) return row;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', reason: await apiReason('invalid_request') }, { status: 400 });
  const { zoneSlug, ...input } = parsed.data;
  const zc = await zoneContext(zoneSlug, ctx.session);
  if (!zc) return NextResponse.json({ error: 'not_found', reason: await apiReason('zone_not_found') }, { status: 404 });
  if (!zc.access.canPost && !zc.access.canModerate) return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_post_forbidden') }, { status: 403 });
  try {
    const post = await publishZoneReport(zc.zone, row.id, ctx.session.user.id, input, { canModerate: zc.access.canModerate });
    return NextResponse.json({ ...post, zoneSlug: zc.zone.slug }, { status: 201 });
  } catch (e) {
    if (e instanceof ZoneError) return NextResponse.json({ error: e.code, reason: await apiReason(`zone_${e.code}`) }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return NextResponse.json({ error: 'conflict', reason: await apiReason('zone_conflict') }, { status: 409 });
    throw e;
  }
}
