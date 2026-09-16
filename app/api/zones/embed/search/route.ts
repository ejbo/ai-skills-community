import { NextResponse } from 'next/server';
import { getLocale } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { zoneSiteViewer } from '@/lib/zones/access';
import {
  EMBED_SEARCH_MAX_QUERY,
  decodeEmbedSearchCursor,
  isSearchableEmbedKind,
  parseEmbedSearchScope,
  parseEmbedSearchSort,
  pagingForSort,
  phasesFor,
  type EmbedSearchCursor,
} from '@/lib/zones/embed-search-shared';
import { searchEmbedCandidates } from '@/lib/zones/embeds';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
// Infinite scroll is several pages a minute on its own; typing is debounced
// client-side. 120 leaves room for both without letting a script walk tables.
const SEARCHES_PER_MINUTE = 120;

// GET /api/zones/embed/search?kind=<kind>&q=<text>&scope=all|mine|fav&sort=new|hot&cursor=<opaque>
//   (login) → { items: EmbedCandidate[], nextCursor: string | null }
// `file` and `link` are not searchable: attachments come from the current post,
// links are typed in. Every malformed parameter is a 400 — a scope the kind
// does not offer (合集包 has no 我发布的), a keyword over the cap, a cursor that
// is not one this endpoint minted for this scope.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:embed-search:${session.user.id}`, SEARCHES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind');
  if (!isSearchableEmbedKind(kind)) return invalid();

  const q = (sp.get('q') ?? '').trim();
  if (q.length > EMBED_SEARCH_MAX_QUERY) return invalid();

  const scope = parseEmbedSearchScope(kind, sp.get('scope'));
  const sort = parseEmbedSearchSort(sp.get('sort'));
  if (!scope || !sort) return invalid();

  const rawCursor = sp.get('cursor');
  let cursor: EmbedSearchCursor | null = null;
  if (rawCursor !== null && rawCursor !== '') {
    // The cursor is only valid for the phase list AND the paging mode of THIS
    // request — a 最热 offset cursor replayed against 最新 (which pages by
    // keyset) is a 400, not a reinterpretation.
    cursor = decodeEmbedSearchCursor(rawCursor, phasesFor(kind, scope, sort), pagingForSort(sort));
    if (!cursor) return invalid();
  }

  const locale = await getLocale();
  try {
    const page = await searchEmbedCandidates(kind, { q, scope, sort, cursor }, { viewer: zoneSiteViewer(session.user), session, locale });
    return NextResponse.json(page);
  } catch (e) {
    console.warn('[zones/embed/search] failed', kind, scope, sort, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'search_failed' }, { status: 500 });
  }
}

function invalid() {
  return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
}
