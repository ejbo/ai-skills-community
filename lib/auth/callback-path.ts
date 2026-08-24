/**
 * Sanitize a `?callbackUrl=` value into an app-relative path. Import-free and
 * client-safe (used by the login/signup forms and HuaweiLoginButton).
 *
 * - Accepts Next's `string | string[]` searchParams shape (arrays take the
 *   first value — the house firstParam rule; anything non-string ⇒ '/').
 * - Absolute http(s) URLs keep only their path+query+hash: the origin is
 *   DISCARDED, so a foreign host can never survive, while Auth.js-style
 *   same-origin absolute callbackUrls keep deep-linking.
 * - Rejects protocol-relative `//host`, backslash tricks, and `.`/`..` path
 *   segments (literal or %2e-encoded — WHATWG URL parsers normalize encoded
 *   dot segments too, so `/%2e%2e/x` would escape the basePath at the browser).
 * - Strips an already-present deploy basePath so callers can `withBasePath()`
 *   the result without double-prefixing, and RE-validates the stripped value
 *   (`/ai-community//evil` must not become `//evil`).
 */
export function sanitizeCallbackPath(
  raw: string | string[] | null | undefined,
  basePath: string = '',
): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string' || !first) return '/';
  let p = first.trim();
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      p = `${u.pathname}${u.search}${u.hash}`;
    } catch {
      return '/';
    }
  }
  if (!isSafeAppPath(p)) return '/';
  if (basePath && (p === basePath || p.startsWith(`${basePath}/`))) {
    p = p.slice(basePath.length) || '/';
    if (!isSafeAppPath(p)) return '/';
  }
  return p;
}

function isSafeAppPath(p: string): boolean {
  if (!p.startsWith('/') || p.startsWith('//')) return false;
  const pathPart = p.split(/[?#]/)[0];
  if (pathPart.includes('\\')) return false;
  if (/(^|\/)\.\.?(\/|$)/.test(pathPart)) return false;
  if (/%2e|%5c/i.test(pathPart)) return false;
  return true;
}
