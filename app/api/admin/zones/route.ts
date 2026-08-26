import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import {
  MAX_ZONE_LINKS,
  ZONE_JOIN_POLICIES,
  ZONE_LIMITS,
  ZONE_SLUG_MAX,
  ZONE_VISIBILITIES,
  isValidZoneSlug,
  parseZoneLinks,
  slugifyAscii,
} from '@/lib/zones/shared';
import { createZone, zoneInputSchema } from '@/lib/zones/queries';
import { auditIp, intParam, strParam, zoneErrorResponse, zoneFail } from '../../zones/_zone-api';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const ADMIN_ROW_SELECT = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  lab: true,
  department: true,
  visibility: true,
  joinPolicy: true,
  featured: true,
  memberCount: true,
  postCount: true,
  lastActivityAt: true,
  createdAt: true,
  deletedAt: true,
  owner: { select: { id: true, handle: true, displayName: true } },
} as const;

// GET /api/admin/zones?q&page&pageSize&deleted=only|none → { items, total, page, pageSize }
// Admin rows INCLUDE soft-deleted zones by default (the manager shows 恢复).
export async function GET(req: Request) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;

  const sp = new URL(req.url).searchParams;
  const q = strParam(sp.get('q'), 100);
  const page = intParam(sp.get('page'), 1, 1, 10_000);
  const pageSize = intParam(sp.get('pageSize'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const deleted = sp.get('deleted');

  const where = {
    ...(deleted === 'only' ? { deletedAt: { not: null } } : deleted === 'none' ? { deletedAt: null } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { slug: { contains: q, mode: 'insensitive' as const } },
            { lab: { contains: q, mode: 'insensitive' as const } },
            { department: { contains: q, mode: 'insensitive' as const } },
            { owner: { handle: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.zone.findMany({
      where,
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: ADMIN_ROW_SELECT,
    }),
    prisma.zone.count({ where }),
  ]);

  const items = rows.map((r) => ({
    ...r,
    lastActivityAt: r.lastActivityAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }));

  return NextResponse.json({ items, total, page, pageSize });
}

const createSchema = z.object({
  name: z.string().trim().min(ZONE_LIMITS.nameMin).max(ZONE_LIMITS.nameMax),
  slug: z.string().trim().toLowerCase().max(ZONE_SLUG_MAX).optional(),
  ownerHandle: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, ''))
    .pipe(z.string().min(1).max(64)),
  tagline: z.string().trim().max(ZONE_LIMITS.taglineMax).default(''),
  descriptionMd: z.string().max(ZONE_LIMITS.descriptionMax).default(''),
  lab: z.string().trim().max(ZONE_LIMITS.labMax).default(''),
  department: z.string().trim().max(ZONE_LIMITS.departmentMax).default(''),
  visibility: z.enum(ZONE_VISIBILITIES).default('public'),
  joinPolicy: z.enum(ZONE_JOIN_POLICIES).default('approval'),
  allowGuestComments: z.boolean().default(true),
  links: z
    .array(z.unknown())
    .max(MAX_ZONE_LINKS)
    .default([])
    .transform((v) => parseZoneLinks(v)),
});

// POST /api/admin/zones { name, slug?, ownerHandle, ... } → 201 { id, slug }.
// Creates a zone on behalf of another user (they become 主版主). Slug defaults
// to the ascii slug of the name; the payload is re-validated through the same
// zoneInputSchema the member-facing route uses.
export async function POST(req: Request) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const input = parsed.data;

  const owner = await prisma.user.findFirst({
    where: { handle: { equals: input.ownerHandle, mode: 'insensitive' } },
    select: { id: true, handle: true, isActive: true },
  });
  if (!owner) return zoneFail('owner_not_found', 404);
  if (!owner.isActive) return zoneFail('user_inactive', 400);

  const slug = input.slug || slugifyAscii(input.name) || `zone-${Date.now().toString(36)}`;
  if (!isValidZoneSlug(slug)) return NextResponse.json({ error: 'invalid_input', field: 'slug' }, { status: 400 });

  const zoneInput = zoneInputSchema.safeParse({
    name: input.name,
    slug,
    tagline: input.tagline,
    descriptionMd: input.descriptionMd,
    lab: input.lab,
    department: input.department,
    visibility: input.visibility,
    joinPolicy: input.joinPolicy,
    allowGuestComments: input.allowGuestComments,
    links: input.links,
  });
  if (!zoneInput.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  let created: { id: string; slug: string };
  try {
    created = await createZone(zoneInput.data, owner.id);
  } catch (e) {
    return zoneErrorResponse(e);
  }

  await logAdmin({
    adminUserId: session.user.id,
    action: 'create_zone',
    targetType: 'zone',
    targetId: created.id,
    details: { slug: created.slug, name: input.name, ownerId: owner.id, ownerHandle: owner.handle },
    ip: auditIp(req),
  });

  return NextResponse.json({ id: created.id, slug: created.slug }, { status: 201 });
}
