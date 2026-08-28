import { cache as reactCache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';
import { RoleError, getEffectiveRoleForUser, isSerializationFailure, type EffectiveRole } from '@/lib/roles';
import { hasPermission, type PermissionKey } from '@/lib/permissions';
import { loginHref } from '@/lib/auth/callback-path';

// React's request-scoped `cache` exists only in the server (RSC) build; under
// vitest / plain node it is undefined, so fall back to the bare function.
const memo: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === 'function' ? reactCache : (fn) => fn;

// 管理后台 gates. These read the role from the DATABASE (memoized per request),
// not from the JWT copy, so revoking a role or disabling an account locks the
// panel and every /api/admin route on the very next request. Site-wide inline
// checks (`can(session.user, …)`) use the JWT copy, which lib/auth.ts refreshes
// within ROLE_CLAIMS_TTL_MS.

export interface ManageActor {
  session: Session;
  role: EffectiveRole;
}

/** Signed-in staff (any permission) with their authoritative role, or null. */
export const getManageActor = memo(async (): Promise<ManageActor | null> => {
  const session = await auth();
  if (!session?.user) return null;
  const role = await getEffectiveRoleForUser(session.user.id);
  if (!role || !role.isStaff) return null;
  return { session, role };
});

/**
 * Where to send an anonymous visitor so that signing in brings them back HERE.
 *
 * `x-pathname` is published by middleware.ts (basePath-free, query included) —
 * a layout has no other way to learn the path it is gating. It is absent on
 * matcher-excluded paths and client-SPOOFABLE if it ever arrives from outside,
 * so it always goes through `loginHref` → `sanitizeCallbackPath`, which rejects
 * anything that is not a plain in-app path. `fallback` is for the gates that DO
 * know their own route: it keeps them correct even if the header is missing
 * (e.g. a deploy that shipped a `.next` built before this middleware existed).
 */
function loginRedirectHref(fallback?: string): string {
  return loginHref(headers().get('x-pathname') ?? fallback ?? null);
}

/**
 * Where a rejected /manage visitor goes. Anonymous → the login page carrying
 * this url (a 管理后台 link shared with a colleague used to strand them on the
 * homepage after signing in); signed-in-but-unauthorized → home, because for
 * them the login page would be a dead end.
 *
 * Exported for the two /manage entry points that call `getManageActor()`
 * directly (the layout and the dashboard). They must agree with the wrappers:
 * layout and page render in PARALLEL, so whichever redirect throws first wins,
 * and a disagreement would make the destination non-deterministic.
 */
export async function manageDenyTarget(): Promise<string> {
  const session = await auth();
  return session?.user ? '/' : loginRedirectHref();
}

/** Layout-level gate: any staff role may enter 管理后台. */
export async function requireAdmin(): Promise<Session> {
  const actor = await getManageActor();
  if (!actor) redirect(await manageDenyTarget());
  return actor.session;
}

/** Page-level gate: this section needs `perm`. Non-staff → home; staff without it → /manage (with a notice). */
export async function requirePermission(perm: PermissionKey): Promise<ManageActor> {
  const actor = await getManageActor();
  if (!actor) redirect(await manageDenyTarget());
  if (!hasPermission(actor.role, perm)) redirect(`/manage?denied=${perm}`);
  return actor;
}

/** 角色与权限 and role assignment: super admin only. */
export async function requireSuperAdmin(): Promise<ManageActor> {
  const actor = await getManageActor();
  if (!actor) redirect(await manageDenyTarget());
  if (!actor.role.isSuperAdmin) redirect('/manage?denied=super');
  return actor;
}

/**
 * Login wall. Pass `fallback` (this route's own path) wherever it is knowable —
 * see `loginRedirectHref`. The three section layouts (/zones, /videos, /votes)
 * cannot know it and rely on the header.
 */
export async function requireUser(fallback?: string): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    redirect(loginRedirectHref(fallback));
  }
  return session;
}

/** RoleError → its status; a Serializable-tx clash → 409 conflict (retry); anything else rethrows. */
export function roleErrorResponse(e: unknown): NextResponse {
  if (e instanceof RoleError) return NextResponse.json({ error: e.code }, { status: e.status });
  if (isSerializationFailure(e)) return NextResponse.json({ error: 'conflict' }, { status: 409 });
  throw e;
}

export type ApiGate =
  | { ok: true; session: Session; role: EffectiveRole }
  | { ok: false; response: NextResponse };

/**
 * API-route gate (DB-backed). `'staff'` = any permission, `'super'` = super
 * admin only, otherwise the named permission.
 *
 *   const gate = await gateApi('users');
 *   if (!gate.ok) return gate.response;
 *   const { session } = gate;
 */
export async function gateApi(perm: PermissionKey | 'staff' | 'super'): Promise<ApiGate> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  const role = await getEffectiveRoleForUser(session.user.id);
  const allowed =
    !!role &&
    (perm === 'staff' ? role.isStaff : perm === 'super' ? role.isSuperAdmin : hasPermission(role, perm));
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true, session, role: role! };
}
