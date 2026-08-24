/**
 * App-scoped Auth.js cookie names + paths, and canonical-host redirect logic.
 *
 * Why this exists (the 2026-08 "InvalidCheck: state value could not be parsed"
 * incident): Auth.js default cookies are `authjs.*`/`__Secure-authjs.*` with
 * Path=/ — HOST-wide on a shared host, and host-ONLY (no Domain attr). The cari
 * server block still answers on its pre-2026-07 name (ai4news.rnd.huawei.com),
 * so a login STARTED on the old alias writes its state cookie into the alias'
 * cookie jar while AUTH_URL pins the OAuth callback to cari — the callback then
 * reads nothing (or stale residue from an older AUTH_SECRET epoch) and dies.
 * Two defenses, both here as pure/testable helpers:
 *   1. buildAuthCookies: unique per-app names (`aic.*`) scoped to the deploy
 *      basePath, so no other app, deploy epoch, or hostname alias ACCIDENTALLY
 *      shadows them — and ours never leak to neighbour apps on the host.
 *   2. canonicalRedirectTarget: app-level backstop that bounces any page served
 *      on a non-canonical hostname back to AUTH_URL's origin BEFORE a login can
 *      start there (nginx does the same with full-path fidelity; this survives
 *      nginx config drift).
 *
 * NOTE: cookie NAMES are also the JWT salt in @auth/core — deploying a rename
 * logs every existing session out once (they just sign in again) and fails any
 * OAuth round trip that is mid-flight during the restart. One-time, expected.
 */

/** Everything the OAuth/CSRF machinery needs lives under `<basePath>/api/auth`. */
function authApiPath(basePath: string): string {
  return `${basePath}/api/auth`;
}

export interface AuthCookieDef {
  name: string;
  options: { path: string };
}

export interface AuthCookies {
  sessionToken: AuthCookieDef;
  callbackUrl: AuthCookieDef;
  csrfToken: AuthCookieDef;
  state: AuthCookieDef;
  pkceCodeVerifier: AuthCookieDef;
  nonce: AuthCookieDef;
}

/**
 * Partial cookie config for NextAuth. @auth/core deep-merges this over its
 * defaults, so we intentionally set ONLY `name` + `options.path` and inherit
 * httpOnly/sameSite/secure/maxAge from upstream (they track `useSecureCookies`,
 * which lib/auth.ts passes explicitly from the AUTH_URL protocol).
 *
 * - No `__Host-` prefix anywhere: it requires Path=/ and we deliberately scope
 *   paths to the deploy prefix. `__Secure-` only requires the Secure attr.
 *   Residual risk vs upstream's `__Host-` csrf default: `__Secure-` does not
 *   forbid a Domain attribute, so a hostile/XSS'd sibling *.huawei.com host
 *   could plant a Domain-scoped `__Secure-aic.*` cookie (shadowing/fixation).
 *   The session JWT is AUTH_SECRET-sealed so fixation fails validation; a
 *   harvested csrf `token|hash` pair would pass double-submit — accepted given
 *   the intranet trust model, and unavoidable while paths are basePath-scoped.
 * - The session-token name must NOT be a string-prefix of any other cookie we
 *   set (chunk reassembly collects by prefix) — `aic.session-token` is not.
 */
export function buildAuthCookies(opts: { basePath: string; secure: boolean }): AuthCookies {
  const prefix = opts.secure ? '__Secure-aic.' : 'aic.';
  const appPath = opts.basePath || '/';
  const apiPath = authApiPath(opts.basePath);
  const cookie = (base: string, path: string): AuthCookieDef => ({
    name: `${prefix}${base}`,
    options: { path },
  });
  return {
    // The session cookie must be visible to every app route.
    sessionToken: cookie('session-token', appPath),
    // The rest only ever round-trips through /api/auth/* requests.
    callbackUrl: cookie('callback-url', apiPath),
    csrfToken: cookie('csrf-token', apiPath),
    state: cookie('state', apiPath),
    pkceCodeVerifier: cookie('pkce.code_verifier', apiPath),
    nonce: cookie('nonce', apiPath),
  };
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Hostname portion of a Host header value ("[::1]:3000" → "::1", "a.b:80" → "a.b"). */
export function hostnameOfHostHeader(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(1, end);
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * Hosts we never canonical-redirect: loopback, literal IPs, *.localhost.
 * Keeps `curl 127.0.0.1:3100` smoke tests and direct-IP debugging working.
 */
export function isRedirectExemptHost(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (IPV4_RE.test(hostname)) return true;
  if (hostname.includes(':')) return true; // IPv6 literal (after bracket strip)
  return false;
}

/**
 * Absolute URL to bounce a document request to, or null to serve it here.
 * Only active on SSO deploys (they are the shared-host case); the canonical
 * origin is AUTH_URL's, because that is where the OAuth callback MUST land.
 * The request path is unknowable in a layout, so the target is the app root —
 * the nginx rule (docs) preserves the full path for the common case.
 */
export function canonicalRedirectTarget(opts: {
  enableSso: boolean;
  authUrl: string | null | undefined;
  requestHost: string | null | undefined;
  basePath: string;
}): string | null {
  if (!opts.enableSso || !opts.authUrl || !opts.requestHost) return null;
  let canonical: URL;
  try {
    canonical = new URL(opts.authUrl);
  } catch {
    return null;
  }
  const canonicalHost = canonical.hostname.toLowerCase();
  const requestHost = hostnameOfHostHeader(opts.requestHost);
  if (requestHost === canonicalHost) return null;
  if (isRedirectExemptHost(requestHost) || isRedirectExemptHost(canonicalHost)) return null;
  return `${canonical.origin}${opts.basePath || '/'}`;
}
