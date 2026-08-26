import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAdmin } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { notifyZoneMember } from '@/lib/notifications';
import { zoneContext } from '@/lib/zones/access';
import { transferZoneOwnership } from '@/lib/zones/queries';
import { MINUTE_MS, auditIp, invalidInput, zoneErrorResponse, zoneFail } from '../../_zone-api';

export const dynamic = 'force-dynamic';

const MEMBER_WRITES_PER_MINUTE = 60;

const schema = z.object({ userId: z.string().trim().min(1).max(64) });

// POST /api/zones/[slug]/transfer { userId } — hand 主版主 to an active member
// (owner OR site admin). The previous owner stays as 版主 (lib contract).
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:member-write:${session.user.id}`, MEMBER_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_member', 429, { resetAt: gate.resetAt });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.isOwner && !access.siteAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput();
  const { userId } = parsed.data;

  if (userId === zone.ownerId) return zoneFail('already_owner', 400);

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
  if (!target) return zoneFail('user_not_found', 404);
  if (!target.isActive) return zoneFail('user_inactive', 400);

  try {
    await transferZoneOwnership(zone.id, userId);
  } catch (e) {
    return zoneErrorResponse(e);
  }

  void notifyZoneMember({
    recipientId: userId,
    actorId: session.user.id,
    zoneSlug: zone.slug,
    zoneName: zone.name,
    event: 'ownership',
  }).catch(() => undefined);

  if (access.siteAdmin && !access.isOwner) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'transfer_zone',
      targetType: 'zone',
      targetId: zone.id,
      details: { slug: zone.slug, from: zone.ownerId, to: userId },
      ip: auditIp(req),
    });
  }

  return NextResponse.json({ ok: true });
}
