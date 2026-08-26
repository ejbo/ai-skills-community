import { NextResponse } from 'next/server';
import { getLocale } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { zoneSiteViewer } from '@/lib/zones/access';
import { searchEmbedCandidates } from '@/lib/zones/embeds';
import { isEmbedKind } from '@/lib/zones/shared';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const SEARCHES_PER_MINUTE = 60;
const DEFAULT_TAKE = 10;
const MAX_TAKE = 20;

// GET /api/zones/embed/search?kind=<EmbedKind>&q=<text>&take (login) → { items: EmbedCandidate[] }
// `file` and `link` are not searchable: attachments come from the current post,
// links are typed in.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:embed-search:${session.user.id}`, SEARCHES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind');
  if (!isEmbedKind(kind) || kind === 'file' || kind === 'link') {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const q = (sp.get('q') ?? '').trim().slice(0, 80);
  const takeRaw = Number.parseInt(sp.get('take') ?? '', 10);
  const take = Number.isFinite(takeRaw) ? Math.min(MAX_TAKE, Math.max(1, takeRaw)) : DEFAULT_TAKE;

  const locale = await getLocale();
  const items = await searchEmbedCandidates(kind, q, { viewer: zoneSiteViewer(session.user), session, locale }, take);
  return NextResponse.json({ items });
}
