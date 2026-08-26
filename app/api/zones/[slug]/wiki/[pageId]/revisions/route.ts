import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { listWikiRevisions } from '@/lib/zones/wiki-queries';

export const dynamic = 'force-dynamic';

// GET /api/zones/[slug]/wiki/[pageId]/revisions?take (canRead) → { items: WikiRevisionView[] }
export async function GET(req: Request, { params }: { params: { slug: string; pageId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const page = await prisma.zoneWikiPage.findUnique({
    where: { id: params.pageId },
    select: { id: true, zoneId: true, deletedAt: true },
  });
  if (!page || page.zoneId !== ctx.zone.id || page.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const takeRaw = Number.parseInt(new URL(req.url).searchParams.get('take') ?? '', 10);
  const take = Number.isFinite(takeRaw) ? Math.min(200, Math.max(1, takeRaw)) : undefined;

  const items = await listWikiRevisions(page.id, take, ctx.access.canSeeIdentity);
  return NextResponse.json({ items });
}
