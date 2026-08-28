/**
 * Where the visitor was headed, remembered across an Auth.js ERROR bounce.
 *
 * The W3 flow can fail after we hand off (CLAUDE.md pitfall #10 — the
 * "InvalidCheck: state value could not be parsed" class), and @auth/core then
 * redirects to `pages.error` with ONLY `?error=<code>`: it never puts the
 * callbackUrl on that url, and the `aic.callback-url` cookie is path-scoped to
 * `<basePath>/api/auth` so the error page cannot read it either. Without this,
 * 重新登录 on /auth/error dropped the destination on exactly the failure that
 * makes people retry.
 *
 * sessionStorage, not a cookie: it is per-tab, never sent to the server, and
 * carries no auth value — it is a UI breadcrumb. Every access is wrapped
 * because a locked-down browser throws on the accessor itself.
 */
const KEY = 'aic.auth-return-to';

export function rememberAuthDest(dest: string): void {
  try {
    if (dest && dest !== '/') sessionStorage.setItem(KEY, dest);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode / storage blocked — the breadcrumb is best-effort */
  }
}

export function readAuthDest(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
