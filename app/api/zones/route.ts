import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { ZONE_LIMITS, parseZoneSort } from '@/lib/zones/shared';
import { canUserCreateZone, zoneSiteViewer } from '@/lib/zones/access';
import { createZone, listZones, zoneInputSchema } from '@/lib/zones/queries';
import { HOUR_MS, intParam, invalidInput, strParam, zoneErrorResponse, zoneFail } from './_zone-api';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
const CREATES_PER_HOUR = 5;

// GET /api/zones?q&lab&department&sort&page&pageSize&mine=1 — hub listing.
// /zones is login-walled, so the API is too (401, never an anonymous list).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const viewer = zoneSiteViewer(session.user);
  const sp = new URL(req.url).searchParams;
  const q = strParam(sp.get('q'), 100);
  const lab = strParam(sp.get('lab'), ZONE_LIMITS.labMax);
  const department = strParam(sp.get('department'), ZONE_LIMITS.departmentMax);
  const sort = parseZoneSort(sp.get('sort'));
  const page = intParam(sp.get('page'), 1, 1, 10_000);
  const pageSize = intParam(sp.get('pageSize'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  // `mine` is a FACET keyed on the viewer id only — never client input.
  const mine = sp.get('mine') === '1';

  const result = await listZones({
    q: q || undefined,
    lab: lab || undefined,
    department: department || undefined,
    sort,
    page,
    pageSize,
    mineFor: mine ? viewer.id : null,
    viewer,
  });
  return NextResponse.json(result);
}

// POST /api/zones { ...ZoneInput } — create a zone (site `zones` permission OR
// the per-user `canCreateZones` switch). The creator becomes 主版主.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:create:${session.user.id}`, CREATES_PER_HOUR, HOUR_MS);
  if (!gate.allowed) return zoneFail('rate_limited_create', 429, { resetAt: gate.resetAt });

  if (!(await canUserCreateZone(session.user))) return zoneFail('cannot_create', 403);

  const body = await req.json().catch(() => null);
  const parsed = zoneInputSchema.safeParse(body);
  if (!parsed.success) return invalidInput();

  try {
    const created = await createZone(parsed.data, session.user.id);
    return NextResponse.json({ id: created.id, slug: created.slug }, { status: 201 });
  } catch (e) {
    return zoneErrorResponse(e);
  }
}
