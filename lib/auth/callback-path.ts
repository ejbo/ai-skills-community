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
  if (basePath) {
    // Compare the PATH part only. `/ai-community?tab=x` and `/ai-community#c-7`
    // are the deploy root with a query/hash — matching the whole string missed
    // them, so the prefix survived and withBasePath() re-added it
    // (`/ai-community/ai-community?tab=x`, a 404). @auth/core produces exactly
    // that shape: pages/index.js redirects to pages.signIn with the ABSOLUTE
    // stored callbackUrl, which is origin + basePath + path + query.
    const head = p.split(/[?#]/)[0];
    if (head === basePath || head.startsWith(`${basePath}/`)) {
      p = p.slice(basePath.length);
      if (!p.startsWith('/')) p = `/${p}`; // '/ai-community?x' → '/?x', never '?x'
      if (!isSafeAppPath(p)) return '/';
    }
  }
  return p;
}

/**
 * The canonical "send an anonymous visitor to the login page, and bring them
 * back here afterwards" URL builder. EVERY login entry point goes through it:
 * hand-rolled `/auth/login?callbackUrl=${pathname}` literals were the reason a
 * shared deep link died — some dropped the destination entirely, one produced a
 * double `?` (`/skills/x?tab=reviews` un-encoded), and none stripped the deploy
 * basePath, so `withBasePath()` on the far side double-prefixed it.
 *
 * The result is app-relative and UNPREFIXED: RSC `redirect()` and the Next
 * router both add the basePath themselves. (The W3 button is the one place that
 * must call `withBasePath()` — see CLAUDE.md pitfall #4.)
 */
export function loginHref(from?: string | string[] | null): string {
  const dest = sanitizeCallbackPath(from, process.env.NEXT_PUBLIC_BASE_PATH ?? '');
  return isReturnableDest(dest) ? `/auth/login?callbackUrl=${encodeURIComponent(dest)}` : '/auth/login';
}

/**
 * Is this a destination worth coming back to? The root is not (it is where an
 * absent callbackUrl already lands) and neither is anything under `/auth/` —
 * the navbar's 登录 link renders on the login and error pages too, and without
 * this it would nest `/auth/login` inside its own callbackUrl and then promise
 * the visitor it will "take them back" to the login page.
 */
export function isReturnableDest(dest: string): boolean {
  return dest !== '/' && !dest.startsWith('/auth/') && dest !== '/auth';
}

/**
 * A page's OWN url from its `searchParams` prop, for passing to
 * `requireUser(fallback)`. Empty values are dropped and `string[]` takes its
 * first entry (the house firstParam rule), so the result is a plain path+query.
 */
export function selfHref(
  base: string,
  searchParams: Record<string, string | string[] | undefined> = {},
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) sp.set(key, first);
  }
  const query = sp.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * `loginHref` for the CURRENT page, read from `window.location` — path AND
 * query. Call it from a click/401 handler in a client component.
 *
 * Why not `usePathname()`: it carries no query string, so `?v=<short>`,
 * `?focus=<commentId>` and `?ch=<chapter>` — the parts that make a shared link
 * point at the actual thing — were being thrown away. `useSearchParams()` would
 * fix that but opts the whole route out of static rendering unless it is
 * wrapped in Suspense; `window.location` inside an event handler costs nothing
 * and is exact. SSR-safe: returns the bare login path if there is no window.
 */
export function currentLoginHref(): string {
  if (typeof window === 'undefined') return '/auth/login';
  return loginHref(`${window.location.pathname}${window.location.search}`);
}

function isSafeAppPath(p: string): boolean {
  // C0 controls FIRST. `trim()` only strips the ends, and WHATWG URL parsers
  // REMOVE tab/CR/LF from anywhere in the input before parsing — so a mid-path
  // tab defeats every check below it: `/<TAB>/evil.example` passes the `//`
  // test here, Node emits it verbatim in a Location header, and the browser
  // then reads `//evil.example` as scheme-relative and leaves the origin.
  // (The subpath deploy happened to be immune — addPathPrefix made it
  // `/ai-community//evil.example`, same origin — the root deploy was not.)
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  if (!p.startsWith('/') || p.startsWith('//')) return false;
  const pathPart = p.split(/[?#]/)[0];
  if (pathPart.includes('\\')) return false;
  if (/(^|\/)\.\.?(\/|$)/.test(pathPart)) return false;
  if (/%2e|%5c/i.test(pathPart)) return false;
  return true;
}
