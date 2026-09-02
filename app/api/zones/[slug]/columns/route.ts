// 技术专区 — 栏目 (ask #2). THE per-zone content taxonomy (2026-09: the
// ZonePostType column stays in the schema but is hidden from every UI and
// defaults to `article`; `announcement` is a moderator flag set from the post's
// ⋯ menu, not a choice — see lib/zones/shared.ts). 版主 curates the official
// 栏目 here, members may add their own when `Zone.allowMemberColumns`.
//
// The composer's create-on-the-fly path does NOT come through this route — it
// rides `columnName` on the post payload, which `createZonePost` resolves via
// `getOrCreateColumn` inside the same write. This route is the explicit
// (版块设置 / picker) surface.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { logAdmin } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import {
  getOrCreateColumn,
  getZoneColumn,
  listZoneColumns,
  reorderZoneColumns,
  updateZoneColumn,
} from '@/lib/zones/columns';
import { MAX_ZONE_COLUMNS, ZONE_LIMITS } from '@/lib/zones/shared';
import {
  MINUTE_MS,
  actingAsSiteAdmin,
  auditIp,
  invalidInput,
  zoneErrorResponse,
  zoneFail,
  zoneReason,
} from '../../_zone-api';

export const dynamic = 'force-dynamic';

const COLUMN_WRITES_PER_MINUTE = 30;

const createSchema = z.object({
  name: z.string().trim().min(1).max(ZONE_LIMITS.columnNameMax * 2),
  description: z.string().trim().max(ZONE_LIMITS.columnDescriptionMax).optional(),
  official: z.boolean().optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().trim().min(1).max(64)).min(1).max(MAX_ZONE_COLUMNS),
});

/**
 * ZoneError → the house payload. `zone_columns_full` interpolates `{limit}`;
 * kept LOCAL (not exported) because the App Router rejects non-handler exports
 * from a `route.ts`.
 */
async function columnErrorResponse(e: unknown): Promise<NextResponse> {
  if (e instanceof ZoneError) {
    const reason = await zoneReason(e.code, { limit: MAX_ZONE_COLUMNS, max: MAX_ZONE_COLUMNS });
    return NextResponse.json({ error: e.code, ...(reason ? { reason } : {}) }, { status: e.status });
  }
  // Serializable clash / unique race → 409; anything else is a real bug and rethrows.
  return zoneErrorResponse(e);
}

/** `Zone.allowMemberColumns` is not part of ZONE_ACCESS_SELECT — read it per request. */
async function allowsMemberColumns(zoneId: string): Promise<boolean> {
  const row = await prisma.zone.findUnique({ where: { id: zoneId }, select: { allowMemberColumns: true } });
  return !!row?.allowMemberColumns;
}

// GET /api/zones/[slug]/columns → { items, allowMemberColumns, canCreate }
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const [items, allowMemberColumns] = await Promise.all([
    listZoneColumns(ctx.zone.id),
    allowsMemberColumns(ctx.zone.id),
  ]);
  return NextResponse.json({
    items,
    allowMemberColumns,
    canCreate: ctx.access.canModerate || (allowMemberColumns && ctx.access.canPost),
  });
}

// POST /api/zones/[slug]/columns { name, description?, official? } → { column, created }
//   official (default: whatever the caller can do) ⇒ `moderate`;
//   member columns ⇒ `post` + Zone.allowMemberColumns.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const gate = rateLimit(`zones:column-write:${session.user.id}`, COLUMN_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_column', 429, { resetAt: gate.resetAt });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput();

  // A 版主 creating from 版块设置 gets an OFFICIAL column by default; a member
  // can only ever create a personal one, and asking for `official` is a 403.
  const official = parsed.data.official ?? access.canModerate;
  if (official && !access.canModerate) return zoneFail('column_create_forbidden', 403);
  if (!official && !access.canModerate && !(access.canPost && (await allowsMemberColumns(zone.id)))) {
    return zoneFail('column_create_forbidden', 403);
  }

  try {
    // Typing a name that already exists PICKS that column instead of forking a
    // twin (getOrCreateColumn dedupes on columnDedupeKey), so `created` tells the
    // client which of the two happened. `description` is a 版主 field.
    const { id, created } = await getOrCreateColumn(zone.id, parsed.data.name, {
      userId: session.user.id,
      official,
      allowCreate: true,
    });
    const description = (parsed.data.description ?? '').trim();
    if (official && description) await updateZoneColumn(zone.id, id, { description });

    const column = await getZoneColumn(zone.id, id);
    if (!column) return zoneFail('column_not_found', 404);

    if (created && actingAsSiteAdmin(access)) {
      await logAdmin({
        adminUserId: session.user.id,
        action: 'create_zone_column',
        targetType: 'zone',
        targetId: zone.id,
        details: { slug: zone.slug, column: column.name, official },
        ip: auditIp(req),
      });
    }
    return NextResponse.json({ column, created }, { status: created ? 201 : 200 });
  } catch (e) {
    return columnErrorResponse(e);
  }
}

// PATCH /api/zones/[slug]/columns { orderedIds } → { ok: true, items }  (moderate)
export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canModerate) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`zones:column-write:${session.user.id}`, COLUMN_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_column', 429, { resetAt: gate.resetAt });

  const parsed = reorderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput();

  try {
    await reorderZoneColumns(ctx.zone.id, parsed.data.orderedIds);
  } catch (e) {
    return columnErrorResponse(e);
  }
  return NextResponse.json({ ok: true, items: await listZoneColumns(ctx.zone.id) });
}
