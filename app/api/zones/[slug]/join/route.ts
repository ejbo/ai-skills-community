import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { notifyZoneJoinRequest } from '@/lib/notifications';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { zoneContext } from '@/lib/zones/access';
import { joinZone } from '@/lib/zones/queries';
import { managerIdsFor } from '@/lib/zones/notify';
import { HOUR_MS, invalidInput, zoneErrorResponse, zoneFail } from '../../_zone-api';

export const dynamic = 'force-dynamic';

const JOINS_PER_HOUR = 20;

const schema = z.object({
  message: z.string().trim().max(ZONE_LIMITS.joinMessageMax).default(''),
});

// POST /api/zones/[slug]/join { message? } → { status: 'joined' | 'pending' }.
// open ⇒ joined at once; approval ⇒ pending row + a zone_request notification
// to every members-manager; invite ⇒ 403 invite_only.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:join:${session.user.id}`, JOINS_PER_HOUR, HOUR_MS);
  if (!gate.allowed) return zoneFail('rate_limited_join', 429, { resetAt: gate.resetAt });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (zone.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Idempotent fast paths: an existing membership/request never re-notifies.
  if (access.isMember) return NextResponse.json({ status: 'joined' });
  if (access.membershipStatus === 'pending') return NextResponse.json({ status: 'pending' });
  if (!access.canJoin) return zoneFail('invite_only', 403);

  const body = (await req.json().catch(() => ({}))) ?? {};
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidInput();
  const { message } = parsed.data;

  let status: 'joined' | 'pending';
  try {
    status = await joinZone(zone, session.user.id, message);
  } catch (e) {
    return zoneErrorResponse(e);
  }

  if (status === 'pending') {
    const actorId = session.user.id;
    const actorName = session.user.displayName;
    void (async () => {
      const ids = (await managerIdsFor(zone.id)).filter((id) => id !== actorId);
      if (ids.length === 0) return;
      await notifyZoneJoinRequest({
        recipientIds: ids,
        actorId,
        actorName,
        zoneSlug: zone.slug,
        zoneName: zone.name,
        message,
      });
    })().catch(() => undefined);
  }

  return NextResponse.json({ status });
}
