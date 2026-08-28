import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import {
  PALETTE_SEARCHES_PER_MINUTE,
  SEARCH_WINDOW_MS,
  isSearchableQuery,
  searchRateKey,
} from '@/lib/search-guard';
import { EMPTY_SEARCH_RESULTS, searchSite } from '@/lib/search';

export const dynamic = 'force-dynamic';

// ⌘K palette backend — small per-group slices; the full results live at
// /search?q=… (same lib/search.ts core with a larger perType, and the same
// lib/search-guard budget under its own key namespace).
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ q, ...EMPTY_SEARCH_RESULTS });

  const session = await auth();
  // Charged BEFORE the floor: a sub-floor term returns without touching the DB,
  // but it still arrived, and letting it through free would make the endpoint
  // unaccounted for anyone who ignores the floor.
  const gate = rateLimit(
    searchRateKey('palette', session?.user?.id, req.headers),
    PALETTE_SEARCHES_PER_MINUTE,
    SEARCH_WINDOW_MS,
  );
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  // One call = 14 parallel unindexed ILIKE scans on the single JS thread, so a
  // term that is guaranteed to match everything never gets to run them.
  if (!isSearchableQuery(q)) {
    return NextResponse.json({ q, ...EMPTY_SEARCH_RESULTS });
  }

  const results = await searchSite(q, {
    viewerCanSeeIdentity: can(session?.user, 'identity'),
    perType: 6,
  });
  return NextResponse.json({ q, ...results });
}
