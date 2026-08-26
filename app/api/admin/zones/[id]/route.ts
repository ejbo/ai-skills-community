import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { notifyZoneMember } from '@/lib/notifications';
import { addZoneMember, restoreZone, softDeleteZone, transferZoneOwnership } from '@/lib/zones/queries';
import { auditIp, zoneErrorResponse, zoneFail } from '../../../zones/_zone-api';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    featured: z.boolean().optional(),
    restore: z.literal(true).optional(),
    ownerId: z.string().trim().min(1).max(64).optional(),
    ownerHandle: z
      .string()
      .trim()
      .transform((s) => s.replace(/^@/, ''))
      .pipe(z.string().min(1).max(64))
      .optional(),
  })
  .refine((v) => v.featured !== undefined || v.restore !== undefined || v.ownerId !== undefined || v.ownerHandle !== undefined);

const ZONE_SELECT = {
  id: true,
  slug: true,
  name: true,
  ownerId: true,
  featured: true,
  deletedAt: true,
} as const;

type Params = { params: { id: string } };

// PATCH /api/admin/zones/[id] { featured?, restore?: true, ownerId? | ownerHandle? } → { ok, zone }
// (site `zones` permission; every change is logAdmin'd). Ownership may go to
// ANY active user — a non-member is added as an active member first, so the
// lib invariant (new owner must be an active member) holds.
export async function PATCH(req: Request, { params }: Params) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { featured, restore, ownerId, ownerHandle } = parsed.data;

  const zone = await prisma.zone.findUnique({ where: { id: params.id }, select: ZONE_SELECT });
  if (!zone) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (featured !== undefined && featured !== zone.featured) {
    await prisma.zone.update({
      where: { id: zone.id },
      data: { featured, featuredAt: featured ? new Date() : null },
    });
    await logAdmin({
      adminUserId: session.user.id,
      action: featured ? 'feature_zone' : 'unfeature_zone',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, name: zone.name, featured: { before: zone.featured, after: featured } },
      ip: auditIp(req),
    });
  }

  if (restore && zone.deletedAt) {
    try {
      await restoreZone(zone.id);
    } catch (e) {
      return zoneErrorResponse(e);
    }
    await logAdmin({
      adminUserId: session.user.id,
      action: 'restore_zone',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, name: zone.name },
      ip: auditIp(req),
    });
  }

  if (ownerId !== undefined || ownerHandle !== undefined) {
    const owner = ownerId
      ? await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, handle: true, isActive: true } })
      : await prisma.user.findFirst({
          where: { handle: { equals: ownerHandle ?? '', mode: 'insensitive' } },
          select: { id: true, handle: true, isActive: true },
        });
    if (!owner) return zoneFail('owner_not_found', 404);
    if (!owner.isActive) return zoneFail('user_inactive', 400);

    if (owner.id !== zone.ownerId) {
      try {
        const membership = await prisma.zoneMember.findUnique({
          where: { zoneId_userId: { zoneId: zone.id, userId: owner.id } },
          select: { status: true },
        });
        if (membership?.status !== 'active') {
          await addZoneMember(zone.id, owner.id, null, session.user.id);
        }
        await transferZoneOwnership(zone.id, owner.id);
      } catch (e) {
        return zoneErrorResponse(e);
      }

      void notifyZoneMember({
        recipientId: owner.id,
        actorId: session.user.id,
        zoneSlug: zone.slug,
        zoneName: zone.name,
        event: 'ownership',
      }).catch(() => undefined);

      await logAdmin({
        adminUserId: session.user.id,
        action: 'transfer_zone',
        targetType: 'zone',
        targetId: zone.id,
        details: { slug: zone.slug, from: zone.ownerId, to: owner.id, toHandle: owner.handle },
        ip: auditIp(req),
      });
    }
  }

  const fresh = await prisma.zone.findUnique({ where: { id: zone.id }, select: ZONE_SELECT });
  return NextResponse.json({
    ok: true,
    zone: fresh
      ? { ...fresh, deletedAt: fresh.deletedAt ? fresh.deletedAt.toISOString() : null }
      : null,
  });
}

// DELETE /api/admin/zones/[id] → { ok } (soft delete, logAdmin'd; idempotent).
export async function DELETE(req: Request, { params }: Params) {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const zone = await prisma.zone.findUnique({ where: { id: params.id }, select: ZONE_SELECT });
  if (!zone) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (zone.deletedAt) return NextResponse.json({ ok: true });

  try {
    await softDeleteZone(zone.id);
  } catch (e) {
    return zoneErrorResponse(e);
  }

  await logAdmin({
    adminUserId: session.user.id,
    action: 'delete_zone',
    targetType: 'zone',
    targetId: zone.id,
    details: { slug: zone.slug, name: zone.name, ownerId: zone.ownerId },
    ip: auditIp(req),
  });

  return NextResponse.json({ ok: true });
}
