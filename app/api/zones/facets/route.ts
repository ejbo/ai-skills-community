// 技术专区 — the hub filter panel's facets (asks #6 + #8): the 研究所 → 部门 tree
// over the 版块 this viewer may read, plus the busiest 栏目 names.
//
// Zone-scoped counts come from `zoneOrgTree` (one groupBy) and are already
// limited to readable zones, so the tree never reveals a 研究所 whose only 版块
// the viewer cannot see.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { zoneSiteViewer } from '@/lib/zones/access';
import { zoneHubFacets } from '@/lib/zones/post-queries';
import { MINUTE_MS, zoneFail } from '../_zone-api';

export const dynamic = 'force-dynamic';

const HUB_READS_PER_MINUTE = 180;

// GET /api/zones/facets → { org: OrgLabNode[], columns: { name, postCount }[] }
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:hub:${session.user.id}`, HUB_READS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_hub', 429, { resetAt: gate.resetAt });

  const facets = await zoneHubFacets(zoneSiteViewer(session.user));
  return NextResponse.json(facets);
}
