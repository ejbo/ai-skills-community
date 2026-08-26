import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { zoneContext } from '@/lib/zones/access';
import { leaveZone } from '@/lib/zones/queries';
import { zoneErrorResponse } from '../../_zone-api';

export const dynamic = 'force-dynamic';

// POST /api/zones/[slug]/leave → { ok }. Removes the viewer's own ZoneMember
// row (active membership OR a pending request — withdrawing is leaving). The
// 主版主 cannot leave (ZoneError owner_cannot_leave → 转让 first).
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;

  if (!access.isMember && access.membershipStatus !== 'pending') return NextResponse.json({ ok: false });

  try {
    const ok = await leaveZone(zone.id, session.user.id);
    return NextResponse.json({ ok });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
