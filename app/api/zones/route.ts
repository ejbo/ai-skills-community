import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { ZONE_LIMITS, parseMultiParam, parseZoneSort } from '@/lib/zones/shared';
import { canUserCreateZone, zoneSiteViewer } from '@/lib/zones/access';
import { createZone, listZones, zoneInputSchema, type ListZonesFilters } from '@/lib/zones/queries';
import type { ZoneCardView } from '@/lib/zones/types';
import { HOUR_MS, intParam, invalidInput, strParam, zoneErrorResponse, zoneFail } from './_zone-api';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
const CREATES_PER_HOUR = 5;
/** `listZones`' own pageSize ceiling — the scan below pages at that width. */
const SCAN_PAGE_SIZE = 60;
/** Hard ceiling on rows scanned for a multi-facet filter (10 queries worst case). */
const SCAN_CAP = 600;

type ZoneListResult = Awaited<ReturnType<typeof listZones>>;

/**
 * 版块 filtering by 研究所 → 部门 is MULTI-select (ask #8), but `listZones` takes
 * one value per facet. One value per facet is therefore the indexed fast path;
 * several are resolved by scanning `listZones`' own ordered pages and filtering
 * in order (concatenating consecutive pages IS the full ordered list, so paging
 * the filtered result stays faithful to the requested sort). Bounded by SCAN_CAP.
 *
 * FOLLOW-UP: once `ListZonesFilters` grows `labs`/`departments` arrays, delete
 * the scan branch and pass them straight through.
 */
async function listZonesFiltered(
  base: Omit<ListZonesFilters, 'lab' | 'department' | 'page' | 'pageSize'>,
  labs: string[],
  departments: string[],
  page: number,
  pageSize: number,
): Promise<ZoneListResult> {
  if (labs.length <= 1 && departments.length <= 1) {
    return listZones({ ...base, lab: labs[0], department: departments[0], page, pageSize });
  }

  const labSet = new Set(labs);
  const deptSet = new Set(departments);
  const matched: ZoneCardView[] = [];
  let scanned = 0;
  for (let p = 1; ; p++) {
    const chunk = await listZones({ ...base, page: p, pageSize: SCAN_PAGE_SIZE });
    for (const zone of chunk.items) {
      if (labSet.size > 0 && !labSet.has(zone.lab)) continue;
      if (deptSet.size > 0 && !deptSet.has(zone.department)) continue;
      matched.push(zone);
    }
    scanned += chunk.items.length;
    if (!chunk.hasMore || chunk.items.length === 0 || scanned >= SCAN_CAP) break;
  }

  const total = matched.length;
  const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  return {
    items: matched.slice((current - 1) * pageSize, current * pageSize),
    total,
    page: current,
    pageSize,
    hasMore: current * pageSize < total,
  };
}

// GET /api/zones?q&lab=a,b&department=x,y&sort&page&pageSize&mine=1 — hub listing.
// /zones is login-walled, so the API is too (401, never an anonymous list).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const viewer = zoneSiteViewer(session.user);
  const sp = new URL(req.url).searchParams;
  const q = strParam(sp.get('q'), 100);
  // `?lab=a,b&department=x,y` — the hub's 研究所 → 部门 rail is multi-select.
  const labs = parseMultiParam(sp.get('lab')).map((v) => v.slice(0, ZONE_LIMITS.labMax));
  const departments = parseMultiParam(sp.get('department')).map((v) => v.slice(0, ZONE_LIMITS.departmentMax));
  const sort = parseZoneSort(sp.get('sort'));
  const page = intParam(sp.get('page'), 1, 1, 10_000);
  const pageSize = intParam(sp.get('pageSize'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  // `mine` is a FACET keyed on the viewer id only — never client input.
  const mine = sp.get('mine') === '1';

  const result = await listZonesFiltered(
    {
      q: q || undefined,
      sort,
      mineFor: mine ? viewer.id : null,
      viewer,
    },
    labs,
    departments,
    page,
    pageSize,
  );
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
