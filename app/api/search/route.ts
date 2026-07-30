import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { EMPTY_SEARCH_RESULTS, searchSite } from '@/lib/search';

export const dynamic = 'force-dynamic';

// ⌘K palette backend — small per-group slices; the full results live at
// /search?q=… (same lib/search.ts core with a larger perType).
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ q, ...EMPTY_SEARCH_RESULTS });

  const session = await auth();
  const results = await searchSite(q, {
    viewerIsAdmin: session?.user?.isAdmin ?? false,
    perType: 6,
  });
  return NextResponse.json({ q, ...results });
}
