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
 * 「技术专区」下拉里的六个研究所 —— 这里就是填的地方。 This array is the whole
 * answer: the six tiles below are what the navbar shows, in this order.
 *
 * TO RENAME A 研究所: change its `lab` string. That is the only edit needed —
 * the tile, its link and its 版块 count all follow.
 *
 *     { lab: '智能网络研究所' },
 *
 * TO GIVE IT A PICTURE: drop the file in `public/labs/` (see the README there
 * for the filenames these entries expect) and uncomment its `image` line:
 *
 *     { lab: '智能网络研究所', image: '/labs/network.jpg' },
 *
 * TO ADD OR REMOVE ONE: add or delete a line. `LAB_TILE_MAX` caps the grid at
 * six, so a seventh entry is simply never shown.
 *
 * Two rules that bite:
 *  • `lab` must match `Zone.lab` EXACTLY — it is compared as a string and it is
 *    what `/zones?lab=…` filters on, so a stray space makes a different bucket
 *    and the tile reads 「0 个版块」. Copy the value from a 版块's 研究所 field.
 *  • A 研究所 with no 版块 yet STILL gets a tile (curated entries hold their
 *    slot at `zoneCount: 0`), which is why the grid is six from day one and the
 *    names below can be filled in before any 版块 exists. Only the artwork
 *    degrades: `image` → a representative 版块 cover → a generated one.
 *
 * Leave the array empty and the grid is purely data-driven: every 研究所 that
 * has a 版块 today, busiest first.
 */
export const CURATED_LABS: { lab: string; image?: string }[] = [
  // ── The two that exist in the data today ──────────────────────────────────
  { lab: '计算视觉研究所' }, // image: '/labs/vision.jpg'
  { lab: '网络技术研究所' }, // image: '/labs/network.jpg'

  // ── PLACEHOLDERS — rename these four ──────────────────────────────────────
  // They are deliberately live (not commented out) so the grid is six tiles
  // from the first day; each renders as an empty 研究所 until it is renamed and
  // a 版块 is filed under it. Replace the string, keep the line.
  // The leading digit is not decoration: with no picture a tile draws its own
  // first character, and four 「研究所…」 placeholders would draw four identical
  // 「研」 squares. Numbered, they read as the empty slots they are.
  { lab: '3 号研究所（待填写）' }, // image: '/labs/lab-3.jpg'
  { lab: '4 号研究所（待填写）' }, // image: '/labs/lab-4.jpg'
  { lab: '5 号研究所（待填写）' }, // image: '/labs/lab-5.jpg'
  { lab: '6 号研究所（待填写）' }, // image: '/labs/lab-6.jpg'
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
