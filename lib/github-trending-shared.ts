/**
 * Pure GitHub Trending helpers: types plus the HTML parser.
 *
 * github.com/trending has no API, so the ranking has to be scraped. Everything
 * here is a pure function with no env, network or Node imports, which keeps it
 * unit-testable (tests/github-trending.test.ts) and importable from client
 * components that only need the types. The fetching/caching half lives in
 * lib/github-trending.ts and is server-only.
 *
 * The parser is deliberately regex-free and indexOf-driven. Two reasons:
 *   1. One trending page is ~650 KB of markup that gets re-parsed on every
 *      cache miss, so pulling in jsdom to read three attributes is not worth
 *      the parse cost.
 *   2. The obvious regex spelling of "text between <tag> and </tag>" is
 *      `<tag[^>]*>([\s\S]*?)</tag>`, and every one of those is QUADRATIC in the
 *      number of unterminated openers: each lazy quantifier rescans to the end
 *      of the slice from every candidate start. Measured on a crafted body of
 *      repeated `<svg ` that is 1 MB of synchronous, uninterruptible CPU for
 *      ~106 seconds, which on this single-process server freezes every other
 *      request. On the intranet deploy the corporate proxy terminates TLS and
 *      can hand us any body it likes, so "github.com would never send that" is
 *      not a guarantee we get to rely on. Everything below is linear, and
 *      `lib/github-trending.ts` caps the body before it ever gets here.
 */

export type TrendingPeriod = 'daily' | 'weekly' | 'monthly';

export const TRENDING_PERIODS: readonly TrendingPeriod[] = ['daily', 'weekly', 'monthly'];

export function isTrendingPeriod(value: unknown): value is TrendingPeriod {
  return typeof value === 'string' && (TRENDING_PERIODS as readonly string[]).includes(value);
}

export interface TrendingRepo {
  rank: number;
  /** "owner/repo" */
  fullName: string;
  owner: string;
  name: string;
  url: string;
  description: string;
  /** Display name, e.g. "TypeScript". Empty when GitHub reports no language. */
  language: string;
  /** GitHub's own language colour, e.g. "#3178c6". Empty when unknown. */
  languageColor: string;
  stars: number;
  forks: number;
  /** Stars gained during the selected period. */
  periodStars: number;
  /**
   * The fields below only get filled in when a GITHUB_TOKEN is configured (the
   * REST enrichment step); the UI must render completely without them.
   */
  topics: string[];
  license: string;
  openIssues: number;
  /** ISO timestamp of the last push, or '' when not enriched. */
  pushedAt: string;
}

export interface TrendingPayload {
  period: TrendingPeriod;
  items: TrendingRepo[];
  /** Epoch ms of the successful upstream fetch these items came from. */
  fetchedAt: number;
  /** True when the cache TTL has expired but a refresh failed, so this is old data. */
  stale: boolean;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

const MAX_CODE_POINT = 0x10ffff;

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    const key = body.toLowerCase();
    // Object.hasOwn, not `key in`: `in` walks the prototype chain, so
    // `&constructor;` would "decode" to the Object source string.
    if (Object.hasOwn(NAMED_ENTITIES, key)) return NAMED_ENTITIES[key];
    const hex = body.startsWith('#x') || body.startsWith('#X');
    if (hex || body.startsWith('#')) {
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // fromCodePoint throws RangeError past U+10FFFF, which would abort the
      // whole parse from one malformed reference.
      return Number.isFinite(code) && code >= 0 && code <= MAX_CODE_POINT
        ? String.fromCodePoint(code)
        : whole;
    }
    return whole;
  });
}

/** Drop `<svg>…</svg>` blocks whole. Linear: pure indexOf, no backtracking. */
function stripSvg(html: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const open = lower.indexOf('<svg', i);
    if (open === -1) return out + html.slice(i);
    out += html.slice(i, open);
    const close = lower.indexOf('</svg>', open);
    if (close === -1) return out; // unterminated: the rest is not text either
    i = close + '</svg>'.length;
  }
}

/** Replace every `<…>` with a space. Linear. */
function stripTags(html: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt === -1) return out + html.slice(i);
    out += html.slice(i, lt);
    const gt = html.indexOf('>', lt);
    if (gt === -1) return out;
    out += ' ';
    i = gt + 1;
  }
}

/**
 * Tag-strip to plain text. `<svg>` blocks go first and whole: their path `d`
 * attributes are full of digits, and stripping tags naively would leave those
 * digits in the text so the star/fork counters would parse garbage.
 */
function toText(html: string): string {
  if (!html) return '';
  return decodeEntities(stripTags(stripSvg(html)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** First integer in a string like "19,032" or "897 stars today". */
export function parseCount(text: string): number {
  const match = /\d[\d,]*/.exec(text);
  if (!match) return 0;
  const n = Number.parseInt(match[0].replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Inner HTML of the first `<tag …>` whose attribute text contains `needle`, up
 * to the next `</tag>`. Linear in `source`: candidate scanning always advances
 * past the `>` it just examined, so the attribute slices never overlap.
 */
function tagText(source: string, tag: string, needle = ''): string {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  for (;;) {
    const start = source.indexOf(open, i);
    if (start === -1) return '';
    const gt = source.indexOf('>', start);
    if (gt === -1) return '';
    const attrs = source.slice(start + open.length, gt);
    // `<p` must not match `<path`: what follows the name has to end it.
    const isTag = attrs === '' || attrs[0] === ' ' || attrs[0] === '\n' || attrs[0] === '\t'
      || attrs[0] === '\r' || attrs[0] === '/';
    if (isTag && (!needle || attrs.includes(needle))) {
      const end = source.indexOf(close, gt + 1);
      return end === -1 ? '' : source.slice(gt + 1, end);
    }
    i = gt + 1;
  }
}

/** Value of the first `attr="…"` at or after `from`. */
function attrValue(source: string, attr: string, from = 0): string {
  const key = `${attr}="`;
  const at = source.indexOf(key, from);
  if (at === -1) return '';
  const start = at + key.length;
  const end = source.indexOf('"', start);
  return end === -1 ? '' : source.slice(start, end);
}

// ── parser ───────────────────────────────────────────────────────────────────

const ARTICLE_OPEN = '<article';
const ARTICLE_CLOSE = '</article>';
const ROW_CLASS = 'Box-row';
const MAX_DESCRIPTION = 400;
/** A real trending row is 10-13 KB; anything past this is not one of ours. */
const MAX_ARTICLE_CHARS = 64_000;
/** GitHub renders 25. The extra headroom is only so a layout tweak upstream
 *  doesn't silently truncate; it also bounds work on a hostile body. */
const MAX_ARTICLES = 60;

/**
 * Parse a github.com/trending page into ranked repo rows. Returns [] rather
 * than throwing when the markup no longer matches: a silently empty list is
 * caught by the caller (which keeps serving the stale cache), whereas a throw
 * mid-render would take the homepage down.
 */
export function parseTrendingHtml(html: string): TrendingRepo[] {
  const repos: TrendingRepo[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  let scanned = 0;

  while (scanned < MAX_ARTICLES) {
    const open = html.indexOf(ARTICLE_OPEN, cursor);
    if (open === -1) break;
    const gt = html.indexOf('>', open);
    if (gt === -1) break;
    const end = html.indexOf(ARTICLE_CLOSE, gt + 1);
    if (end === -1) break;
    const attrs = html.slice(open + ARTICLE_OPEN.length, gt);
    cursor = end + ARTICLE_CLOSE.length;
    if (!attrs.includes(ROW_CLASS)) continue;
    scanned++;

    const article = html.slice(gt + 1, Math.min(end, gt + 1 + MAX_ARTICLE_CHARS));

    // The repo link is scoped to the <h2>: the star button above it links to
    // /login?return_to=… and would otherwise win.
    const heading = tagText(article, 'h2');
    const href = decodeEntities(attrValue(heading || article, 'href'));
    const fullName = href.replace(/^\/+|\/+$/g, '').split(/[?#]/)[0];
    // A repo path is exactly "owner/name"; this rejects /login and friends.
    if (!/^[^/\s]+\/[^/\s]+$/.test(fullName) || seen.has(fullName)) continue;
    seen.add(fullName);

    const [owner, name] = fullName.split('/');
    const description = toText(tagText(article, 'p', 'col-9')).slice(0, MAX_DESCRIPTION);
    const language = toText(tagText(article, 'span', 'itemprop="programmingLanguage"'));
    const languageColor = readLanguageColor(article);
    const stars = parseCount(toText(tagText(article, 'a', `${fullName}/stargazers"`)));
    const forks = parseCount(toText(tagText(article, 'a', `${fullName}/forks"`)));
    // The "N stars today / this week / this month" float. Only the number is
    // kept: the period label is rendered from our own i18n messages.
    const periodStars = parseCount(toText(tagText(article, 'span', 'float-sm-right')));

    repos.push({
      rank: repos.length + 1,
      fullName,
      owner,
      name,
      url: `https://github.com/${fullName}`,
      description,
      language,
      languageColor,
      stars,
      forks,
      periodStars,
      topics: [],
      license: '',
      openIssues: 0,
      pushedAt: '',
    });
  }

  return repos;
}

/** `<span class="repo-language-color" style="background-color: #3178c6">`. */
function readLanguageColor(article: string): string {
  const at = article.indexOf('repo-language-color');
  if (at === -1) return '';
  // The style attribute follows within the same tag; a short window keeps this
  // O(1) instead of scanning the rest of the row.
  const window = article.slice(at, at + 200);
  const m = /background-color:\s*(#[0-9a-fA-F]{3,8})/.exec(window);
  return m ? m[1] : '';
}
