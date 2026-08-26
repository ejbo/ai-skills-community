import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { zoneContext } from '@/lib/zones/access';
import { searchUsersForZone } from '@/lib/zones/queries';
import { strParam } from '../../../_zone-api';

export const dynamic = 'force-dynamic';

const TAKE = 20;

// GET /api/zones/[slug]/members/search?q → { items } (members-managers only:
// this is the 添加成员 picker over the whole user table, not the member list).
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { zone, access } = ctx;
  if (!access.canManageMembers) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const q = strParam(new URL(req.url).searchParams.get('q'), 60);
  if (!q) return NextResponse.json({ items: [] });

  const items = await searchUsersForZone(zone.id, q, access.canSeeIdentity, TAKE);
  return NextResponse.json({ items });
}
