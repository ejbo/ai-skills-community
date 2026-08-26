import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { zoneSiteViewer } from '@/lib/zones/access';
import { listBookmarkedPosts } from '@/lib/zones/post-queries';

export const dynamic = 'force-dynamic';

const DEFAULT_TAKE = 50;
const MAX_TAKE = 100;

// GET /api/zones/bookmarks?take (login) → { items: ZonePostCardView[] }
// Only posts whose zone the viewer can still read (public, or a zone they are
// a member of) — a bookmark never keeps a members-only post visible.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const takeRaw = Number.parseInt(new URL(req.url).searchParams.get('take') ?? '', 10);
  const take = Number.isFinite(takeRaw) ? Math.min(MAX_TAKE, Math.max(1, takeRaw)) : DEFAULT_TAKE;

  const items = await listBookmarkedPosts(zoneSiteViewer(session.user), take);
  return NextResponse.json({ items });
}
