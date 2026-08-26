// 技术专区 — a single 栏目 (rename / describe / promote / reorder / delete).
// 版主 only (`moderate`): a member may create a column from the composer, but
// curating the zone's taxonomy is a moderation act.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { deleteZoneColumn, getZoneColumn, updateZoneColumn } from '@/lib/zones/columns';
import { MAX_ZONE_COLUMNS, ZONE_LIMITS } from '@/lib/zones/shared';
import {
  MINUTE_MS,
  actingAsSiteAdmin,
  auditIp,
  invalidInput,
  zoneErrorResponse,
  zoneFail,
  zoneReason,
} from '../../../_zone-api';

export const dynamic = 'force-dynamic';

const COLUMN_WRITES_PER_MINUTE = 30;

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(ZONE_LIMITS.columnNameMax * 2).optional(),
    description: z.string().trim().max(ZONE_LIMITS.columnDescriptionMax).optional(),
    official: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'empty_patch' });

const deleteSchema = z.object({
  moveToColumnId: z.string().trim().max(64).nullable().optional(),
});

/** Local (route files may not export helpers); `{limit}` feeds `zone_columns_full`. */
async function columnErrorResponse(e: unknown): Promise<NextResponse> {
  if (e instanceof ZoneError) {
    const reason = await zoneReason(e.code, { limit: MAX_ZONE_COLUMNS, max: MAX_ZONE_COLUMNS });
    return NextResponse.json({ error: e.code, ...(reason ? { reason } : {}) }, { status: e.status });
  }
  // Serializable clash / unique race → 409; anything else is a real bug and rethrows.
  return zoneErrorResponse(e);
}

// PATCH /api/zones/[slug]/columns/[columnId] { name?, description?, official?, sortOrder? } → { column }
export async function PATCH(req: Request, { params }: { params: { slug: string; columnId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canModerate) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`zones:column-write:${session.user.id}`, COLUMN_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_column', 429, { resetAt: gate.resetAt });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput();

  let column;
  try {
    column = await updateZoneColumn(ctx.zone.id, params.columnId, parsed.data);
  } catch (e) {
    return columnErrorResponse(e);
  }

  if (actingAsSiteAdmin(ctx.access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'update_zone_column',
      targetType: 'zone',
      targetId: ctx.zone.id,
      details: { slug: ctx.zone.slug, columnId: column.id, fields: Object.keys(parsed.data) },
      ip: auditIp(req),
    });
  }
  return NextResponse.json({ column });
}

// DELETE /api/zones/[slug]/columns/[columnId]?moveToColumnId=… (or the same key
//   in a JSON body) → { ok: true }. The column's posts move to the target 栏目,
//   or fall back to 未归栏 (the FK is SetNull); both counts are recomputed.
export async function DELETE(req: Request, { params }: { params: { slug: string; columnId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canModerate) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`zones:column-write:${session.user.id}`, COLUMN_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_column', 429, { resetAt: gate.resetAt });

  // Some clients cannot send a DELETE body — the query param is the fallback.
  const parsedBody = deleteSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsedBody.success) return invalidInput();
  const fromQuery = new URL(req.url).searchParams.get('moveToColumnId');
  const moveToColumnId = parsedBody.data.moveToColumnId ?? (fromQuery ? fromQuery.trim().slice(0, 64) : null);

  const existing = await getZoneColumn(ctx.zone.id, params.columnId);
  if (!existing) return zoneFail('column_not_found', 404);

  try {
    await deleteZoneColumn(ctx.zone.id, params.columnId, { moveToColumnId });
  } catch (e) {
    return columnErrorResponse(e);
  }

  if (actingAsSiteAdmin(ctx.access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_zone_column',
      targetType: 'zone',
      targetId: ctx.zone.id,
      details: { slug: ctx.zone.slug, column: existing.name, movedTo: moveToColumnId },
      ip: auditIp(req),
    });
  }
  return NextResponse.json({ ok: true });
}
