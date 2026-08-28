import { NextResponse, type NextRequest } from 'next/server';

/**
 * HEADER-ONLY middleware. Its entire job is to publish the current request path
 * (basePath-free, query included) as `x-pathname`, so a SERVER component can
 * build a `?callbackUrl=` when it bounces an anonymous visitor to the login
 * page — chiefly `requireUser()` in lib/admin.ts, which gates the whole of
 * /zones, /videos and /votes from their layouts.
 *
 * Why it has to exist: a layout gets no pathname prop, and Next 14.2.18 sets no
 * header on a document request that carries one (`Next-Url` is sent only by the
 * client router on RSC navigations; `x-invoke-path` is request metadata, not a
 * header). Without this, every shared deep link into a login-walled section
 * landed on the login page with nothing to come back to, and the user was
 * dropped on the homepage after signing in.
 *
 * INVARIANTS — every one of these is load-bearing, do not "simplify" them away:
 *
 * 1. NO AUTH LOGIC HERE, EVER. CLAUDE.md pitfall #8: `getToken()` in edge
 *    middleware cannot see the secure session cookie behind the proxy+subpath,
 *    so it false-negatives logged-in admins and bounces them to a wrong-host
 *    login. /manage gates stay server-side (`requirePermission` / `gateApi`),
 *    which read the role from the DB. The existence of this file is NOT
 *    permission to move them here.
 *
 * 2. CLONE the inbound headers. Next DELETES every request header that is not
 *    listed in `x-middleware-override-headers`
 *    (next/dist/server/lib/router-utils/resolve-routes.js), so a bare
 *    `new Headers({ 'x-pathname': … })` would strip `cookie` (the Auth.js
 *    session) and `accept-language` (the i18n/request.ts locale fallback).
 *
 * 3. SET NO RESPONSE HEADERS. Next copies leftover middleware RESPONSE headers
 *    onto the request too, so a debug header would arrive looking like a
 *    trusted request header.
 *
 * 4. `nextUrl.pathname` EXCLUDES the basePath, which is exactly what
 *    `sanitizeCallbackPath()` / `withBasePath()` expect. Do NOT add
 *    `nextUrl.basePath` here or the callbackUrl double-prefixes. (And it is
 *    belt-and-braces anyway: sanitizeCallbackPath strips a basePath it finds.)
 *
 * 5. `.set()` OVERWRITES a client-sent `x-pathname`. On matcher-EXCLUDED paths
 *    (/api/**, static) no middleware runs, so an inbound `x-pathname` passes
 *    through verbatim: never read this header in an API route handler, and
 *    always run the value through `sanitizeCallbackPath()`.
 *
 * 6. The matcher is basePath-FREE — Next prefixes `NEXT_BASE_PATH` onto it at
 *    BUILD time. Two consequences: the bare `'/'` entry below is REQUIRED (the
 *    `'/(…)'` pattern cannot match `/ai-community` itself, which is the exact
 *    request the `location = /ai-community` nginx block serves — pitfall #6),
 *    and a deploy MUST rebuild. A `.next` produced before this file existed
 *    silently runs no middleware at all.
 */
export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers); // invariant 2
  requestHeaders.set('x-pathname', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // See invariant 6 — not redundant with the pattern below.
    '/',
    // Everything except API routes (they never need it, and skipping them keeps
    // the Auth.js handlers on exactly the code path they have today), Next's own
    // asset routes, the pdfjs bundle (one PDF fires ~168 extension-less .bcmap
    // requests) and static file extensions.
    '/((?!api/|_next/static|_next/image|pdfjs/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|json|mjs|js|css|map|tgz|ttf|otf|woff|woff2)$).*)',
  ],
};
