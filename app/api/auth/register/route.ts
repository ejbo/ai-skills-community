import { NextResponse } from 'next/server';

/**
 * Self-service registration is CLOSED on every deploy (owner decision,
 * 2026-08-27) — not just on the SSO ones, which is all this route used to
 * check. The UI no longer offers it (`/auth/signup` redirects to the login
 * page and the login page has no signup link); this is the half that stops a
 * curl.
 *
 * Where accounts come from now:
 *   - Huawei W3 first login — provisioned by the `signIn` callback in
 *     lib/auth.ts, which links an existing row by 工号/email or creates one.
 *   - `pnpm db:seed` — `ensureAdmin()` in scripts/seed.ts, driven by
 *     INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD.
 * Password LOGIN is untouched: existing admin/service accounts still sign in
 * through the credentials provider.
 *
 * The route file stays (rather than being deleted) so an old client gets a
 * clear 403 instead of a 404 that reads like a deploy problem.
 */
export async function POST() {
  return NextResponse.json({ error: 'signup_disabled' }, { status: 403 });
}
