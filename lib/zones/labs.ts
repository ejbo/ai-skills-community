// 研究所 tiles for the navbar's 技术专区 mega-menu.
//
// THIS MODULE NO LONGER OWNS THE LIST. `lib/org.ts` is the single source of
// truth for the org tree — 研究所 (top level) → 实验室 (the labs that make one
// up) — and this file only DRESSES it for the navbar: live 版块 counts, a
// borrowed cover, the process-wide memo. It used to carry its own
// `CURATED_LABS` array, which was a second list of the same six 研究所 that
// could silently disagree with the filter rail and the create form.
//
// The columns still read backwards and are deliberately NOT renamed:
//   Zone.lab        = 研究所 (the tile, the `?lab=` filter value)
//   Zone.department = 实验室 (the level under it, `?department=`)
// See the header of lib/org.ts. To add, rename or picture a 研究所, edit
// `INSTITUTES` there — nothing in this file needs to change.

import { prisma } from '@/lib/db';
// The config↔live merge lives in lib/zones/shared.ts so the rails and the DB
// tree cannot drift; re-exported here because the hub already imports it from
// this module.
export { withConfiguredInstitutes } from '@/lib/zones/shared';
import { INSTITUTES, INSTITUTE_TILE_MAX, labsOf, mergeInstitutes } from '@/lib/org';
import type { OrgLabNode } from '@/lib/zones/shared';

export interface ZoneLabCard {
  /**
   * 研究所 name — stored verbatim in `Zone.lab`, and the `?lab=` filter value
   * the tile links to. (The field keeps the column's historical name.)
   */
  lab: string;
  /**
   * The 实验室 that make up this 研究所: the configured ones from lib/org.ts
   * first, then any extra second-level value live 版块 actually carry. Shown
   * under the tile's name so the grid reads as a hierarchy, not a flat list.
   */
  labs: string[];
  /** 版块 filed under this 研究所 — matches what `/zones?tab=boards&lab=…` renders. */
  zoneCount: number;
  /**
   * Artwork. Either a configured public asset (`/labs/vision.jpg`) or a
   * representative 版块 cover (`/api/zones/media/…`) — both root-relative, so
   * the renderer MUST wrap them in `withBasePath()` (CLAUDE.md pitfall #9:
   * `<img src>` is not covered by the fetch shim). Null ⇒ generated cover.
   */
  imageUrl: string | null;
  /** Where a borrowed cover came from, for the tile's alt text. */
  sampleZoneName: string | null;
  /** In lib/org.ts's `INSTITUTES` — holds its slot even at zero 版块. */
  configured: boolean;
}

/** 版块 are team boards — the table is small by construction. Bounded anyway. */
const LAB_SCAN_MAX = 500;
/**
 * How many tiles the grid will ever show. Defers to the org config so the
 * navbar can never disagree with `INSTITUTES` about how many 研究所 there are.
 */
export const LAB_TILE_MAX = INSTITUTE_TILE_MAX;
const TTL_MS = 5 * 60_000;

const collate = (a: string, b: string) => a.localeCompare(b, 'zh-CN');

let cache: { at: number; data: ZoneLabCard[] } | null = null;
let inflight: Promise<ZoneLabCard[]> | null = null;


/**
 * The DISCOVERABLE gate (`deletedAt: null`), not `readableZoneWhere(viewer)`.
 * Two reasons, and they point the same way: it is the gate `/zones?tab=boards`
 * itself uses, so the number on a tile matches the number of cards behind it
 * (app/zones/page.tsx documents that same mismatch); and it is viewer-
 * independent, which is what lets one memo serve the whole process. It leaks
 * nothing new — those covers are already on /zones for every signed-in user.
 */
async function loadLabs(): Promise<ZoneLabCard[]> {
  const rows = await prisma.zone.findMany({
    where: { deletedAt: null, lab: { not: '' } },
    orderBy: [
      { featured: 'desc' },
      // Covered zones first, so the first hit per lab is the one with art.
      { coverUrl: { sort: 'desc', nulls: 'last' } },
      { postCount: 'desc' },
      { id: 'asc' },
    ],
    take: LAB_SCAN_MAX,
    select: { lab: true, department: true, name: true, coverUrl: true },
  });

  const live = new Map<
    string,
    { zoneCount: number; coverUrl: string | null; sample: string | null; labs: Set<string> }
  >();
  for (const r of rows) {
    const institute = r.lab.trim();
    if (!institute) continue; // same rule as zoneOrgTree
    const e = live.get(institute) ?? { zoneCount: 0, coverUrl: null, sample: null, labs: new Set<string>() };
    e.zoneCount += 1;
    const lab = (r.department ?? '').trim();
    if (lab) e.labs.add(lab);
    if (!e.coverUrl && r.coverUrl) {
      e.coverUrl = r.coverUrl;
      e.sample = r.name;
    }
    live.set(institute, e);
  }

  const cards: ZoneLabCard[] = [];
  const taken = new Set<string>();
  for (const inst of INSTITUTES) {
    const institute = inst.name.trim();
    if (!institute || taken.has(institute)) continue;
    taken.add(institute);
    const l = live.get(institute);
    // Configured 实验室 lead (that is the org chart); anything the rows carry
    // and the config does not name follows, so a tile never hides real data.
    const configuredLabs = inst.labs.map((s) => s.trim()).filter(Boolean);
    const known = new Set(configuredLabs);
    const extras = [...(l?.labs ?? [])].filter((x) => !known.has(x)).sort(collate);
    cards.push({
      lab: institute,
      labs: [...configuredLabs, ...extras],
      zoneCount: l?.zoneCount ?? 0,
      imageUrl: inst.image ?? l?.coverUrl ?? null,
      sampleZoneName: inst.image ? null : (l?.sample ?? null),
      configured: true,
    });
  }
  // Anything live that the org config did not name, busiest first.
  const rest = [...live.entries()]
    .filter(([institute]) => !taken.has(institute))
    .sort((a, b) => b[1].zoneCount - a[1].zoneCount || collate(a[0], b[0]))
    .map(([institute, l]) => ({
      lab: institute,
      labs: [...l.labs].sort(collate),
      zoneCount: l.zoneCount,
      imageUrl: l.coverUrl,
      sampleZoneName: l.sample,
      configured: false,
    }));

  return [...cards, ...rest].slice(0, LAB_TILE_MAX);
}

/** Process-wide memo — the payload is identical for every signed-in viewer. */
export async function zoneLabCards(): Promise<ZoneLabCard[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = loadLabs()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .catch((err) => {
      // A nav menu must never take a page down. Serve stale, else nothing.
      console.error('[zone-labs] failed', err);
      return cache?.data ?? [];
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
