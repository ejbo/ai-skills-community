// 技术专区 — the 研究所 tiles behind the navbar mega-menu.
//
// Login-gated like the rest of the zones API: /zones is login-walled and the
// cover images this payload points at are independently `auth()`-gated by
// /api/zones/media, so a public lab list would be the only anonymous window
// into 版块 metadata. The body itself is what any signed-in user already sees
// on /zones?tab=boards.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { zoneLabCards } from '@/lib/zones/labs';
import { MINUTE_MS, zoneFail } from '../_zone-api';

export const dynamic = 'force-dynamic';

const HUB_READS_PER_MINUTE = 180;

// GET /api/zones/labs → { labs: ZoneLabCard[] }
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:hub:${session.user.id}`, HUB_READS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_hub', 429, { resetAt: gate.resetAt });

  return NextResponse.json({ labs: await zoneLabCards() });
}
