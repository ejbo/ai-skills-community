import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getTrending, trendingError } from '@/lib/github-trending';
import { isTrendingPeriod } from '@/lib/github-trending-shared';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// GET /api/github-trending?period=daily|weekly|monthly — the homepage 热榜
// panel's tab switcher. Login-gated: the panel only renders for signed-in
// members, and leaving it open would turn this box into a public scraping
// proxy for github.com. The heavy lifting (cache, stale-while-refresh, proxy
// egress) is all in lib/github-trending.ts; this route is a thin shell.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const period = new URL(req.url).searchParams.get('period') ?? 'daily';
  if (!isTrendingPeriod(period)) {
    return NextResponse.json({ error: 'bad_period' }, { status: 400 });
  }

  // Generous: switching tabs is cheap (cache hits), a burst is normal.
  const gate = rateLimit(`gh-trending:${session.user.id}`, 60, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const payload = await getTrending(period);
  return NextResponse.json({
    ok: true,
    ...payload,
    error: payload.items.length === 0 ? trendingError(period) : null,
  });
}
