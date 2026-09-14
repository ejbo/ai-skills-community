// 组织架构目录 — the admin-maintained 研究所 → 实验室 tree (OrgInstitute / OrgLab),
// loaded into the pure `createOrg()` helpers from lib/org.ts.
//
// Server-only (Prisma). Every consumer that used to read the static `INSTITUTES`
// config now calls `getOrg()` and passes the result down:
//   withConfiguredInstitutes(tree, org)      lib/zones/shared.ts   (hub rails)
//   buildZoneOrgOptions(pairs, …, org)       lib/zones/queries.ts  (pickers)
//   zoneLabCards()                           lib/zones/labs.ts     (navbar tiles)
//   app/zones/page.tsx                       (empty-institute placeholder)
//
// Memoized per process for CATALOG_TTL_MS; the admin write paths call
// `invalidateOrgCatalog()` so an edit shows up on the next request instead of a
// minute later. The rows are tiny (tens, not thousands) so the whole tree is
// one query with the labs included.

import { prisma } from '@/lib/db';
import { createOrg, type Institute, type OrgApi } from '@/lib/org';

const CATALOG_TTL_MS = 60_000;

let cache: { at: number; institutes: Institute[]; org: OrgApi } | null = null;
let inflight: Promise<{ institutes: Institute[]; org: OrgApi }> | null = null;

async function load(): Promise<{ institutes: Institute[]; org: OrgApi }> {
  const rows = await prisma.orgInstitute.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      name: true,
      description: true,
      imageUrl: true,
      labs: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { name: true } },
    },
  });
  const institutes: Institute[] = rows.map((r) => ({
    name: r.name,
    labs: r.labs.map((l) => l.name),
    ...(r.imageUrl ? { image: r.imageUrl } : {}),
    ...(r.description ? { description: r.description } : {}),
  }));
  return { institutes, org: createOrg(institutes) };
}

/** The catalog as `Institute[]` (configured order) plus the helpers over it. */
export async function getOrgCatalog(): Promise<{ institutes: Institute[]; org: OrgApi }> {
  if (cache && Date.now() - cache.at < CATALOG_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = load()
    .then((data) => {
      cache = { at: Date.now(), ...data };
      return data;
    })
    .catch((err) => {
      // The catalog decorates lists; it must never take a page down. Serve
      // stale, else the empty static tree.
      console.error('[org-catalog] failed', err);
      return cache ?? { institutes: [], org: createOrg([]) };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Just the helpers — what most consumers want. */
export async function getOrg(): Promise<OrgApi> {
  return (await getOrgCatalog()).org;
}

/** Called by every admin write in lib/zones/org-admin.ts. */
export function invalidateOrgCatalog(): void {
  cache = null;
}
