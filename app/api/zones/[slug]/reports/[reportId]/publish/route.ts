import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { publishReportInputSchema, publishZoneReport } from '@/lib/zones/reports/queries';

export const dynamic = 'force-dynamic';

// POST /api/zones/[slug]/reports/[reportId]/publish (canPost; 创建者 OR canModerate)
//   { coauthorUserIds, columnId, visibility, status, includeStats } → { id, slug }
export async function POST(req: Request, { params }: { params: { slug: string; reportId: string } }) {
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

  const body = await req.json().catch(() => ({}));
  const parsed = publishReportInputSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', reason: await apiReason('invalid_request') }, { status: 400 });
  try {
    const post = await publishZoneReport(ctx.zone, row.id, session.user.id, parsed.data, { canModerate: ctx.access.canModerate });
    return NextResponse.json(post, { status: 201 });
  } catch (e) {
    if (e instanceof ZoneError) return NextResponse.json({ error: e.code, reason: await apiReason(`zone_${e.code}`) }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return NextResponse.json({ error: 'conflict', reason: await apiReason('zone_conflict') }, { status: 409 });
    }
    throw e;
  }
}
