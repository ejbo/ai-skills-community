// 研究所 tiles for the navbar's 技术专区 mega-menu.
//
// There is no 研究所 table: `Zone.lab` is free text (schema comment: "Display
// only; never a join key"), so nothing in the database can carry an institute's
// running order or its artwork. This module is the one place that gap is
// closed — a curated list supplies the order and the picture, live rows supply
// the counts, and either half works alone.

import { prisma } from '@/lib/db';

export interface ZoneLabCard {
  lab: string;
  /** 版块 filed under this 研究所 — matches what `/zones?tab=boards&lab=…` renders. */
  zoneCount: number;
  /**
   * Artwork. Either a curated public asset (`/labs/vision.jpg`) or a
   * representative 版块 cover (`/api/zones/media/…`) — both root-relative, so
   * the renderer MUST wrap them in `withBasePath()` (CLAUDE.md pitfall #9:
   * `<img src>` is not covered by the fetch shim). Null ⇒ generated cover.
   */
  imageUrl: string | null;
  /** Where a borrowed cover came from, for the tile's alt text. */
  sampleZoneName: string | null;
  /** Curated entries hold their slot even at zero 版块. */
  curated: boolean;
}

/**
 * ─── EDIT ME ──────────────────────────────────────────────────────────────
 * The 研究所 the menu should always show, in the order they should appear.
 *
 * `lab` must match `Zone.lab` EXACTLY (it is compared as a string, and it is
 * what `/zones?lab=…` filters on) — a stray space makes a different bucket.
 * `image` is a file you drop in `public/labs/`; omit it and the tile falls back
 * to the 版块 cover, then to a generated one, so a half-filled list still looks
 * finished.
 *
 * Leave the array empty and the grid is purely data-driven: every 研究所 that
 * has a 版块 today, busiest first.
 */
export const CURATED_LABS: { lab: string; image?: string }[] = [
  // The two 研究所 that exist in the data today. Add the other four here — and
  // drop their pictures in `public/labs/` — to get the full six-tile grid.
  { lab: '计算视觉研究所' },
  { lab: '网络技术研究所' },
];

/** 版块 are team boards — the table is small by construction. Bounded anyway. */
const LAB_SCAN_MAX = 500;
/** How many tiles the grid will ever show. */
export const LAB_TILE_MAX = 6;
const TTL_MS = 5 * 60_000;

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
    select: { lab: true, name: true, coverUrl: true },
  });

  const live = new Map<string, { zoneCount: number; coverUrl: string | null; sample: string | null }>();
  for (const r of rows) {
    const lab = r.lab.trim();
    if (!lab) continue; // same rule as zoneOrgTree
    const e = live.get(lab) ?? { zoneCount: 0, coverUrl: null, sample: null };
    e.zoneCount += 1;
    if (!e.coverUrl && r.coverUrl) {
      e.coverUrl = r.coverUrl;
      e.sample = r.name;
    }
    live.set(lab, e);
  }

  const cards: ZoneLabCard[] = [];
  const taken = new Set<string>();
  for (const c of CURATED_LABS) {
    const lab = c.lab.trim();
    if (!lab || taken.has(lab)) continue;
    taken.add(lab);
    const l = live.get(lab);
    cards.push({
      lab,
      zoneCount: l?.zoneCount ?? 0,
      imageUrl: c.image ?? l?.coverUrl ?? null,
      sampleZoneName: c.image ? null : (l?.sample ?? null),
      curated: true,
    });
  }
  // Anything live that the curated list did not name, busiest first.
  const rest = [...live.entries()]
    .filter(([lab]) => !taken.has(lab))
    .sort((a, b) => b[1].zoneCount - a[1].zoneCount || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([lab, l]) => ({
      lab,
      zoneCount: l.zoneCount,
      imageUrl: l.coverUrl,
      sampleZoneName: l.sample,
      curated: false,
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
