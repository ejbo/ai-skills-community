// 技术专区 link embeds — pure Open Graph / meta parser (no jsdom, no prisma,
// no env). link-preview.ts feeds it the (capped) HTML of a fetched page;
// tests/zones-embeds.test.ts pins the behaviour.
//
// Regex-based on purpose: a preview only needs a handful of <meta> values and
// the <title>, and one page body can be up to 1 MB — a full DOM parse per
// cache miss would be the expensive part of the whole feature.

import type { EmbedLinkData } from './types';

export type ParsedOgMeta = Omit<EmbedLinkData, 'hostname'>;

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 500;
const MAX_SITE_NAME = 80;

const META_TAG_RE = /<meta\b[^>]*>/gi;
const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  bull: '•',
};

/** Decode the entities that show up in real-world meta content (named + numeric). */
export function decodeHtmlEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

function clean(raw: string | undefined, max: number): string {
  if (!raw) return '';
  const text = decodeHtmlEntities(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cps = [...text];
  return cps.length > max ? `${cps.slice(0, max).join('').trimEnd()}…` : text;
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(tag)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (!(name in out)) out[name] = value;
  }
  return out;
}

/** Absolute http(s) URL for an image reference, resolved against the page URL; null otherwise. */
export function resolveImageUrl(candidate: string | undefined, pageUrl: string): string | null {
  const raw = decodeHtmlEntities(candidate ?? '').trim();
  if (!raw || raw.length > 2048) return null;
  if (/^(javascript|data|blob|file):/i.test(raw)) return null;
  try {
    const u = new URL(raw, pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Extract the preview fields of a page. Priority per field:
 *   title:       og:title → twitter:title → <title>
 *   description: og:description → twitter:description → meta[name=description]
 *   image:       og:image:secure_url → og:image → og:image:url → twitter:image → twitter:image:src
 *   siteName:    og:site_name → application-name
 * Attribute order inside a <meta> tag does not matter; the first occurrence of
 * a key wins (pages that repeat og:image list the primary one first).
 */
export function parseOgMeta(html: string, url: string): ParsedOgMeta {
  const meta = new Map<string, string>();
  META_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = META_TAG_RE.exec(html)) !== null) {
    const attrs = parseAttrs(m[0]);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? '').trim().toLowerCase();
    if (!key) continue;
    const content = attrs.content;
    if (content === undefined) continue;
    if (!meta.has(key)) meta.set(key, content);
  }

  const titleTag = TITLE_RE.exec(html)?.[1];
  const title = clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag, MAX_TITLE);
  const description = clean(
    meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'),
    MAX_DESCRIPTION,
  );
  const imageUrl =
    resolveImageUrl(meta.get('og:image:secure_url'), url) ??
    resolveImageUrl(meta.get('og:image'), url) ??
    resolveImageUrl(meta.get('og:image:url'), url) ??
    resolveImageUrl(meta.get('twitter:image'), url) ??
    resolveImageUrl(meta.get('twitter:image:src'), url);
  const siteName = clean(meta.get('og:site_name') ?? meta.get('application-name'), MAX_SITE_NAME);

  return { url, title, description, imageUrl, siteName };
}

/**
 * Cache key form of a preview URL: http(s) only, hash dropped, host lowercased,
 * default ports removed. Query strings are kept — they often select the page.
 */
export function normalizePreviewUrl(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s || s.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  return u.toString();
}
