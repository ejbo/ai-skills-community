import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { createWikiPage, getWikiTree, wikiPageInputSchema } from '@/lib/zones/wiki-queries';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const WIKI_WRITES_PER_MINUTE = 30;

/** ZoneError code (lib/zones/wiki-queries.ts) → api_errors key. */
const REASON_KEYS: Readonly<Record<string, string>> = {
  wiki_slug_taken: 'zone_wiki_slug_taken',
  wiki_slug_invalid: 'zone_wiki_slug_invalid',
  wiki_title_required: 'zone_wiki_title_required',
  wiki_parent_invalid: 'zone_wiki_parent_invalid',
  wiki_cycle: 'zone_wiki_cycle',
  wiki_reorder_invalid: 'zone_wiki_reorder_invalid',
};

async function zoneErrorResponse(e: unknown): Promise<NextResponse | null> {
  if (e instanceof ZoneError) {
    const key = REASON_KEYS[e.code];
    const reason = key ? await apiReason(key) : undefined;
    return NextResponse.json({ error: e.code, ...(reason ? { reason } : {}) }, { status: e.status });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
    return NextResponse.json({ error: 'conflict', reason: await apiReason('zone_conflict') }, { status: 409 });
  }
  return null;
}

// GET /api/zones/[slug]/wiki (canRead) → { tree: WikiTreeNode[] }
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const tree = await getWikiTree(ctx.zone.id);
  return NextResponse.json({ tree });
}

// POST /api/zones/[slug]/wiki { title, slug?, bodyMd, parentId?, note? } (canWiki) → 201 { id, slug }
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:wiki:${session.user.id}`, WIKI_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canWiki) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_wiki_forbidden') }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = wikiPageInputSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? (await apiReason('invalid_request')) },
      { status: 400 },
    );
  }

  try {
    const created = await createWikiPage(ctx.zone.id, parsed.data, session.user.id);
    return NextResponse.json({ id: created.id, slug: created.slug }, { status: 201 });
  } catch (e) {
    const res = await zoneErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
