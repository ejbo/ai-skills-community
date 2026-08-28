/**
 * Shared guard for the two site-search surfaces. Both run the SAME
 * `searchSite()` core — 14 parallel unindexed `ILIKE '%q%'` scans (three over
 * full `bodyMd` columns) on the single JS thread, with NO login required — so a
 * limiter on only one of them closes nothing:
 *   - the ⌘K palette: `components/SearchTrigger` → `GET /api/search` (perType 6),
 *     fired automatically while someone types;
 *   - the results page: `/search?q=…` → `app/search/page.tsx` (perType 24),
 *     the HEAVIER of the two, one deliberate navigation at a time.
 *
 * IMPORT-FREE ON PURPOSE — `SearchTrigger` is a client component and imports
 * `isSearchableQuery` from here, so the floor cannot drift between what the
 * client refuses to send and what the server refuses to run. Pulling in
 * `lib/rate-limit` would ship its module-level `setInterval` and bucket Map into
 * the browser bundle, so the two server callers keep calling `rateLimit()`
 * themselves with the key + budget this module hands them.
 */

// CJK ideographs / kana / Hangul syllables. Kept VERBATIM from the shipped
// route so moving it here changes no result. Note it is not `u`-flagged and its
// second range starts at 豈 U+8C48 (not the compatibility block's U+F900), so it
// spans the surrogate range and any astral char — emoji included — reads as CJK.
// Harmless here: that only widens which 1-character terms are allowed through,
// and an emoji LIKE is selective, not the match-every-row case the floor exists
// to stop. Do not "tighten" it without checking both callers together.
const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

/**
 * The minimum-query floor. A one-character LATIN term matches nearly every row,
 * so those 14 scans do table-wide work to return noise. A one-character CJK term
 * is a real word (「包」「车」) — the floor must not regress 中文 search for a perf
 * win. Length is counted in CODE POINTS, not UTF-16 units.
 *
 * Deliberately NOT applied to `/search?q=…`: that page is the escape hatch the
 * palette's 查看全部搜索结果 row leads to, so a one-character Latin search stays
 * possible when a human explicitly asks for it — it is the automatic,
 * per-keystroke path that must not spend the thread on guaranteed noise.
 */
export function isSearchableQuery(q: string): boolean {
  const trimmed = q.trim();
  if (!trimmed) return false;
  return [...trimmed].length >= 2 || CJK_RE.test(trimmed);
}

export const SEARCH_WINDOW_MS = 60 * 1000;

/**
 * Palette budget. The previous 30/min was reachable by ACCIDENT: at the old
 * 160 ms debounce a 10-character term cost ~10 calls, so three or four queries
 * emptied it and the palette went quietly blank on a normal user. 120/min still
 * bounds the scans to ~2/s, and is the same order as the anonymous allowance on
 * `/api/polls/[id]` (240/min for one indexed read).
 */
export const PALETTE_SEARCHES_PER_MINUTE = 120;

/**
 * Page budget. Lower because each call asks for a 4× larger slice, and because
 * every one of them is a deliberate navigation (`SearchBar` submits on Enter,
 * not per keystroke) — 30/min is one every two seconds, sustained.
 */
export const PAGE_SEARCHES_PER_MINUTE = 30;

/** Client debounce before `GET /api/search`. Shared so the budget above stays honest. */
export const SEARCH_DEBOUNCE_MS = 300;

type SearchScope = 'palette' | 'page';

/** Just the one method both `Request.headers` and next/headers' `headers()` give us. */
interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Rate-limit key, namespaced PER SURFACE so clicking 查看全部搜索结果 spends the
 * page's budget and never the palette's — otherwise one navigation would eat
 * into the allowance the next keystroke needs.
 *
 * Anonymous callers key on `x-real-ip`, else the LAST X-Forwarded-For hop: the
 * FIRST hop is client-supplied and forgeable, so keying on it would let a single
 * caller mint a fresh bucket per request (same convention as DiscussionTopicView
 * and `/api/polls/[id]`).
 */
export function searchRateKey(
  scope: SearchScope,
  userId: string | undefined,
  headers: HeaderReader,
): string {
  if (userId) return `search:${scope}:u:${userId}`;
  const ip =
    headers.get('x-real-ip') ??
    headers.get('x-forwarded-for')?.split(',').pop()?.trim() ??
    'unknown';
  return `search:${scope}:${ip}`;
}
