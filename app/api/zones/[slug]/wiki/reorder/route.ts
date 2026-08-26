import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { reorderWikiPages } from '@/lib/zones/wiki-queries';

export const dynamic = 'force-dynamic';

const MAX_ORDERS = 500;

const schema = z.object({
  orders: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        parentId: z.string().min(1).max(64).nullable(),
        sortOrder: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(MAX_ORDERS),
});

// POST /api/zones/[slug]/wiki/reorder { orders: [{ id, parentId, sortOrder }] } (canWiki) → { ok }
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canWiki) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_wiki_forbidden') }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // Duplicate ids or a self-parent are client bugs — refuse before the lib layer.
  const ids = new Set<string>();
  for (const o of parsed.data.orders) {
    if (ids.has(o.id) || o.parentId === o.id) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    ids.add(o.id);
  }

  try {
    await reorderWikiPages(ctx.zone.id, parsed.data.orders);
  } catch (e) {
    if (e instanceof ZoneError) {
      const reasonKey =
        e.code === 'wiki_cycle'
          ? 'zone_wiki_cycle'
          : e.code === 'wiki_parent_invalid'
            ? 'zone_wiki_parent_invalid'
            : e.code === 'wiki_reorder_invalid'
              ? 'zone_wiki_reorder_invalid'
              : null;
      const reason = reasonKey ? await apiReason(reasonKey) : undefined;
      return NextResponse.json({ error: e.code, ...(reason ? { reason } : {}) }, { status: e.status });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return NextResponse.json({ error: 'conflict', reason: await apiReason('zone_conflict') }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
