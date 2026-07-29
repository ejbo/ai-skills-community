// Canonical form of a submitted source URL — the 知识库 dedup anchor #1.
// Lenient on input (auto-prefix https://), strict on output: lowercase host,
// no fragment, tracking params stripped, no trailing slash on non-root paths.

// Tracking params dropped exactly (plus any utm_* prefix).
const DROP_PARAMS = new Set([
  'fbclid',
  'gclid',
  'spm',
  'ref',
  'ref_src',
  'igshid',
  'share_token',
  'from',
  'isappinstalled',
]);

// Schemes that must never be coerced into an https URL.
const NON_WEB_SCHEMES = new Set(['mailto', 'javascript', 'data', 'tel', 'file', 'ftp', 'about', 'blob']);

/** Canonicalize a user-submitted URL. Returns null if not http(s) or unparseable. */
export function canonicalizeUrl(raw: string): string | null {
  let candidate = (raw ?? '').trim();
  if (!candidate) return null;

  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  const schemeMatch = candidate.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      if (NON_WEB_SCHEMES.has(scheme)) return null;
      // "example.com:8080/x" merely looks scheme-ish; a real foreign scheme
      // is followed by "//" and gets rejected.
      if (candidate.slice(schemeMatch[0].length).startsWith('//')) return null;
      candidate = `https://${candidate}`;
    }
  } else {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  const doomed: string[] = [];
  url.searchParams.forEach((_value, key) => {
    if (key.toLowerCase().startsWith('utm_') || DROP_PARAMS.has(key)) doomed.push(key);
  });
  for (const key of new Set(doomed)) url.searchParams.delete(key);

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}
