import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAdmin } from '@/lib/audit';
import {
  MAX_ZONE_LINKS,
  ZONE_JOIN_POLICIES,
  ZONE_LIMITS,
  ZONE_VISIBILITIES,
  isValidZoneSlug,
  parseZoneLinks,
} from '@/lib/zones/shared';
import { zoneContext } from '@/lib/zones/access';
import { getZoneDetail, softDeleteZone, updateZone } from '@/lib/zones/queries';
import { isValidZoneMediaKey, statZoneMediaAsync, type ZoneMediaKind } from '@/lib/zones/storage';
import { actingAsSiteAdmin, auditIp, invalidInput, zoneErrorResponse, zoneFail } from '../_zone-api';

export const dynamic = 'force-dynamic';

// Partial ZoneInput (+ cover/icon keys echoed from /upload). Written locally
// instead of `zoneInputSchema.partial()` because the lib exports it as a
// `ZodType<ZoneInput>` (no `.partial()` on the abstract type); the rules mirror
// it 1:1 via ZONE_LIMITS / isValidZoneSlug / parseZoneLinks.
const patchSchema = z
  .object({
    name: z.string().trim().min(ZONE_LIMITS.nameMin).max(ZONE_LIMITS.nameMax).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .refine((s) => isValidZoneSlug(s))
      .optional(),
    tagline: z.string().trim().max(ZONE_LIMITS.taglineMax).optional(),
    descriptionMd: z.string().max(ZONE_LIMITS.descriptionMax).optional(),
    lab: z.string().trim().max(ZONE_LIMITS.labMax).optional(),
    department: z.string().trim().max(ZONE_LIMITS.departmentMax).optional(),
    visibility: z.enum(ZONE_VISIBILITIES).optional(),
    joinPolicy: z.enum(ZONE_JOIN_POLICIES).optional(),
    allowGuestComments: z.boolean().optional(),
    // 栏目: members may create their own from the composer (版主 always can).
    allowMemberColumns: z.boolean().optional(),
    links: z
      .array(z.unknown())
      .max(MAX_ZONE_LINKS)
      .transform((v) => parseZoneLinks(v))
      .optional(),
    coverKey: z.string().max(200).nullable().optional(),
    iconKey: z.string().max(200).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined));

const BRAND_FIELDS: ReadonlyArray<{ field: 'coverKey' | 'iconKey'; kind: ZoneMediaKind }> = [
  { field: 'coverKey', kind: 'cover' },
  { field: 'iconKey', kind: 'icon' },
];

// GET /api/zones/[slug] → { zone: ZoneDetailView } (access pre-decided inside).
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const zone = await getZoneDetail(params.slug, ctx.viewer);
  if (!zone) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ zone });
}

// PATCH /api/zones/[slug] — settings (zone `manage`). Cover/icon keys must be
// a valid `cover/`|`icon/` key that exists on disk and is not another zone's.
export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canManage) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return invalidInput();
  const patch = parsed.data;

  // The slug is IMMUTABLE after creation: the settings form renders it read-only
  // and every stored notification `link` / bookmark deep link embeds it, so a
  // rename would silently break them. An echoed identical value is a harmless
  // no-op; a different one is refused and never reaches updateZone.
  if (patch.slug !== undefined) {
    if (patch.slug !== zone.slug) return zoneFail('slug_immutable', 400);
    delete patch.slug;
  }

  for (const { field, kind } of BRAND_FIELDS) {
    const key = patch[field];
    if (key === undefined || key === null) continue;
    if (!isValidZoneMediaKey(key, kind) || !(await statZoneMediaAsync(key))) return zoneFail('media_invalid', 400);
    // No ownership ledger for brand files: refcount against other zones so a
    // key visible in someone else's URL cannot be claimed twice.
    const inUse = await prisma.zone.findFirst({ where: { [field]: key, id: { not: zone.id } }, select: { id: true } });
    if (inUse) return zoneFail('media_in_use', 400);
  }

  try {
    await updateZone(zone.id, patch);
  } catch (e) {
    return zoneErrorResponse(e);
  }

  if (actingAsSiteAdmin(access)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'update_zone',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, fields: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined) },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ ok: true, slug: zone.slug });
}

// DELETE /api/zones/[slug] — soft delete (owner OR site admin).
export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.isOwner && !access.siteAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (!zone.deletedAt) {
    try {
      await softDeleteZone(zone.id);
    } catch (e) {
      return zoneErrorResponse(e);
    }
  }

  if (access.siteAdmin) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_zone',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, name: zone.name, asOwner: access.isOwner },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ ok: true });
}
