import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getLocale } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { logAdmin } from '@/lib/audit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { deleteWikiPage, getWikiPageById, updateWikiPage, type WikiPageInput } from '@/lib/zones/wiki-queries';
import { ZONE_LIMITS, isValidWikiSlug } from '@/lib/zones/shared';

export const dynamic = 'force-dynamic';

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

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(ZONE_LIMITS.wikiTitleMax).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .refine((s) => isValidWikiSlug(s), { message: 'invalid_slug' })
      .optional(),
    bodyMd: z.string().max(ZONE_LIMITS.wikiBodyMax).optional(),
    parentId: z.string().min(1).max(64).nullable().optional(),
    note: z.string().trim().max(ZONE_LIMITS.wikiNoteMax).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'empty_patch' });

/** The page must belong to THIS zone and be alive — a slug-only match is not enough. */
async function loadPage(pageId: string, zoneId: string) {
  const page = await prisma.zoneWikiPage.findUnique({
    where: { id: pageId },
    select: { id: true, zoneId: true, slug: true, title: true, deletedAt: true },
  });
  if (!page || page.zoneId !== zoneId || page.deletedAt) return null;
  return page;
}

// GET /api/zones/[slug]/wiki/[pageId] (canRead) → { page: WikiPageView }
export async function GET(_req: Request, { params }: { params: { slug: string; pageId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const row = await loadPage(params.pageId, ctx.zone.id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const locale = await getLocale();
  const page = await getWikiPageById(row.id, { viewer: ctx.viewer, session, locale });
  if (!page) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ page });
}

// PATCH /api/zones/[slug]/wiki/[pageId] { title?, slug?, bodyMd?, parentId?, note? } (canWiki) → { ok }
export async function PATCH(req: Request, { params }: { params: { slug: string; pageId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canWiki) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_wiki_forbidden') }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? (await apiReason('invalid_request')) },
      { status: 400 },
    );
  }

  const row = await loadPage(params.pageId, ctx.zone.id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // A page cannot be its own parent; deeper cycles are the lib layer's check.
  if (parsed.data.parentId && parsed.data.parentId === row.id) {
    return NextResponse.json({ error: 'wiki_cycle', reason: await apiReason('zone_wiki_cycle') }, { status: 400 });
  }

  const input: Partial<WikiPageInput> = {};
  if (parsed.data.title !== undefined) input.title = parsed.data.title;
  if (parsed.data.slug !== undefined) input.slug = parsed.data.slug;
  if (parsed.data.bodyMd !== undefined) input.bodyMd = parsed.data.bodyMd;
  if (parsed.data.parentId !== undefined) input.parentId = parsed.data.parentId;
  if (parsed.data.note !== undefined) input.note = parsed.data.note;

  try {
    await updateWikiPage(row.id, input, session.user.id);
  } catch (e) {
    const res = await zoneErrorResponse(e);
    if (res) return res;
    throw e;
  }

  if (ctx.access.siteAdmin && !ctx.access.isMember) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'edit_zone_wiki',
      targetType: 'zone_wiki_page',
      targetId: row.id,
      details: { zoneSlug: ctx.zone.slug, title: row.title, fields: Object.keys(input) },
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/zones/[slug]/wiki/[pageId] (canWiki) → soft delete, children reparent → { ok }
export async function DELETE(_req: Request, { params }: { params: { slug: string; pageId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canWiki) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_wiki_forbidden') }, { status: 403 });
  }

  const row = await loadPage(params.pageId, ctx.zone.id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    await deleteWikiPage(row.id);
  } catch (e) {
    const res = await zoneErrorResponse(e);
    if (res) return res;
    throw e;
  }

  if (ctx.access.siteAdmin && !ctx.access.isMember) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_zone_wiki',
      targetType: 'zone_wiki_page',
      targetId: row.id,
      details: { zoneSlug: ctx.zone.slug, title: row.title, slug: row.slug },
    });
  }

  return NextResponse.json({ ok: true });
}
