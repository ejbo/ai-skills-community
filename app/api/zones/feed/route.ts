// 技术专区 — the /zones landing feed (ask #6 + #7): the newest / hottest posts
// across every 版块 the viewer may read, filtered by 研究所 → 部门, 栏目, type and
// a free-text query.
//
// Policy is NOT re-derived here: `listZoneFeed` composes `readableZoneWhere`
// (the zone gate) with `zonePostVisibilityWhere` (the post gate) into the SQL
// `where`, so a `members` / `restricted` post is never fetched, and paging
// counts stay honest. This handler only parses and clamps query params.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { zoneSiteViewer } from '@/lib/zones/access';
import { listZoneFeed } from '@/lib/zones/post-queries';
import { ZONE_LIMITS, isZonePostType, parseMultiParam, parseZoneFeedSort } from '@/lib/zones/shared';
import type { ZonePostTypeValue } from '@/lib/zones/shared';
import { MINUTE_MS, intParam, strParam, zoneFail } from '../_zone-api';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Generous: the hub polls this on every filter change and every 加载更多. */
const HUB_READS_PER_MINUTE = 180;

// GET /api/zones/feed?sort=new|hot&lab=a,b&department=x,y&column=c,d&type=article,paper
//                    &q=&zone=<slug>&cursor=&limit=
//   → { items, hasMore, nextCursor, total }
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:hub:${session.user.id}`, HUB_READS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_hub', 429, { resetAt: gate.resetAt });

  const sp = new URL(req.url).searchParams;
  const labs = parseMultiParam(sp.get('lab')).map((v) => v.slice(0, ZONE_LIMITS.labMax));
  const departments = parseMultiParam(sp.get('department')).map((v) => v.slice(0, ZONE_LIMITS.departmentMax));
  const columns = parseMultiParam(sp.get('column')).map((v) => v.slice(0, ZONE_LIMITS.columnNameMax * 2));
  // `type` is multi-select like the rest of the rail; unknown values are dropped
  // rather than 400ing, so a stale bookmarked URL still renders a feed.
  const types = parseMultiParam(sp.get('type')).filter((v): v is ZonePostTypeValue => isZonePostType(v));

  const result = await listZoneFeed({
    viewer: zoneSiteViewer(session.user),
    sort: parseZoneFeedSort(sp.get('sort')),
    labs,
    departments,
    columns,
    types,
    q: strParam(sp.get('q'), 100) || undefined,
    zoneSlug: strParam(sp.get('zone'), 64).toLowerCase() || null,
    cursor: strParam(sp.get('cursor'), 200) || null,
    limit: intParam(sp.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
  });
  return NextResponse.json(result);
}
