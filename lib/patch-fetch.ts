/**
 * Client-side global fetch shim for subpath deploys.
 *
 * The app makes ~50 client-side `fetch('/api/...')` calls with ROOT-RELATIVE URLs. Under a
 * Next.js basePath (NEXT_BASE_PATH=/ai-community) those resolve to <origin>/api/... — the
 * origin ROOT — which behind nginx is the neighbour app, NOT this app at /ai-community/api/*.
 * So every client-side write (skill/category/video upload, admin toggles, comments, …) 404s,
 * while server-component reads work. Fixing ~50 call sites with withBasePath() is fragile (and
 * new code forgets it), so patch window.fetch ONCE to prepend the basePath to same-origin
 * root-relative requests.
 *
 * Idempotent; a complete NO-OP at root (NEXT_PUBLIC_BASE_PATH empty) so the external/AWS deploy
 * is untouched. Already-prefixed URLs (next-auth's, or explicit withBasePath calls) and absolute
 * / cross-origin URLs are left alone, so it can't double-prefix.
 */
const BP = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function installApiBasePathFetch(): void {
  if (!BP || typeof window === 'undefined') return;
  const w = window as Window & typeof globalThis & { __apiBasePathPatched?: boolean };
  if (w.__apiBasePathPatched) return;
  w.__apiBasePathPatched = true;

  const prefix = (path: string): string =>
    path.startsWith('/') && !path.startsWith('//') && !path.startsWith(`${BP}/`) && path !== BP
      ? `${BP}${path}`
      : path;

  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      if (typeof input === 'string') return orig(prefix(input), init);
      if (input instanceof URL) {
        return input.origin === window.location.origin
          ? orig(`${prefix(input.pathname)}${input.search}${input.hash}`, init)
          : orig(input, init);
      }
      if (input instanceof Request) {
        const u = new URL(input.url);
        if (u.origin === window.location.origin && !u.pathname.startsWith(`${BP}/`)) {
          return orig(new Request(`${prefix(u.pathname)}${u.search}${u.hash}`, input), init);
        }
      }
      return orig(input, init);
    } catch {
      return orig(input, init);
    }
  };
}
