// 技术专区 — 版主公告 dismissal cookie. Plain module (no 'use client', no
// next imports): the zone home RSC parses it out of `cookies()`, the ✕ button
// writes it through `document.cookie`, and vitest pins the format.
//
// Why a cookie and not localStorage: the band is server-rendered, so the
// server must already know the answer at render time — a client-side hide
// would paint the band and then collapse it after hydration. ONE cookie holds
// every zone (`<zoneId>:<postId>` pairs, newest LAST, capped) so a member of
// twenty zones does not carry twenty cookies on every request. A NEWER
// announcement has a new post id, so it shows again by construction.
//
// Path: the cookie is scoped to the deploy basePath (`/ai-community/` on the
// intranet, `/` at root) — never `path=/` unconditionally, which would ride
// every sibling app and every media request on the shared host.

export const NOTICE_COOKIE = 'aic.zone-notice';
export const NOTICE_COOKIE_MAX_ENTRIES = 20;

/** cuid-shaped ids only — anything else is refused, so the value can never carry a separator. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Separators are cookie-octet safe (RFC 6265 excludes `,` `;` and whitespace
// from cookie values; `.` and `:` are fine and can never appear inside an id).
const ENTRY_SEP = '.';
const PAIR_SEP = ':';

function isId(v: string): boolean {
  return ID_RE.test(v);
}

/** zoneId → dismissed postId, in cookie order (oldest first). Garbage entries are skipped. */
export function parseNoticeCookie(raw: string | null | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!raw || typeof raw !== 'string') return out;
  for (const entry of raw.split(ENTRY_SEP)) {
    const i = entry.indexOf(PAIR_SEP);
    if (i <= 0) continue;
    const zoneId = entry.slice(0, i);
    const postId = entry.slice(i + 1);
    if (!isId(zoneId) || !isId(postId)) continue;
    out.set(zoneId, postId);
  }
  return out;
}

function serialize(map: ReadonlyMap<string, string>): string {
  return [...map.entries()].map(([z, p]) => `${z}${PAIR_SEP}${p}`).join(ENTRY_SEP);
}

/**
 * The cookie value after dismissing `postId` in `zoneId`: the zone's previous
 * entry (if any) is replaced, the new pair goes LAST, and the oldest entries
 * fall off past NOTICE_COOKIE_MAX_ENTRIES. Invalid ids leave the value as it
 * was (the caller then simply re-writes what it read).
 */
export function withNoticeDismissed(raw: string | null | undefined, zoneId: string, postId: string): string {
  if (!isId(zoneId) || !isId(postId)) return raw ?? '';
  const map = new Map(parseNoticeCookie(raw));
  map.delete(zoneId);
  map.set(zoneId, postId);
  while (map.size > NOTICE_COOKIE_MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return serialize(map);
}

/** `document.cookie` assignment string, scoped to the deploy basePath ('' at root). */
export function noticeCookieHeader(value: string, basePath: string): string {
  const bp = (basePath || '').replace(/\/+$/, '');
  return `${NOTICE_COOKIE}=${value}; path=${bp}/; max-age=31536000; samesite=lax`;
}

/** The current value out of a `document.cookie` string (null when absent). */
export function readNoticeCookie(cookieString: string | null | undefined): string | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${NOTICE_COOKIE}=`)) continue;
    return trimmed.slice(NOTICE_COOKIE.length + 1);
  }
  return null;
}
