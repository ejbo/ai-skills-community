import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { logAdmin } from '@/lib/audit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { getWikiRevision, restoreWikiRevision } from '@/lib/zones/wiki-queries';

export const dynamic = 'force-dynamic';

async function loadPage(pageId: string, zoneId: string) {
  const page = await prisma.zoneWikiPage.findUnique({
    where: { id: pageId },
    select: { id: true, zoneId: true, title: true, deletedAt: true },
  });
  if (!page || page.zoneId !== zoneId || page.deletedAt) return null;
  return page;
}

// GET /api/zones/[slug]/wiki/[pageId]/revisions/[revisionId] (canRead) → { revision (with bodyMd) }
export async function GET(
  _req: Request,
  { params }: { params: { slug: string; pageId: string; revisionId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const page = await loadPage(params.pageId, ctx.zone.id);
  if (!page) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const revision = await getWikiRevision(page.id, params.revisionId, ctx.access.canSeeIdentity);
  if (!revision) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ revision });
}

// POST /api/zones/[slug]/wiki/[pageId]/revisions/[revisionId] (canWiki) — restore → { ok }
export async function POST(
  _req: Request,
  { params }: { params: { slug: string; pageId: string; revisionId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canWiki) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_wiki_forbidden') }, { status: 403 });
  }

  const page = await loadPage(params.pageId, ctx.zone.id);
  if (!page) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const revision = await getWikiRevision(page.id, params.revisionId, ctx.access.canSeeIdentity);
  if (!revision) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    await restoreWikiRevision(page.id, revision.id, session.user.id);
  } catch (e) {
    if (e instanceof ZoneError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return NextResponse.json({ error: 'conflict', reason: await apiReason('zone_conflict') }, { status: 409 });
    }
    throw e;
  }

  if (ctx.access.siteAdmin && !ctx.access.isMember) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'restore_zone_wiki_revision',
      targetType: 'zone_wiki_page',
      targetId: page.id,
      details: { zoneSlug: ctx.zone.slug, title: page.title, revisionId: revision.id },
    });
  }

  return NextResponse.json({ ok: true });
}
