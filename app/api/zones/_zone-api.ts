// 技术专区 API — tiny helpers shared by the zone route handlers (NOT a route:
// files that are not `route.ts` are invisible to the App Router).
//
// Policy never lives here: every handler decides from `zoneContext(...).access`
// booleans (lib/zones/access.ts). This module only maps lib errors to the house
// `{ error, reason }` payload and centralizes the localized `reason` lookup so a
// ZoneError code thrown by lib/zones/queries.ts surfaces as `api_errors.zone_<code>`.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ZoneError } from '@/lib/zones/queries';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import { ZONE_ROLE_KEY_RE, normalizeZonePermissions, type ZoneAccess } from '@/lib/zones/permissions';

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;

/**
 * Zone role payload (POST /roles, PATCH /roles/[roleId] uses `.partial()`).
 * Lives here — NOT in a route.ts — because the App Router rejects non-handler
 * exports from route modules. Permissions are normalized against the catalog
 * (unknown keys dropped, catalog order restored).
 */
export const roleInputSchema = z.object({
  key: z.string().trim().toLowerCase().regex(ZONE_ROLE_KEY_RE),
  name: z.string().trim().min(1).max(ZONE_LIMITS.roleNameMax),
  description: z.string().trim().max(ZONE_LIMITS.roleDescriptionMax).nullable().optional(),
  permissions: z
    .array(z.string().max(32))
    .max(32)
    .default([])
    .transform((v) => normalizeZonePermissions(v)),
});

/**
 * Localized reason for a zone error code (`api_errors.zone_<code>`). Returns
 * undefined when the key is not in the catalog so an unexpected lib code never
 * leaks a raw `api_errors.zone_x` key path into a toast — clients fall back to
 * their own generic text.
 */
export async function zoneReason(
  code: string,
  values?: Record<string, string | number | Date>,
): Promise<string | undefined> {
  try {
    const t = await getTranslations('api_errors');
    const key = `zone_${code}`;
    return t.has(key) ? t(key, values) : undefined;
  } catch {
    return undefined;
  }
}

/** `{ error: code, reason }` with an explicit status. */
export async function zoneFail(
  code: string,
  status: number,
  extra?: Record<string, unknown>,
): Promise<NextResponse> {
  return NextResponse.json({ error: code, reason: await zoneReason(code), ...(extra ?? {}) }, { status });
}

/**
 * ZoneError → its own status + localized reason; a Serializable-tx clash
 * (P2034) or a unique-index race (P2002) → 409 `conflict`; anything else is a
 * real bug and rethrows (Next turns it into a 500 with a server-side log).
 */
export async function zoneErrorResponse(e: unknown): Promise<NextResponse> {
  if (e instanceof ZoneError) return zoneFail(e.code, e.status);
  if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2002')) {
    return zoneFail('conflict', 409);
  }
  throw e;
}

/** 400 `invalid_input` with the house-wide localized reason. */
export async function invalidInput(): Promise<NextResponse> {
  let reason: string | undefined;
  try {
    const t = await getTranslations('api_errors');
    reason = t('invalid_request');
  } catch {
    reason = undefined;
  }
  return NextResponse.json({ error: 'invalid_input', reason }, { status: 400 });
}

/** Audit IP = FIRST XFF hop (house convention for logAdmin). */
export function auditIp(req: Request): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;
}

/**
 * A holder of the SITE `zones` permission acting on a zone they do not own is
 * exercising site-level power — those actions are audit-logged (logAdmin).
 */
export function actingAsSiteAdmin(access: ZoneAccess): boolean {
  return access.siteAdmin && !access.isOwner;
}

/** Clamped integer query param. */
export function intParam(raw: string | null, def: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Trimmed, length-capped string query param ('' when absent). */
export function strParam(raw: string | null, max: number): string {
  return (raw ?? '').trim().slice(0, max);
}
