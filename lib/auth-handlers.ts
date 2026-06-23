import { NextRequest } from 'next/server';
import { handlers } from '@/lib/auth';

// ── Subpath deploy fix (NEXT_BASE_PATH=/ai-community) ────────────────────────
// Next.js STRIPS the configured basePath from a route handler's request URL before
// our code runs. @auth/core's basePath is set to `<basePath>/api/auth` (in lib/auth.ts)
// so it BUILDS correct, /ai-community-prefixed OAuth callback URLs — but inbound it then
// receives "/api/auth/..." (stripped) and can't match its basePath, failing with:
//   UnknownAction: Cannot parse action at /api/auth/error   (→ "Bad request" page)
// This breaks BOTH the Huawei W3 callback and the email/password callback on the subpath.
//
// Re-add the basePath to the inbound URL so it matches @auth/core's basePath again. This
// mirrors exactly what next-auth's own `reqWithEnvURL` does (rebuild the NextRequest from
// a URL string), so it's safe for GET and POST (incl. the streamed signin body).
// No-op at root (NEXT_PUBLIC_BASE_PATH empty) → the external/AWS deploy is unaffected.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

function withBasePath(req: NextRequest): NextRequest {
  if (!BASE_PATH) return req;
  const { pathname, search, origin } = req.nextUrl;
  if (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`)) return req; // already prefixed
  return new NextRequest(`${origin}${BASE_PATH}${pathname}${search}`, req);
}

export function GET(req: NextRequest) {
  return handlers.GET(withBasePath(req));
}

export function POST(req: NextRequest) {
  return handlers.POST(withBasePath(req));
}
