// 组织架构 —— 研究所 → 实验室 → 版块. The single source of truth for the org
// tree, and the one file to edit when the organisation changes.
//
// WHY A CONFIG MODULE AND NOT A TABLE
// There is no org table and a 版块's org fields are free text (`Zone.lab`,
// `Zone.department`, both "display only; never a join key"). Free text is
// exactly why the data drifted: three zones, three spellings of the second
// level, and nothing that says which 研究所 the platform actually has. An org
// chart changes a few times a year and is decided by one person, so a reviewed
// file beats a CRUD screen — and unlike a table it can carry the artwork and
// the running order the navigation needs.
//
// HOW IT MAPS ONTO THE COLUMNS (no migration, deliberately)
//   Zone.lab        ← 研究所 name (the TOP level; the navbar tiles; `?lab=`)
//   Zone.department ← 实验室 name (the level under it;                `?department=`)
// The column names are historical and now read backwards; they are kept because
// they are already in URLs, bookmarks, notification links and every existing
// row. Read them through this module and the vocabulary stays straight.
//
// TOLERANT BY DESIGN
// Nothing here is a whitelist. A 版块 filed under an institute or lab that is
// not listed below keeps working and still shows up in the filters — it simply
// sorts after the configured ones. That is what lets the tree be filled in over
// time without blocking anyone from creating a 版块 today.

export interface Institute {
  /**
   * 研究所 name, stored VERBATIM in `Zone.lab` and used as the `?lab=` filter
   * value — a stray space makes a different bucket.
   */
  name: string;
  /** The 实验室 that make up this 研究所, stored verbatim in `Zone.department`. */
  labs: string[];
  /** Tile artwork, a file under `public/labs/`. Omit for a generated cover. */
  image?: string;
}

/**
 * ─── EDIT ME ──────────────────────────────────────────────────────────────
 * The six 研究所, in the order the navbar should show them.
 *
 * To rename one: change `name` — and, if 版块 already point at the old string,
 * update those rows too (the value IS the link between a 版块 and its 研究所).
 * To add a 实验室: add a string to `labs`; the create-zone form offers it at once.
 * To give a 研究所 a picture: drop a file in `public/labs/` and set `image`.
 *
 * The two institutes with real 版块 today are listed first with the second-level
 * values those 版块 actually carry. Those look like 事业部/产品线 rather than
 * laboratories — they are what the rows say, so they are seeded here verbatim
 * and should be corrected to the real 实验室 names when they are known.
 */
export const INSTITUTES: Institute[] = [
  { name: '计算视觉研究所', labs: ['AI事业部', '智能终端'] }, // image: '/labs/vision.jpg'
  { name: '网络技术研究所', labs: ['云核心网'] }, // image: '/labs/network.jpg'
  { name: '3 号研究所（待填写）', labs: [] }, // image: '/labs/lab-3.jpg'
  { name: '4 号研究所（待填写）', labs: [] }, // image: '/labs/lab-4.jpg'
  { name: '5 号研究所（待填写）', labs: [] }, // image: '/labs/lab-5.jpg'
  { name: '6 号研究所（待填写）', labs: [] }, // image: '/labs/lab-6.jpg'
];

/** How many 研究所 tiles the navbar grid will ever show. */
export const INSTITUTE_TILE_MAX = 6;

/** 研究所 names in configured order. */
export function instituteNames(): string[] {
  return INSTITUTES.map((i) => i.name);
}

/** The 实验室 of one 研究所 ([] when unknown — never null, callers concat freely). */
export function labsOf(institute: string): string[] {
  const key = institute.trim();
  return INSTITUTES.find((i) => i.name === key)?.labs ?? [];
}

/** Every configured 实验室, deduped, in institute order. */
export function allLabs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const inst of INSTITUTES) {
    for (const lab of inst.labs) {
      const l = lab.trim();
      if (!l || seen.has(l)) continue;
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}

/**
 * Which 研究所 a 实验室 belongs to, or null when it is not in the tree.
 * Ambiguity is refused rather than guessed: if two institutes list the same lab
 * name, the answer is null, because picking the first would silently file a
 * 版块 under the wrong 研究所.
 */
export function instituteOf(lab: string): string | null {
  const key = lab.trim();
  if (!key) return null;
  const hits = INSTITUTES.filter((i) => i.labs.includes(key));
  return hits.length === 1 ? hits[0].name : null;
}

export function isKnownInstitute(name: string): boolean {
  return INSTITUTES.some((i) => i.name === name.trim());
}

/**
 * Sort key for a 研究所: its configured position, or `INSTITUTES.length` for
 * anything not in the tree, so configured institutes lead and the rest follow
 * in whatever order the caller applies next (usually 版块 count).
 */
export function instituteOrder(name: string): number {
  const i = INSTITUTES.findIndex((x) => x.name === name.trim());
  return i === -1 ? INSTITUTES.length : i;
}

/**
 * Merge the configured tree with what the live rows actually carry, so the UI
 * shows every institute that exists AND every institute that should exist.
 * `counts` is keyed by institute name. Configured institutes keep their slot at
 * zero; unconfigured ones are appended, busiest first.
 */
export function mergeInstitutes<T extends { name: string }>(
  live: readonly T[],
  make: (name: string, live: T | undefined) => T,
): T[] {
  const byName = new Map(live.map((l) => [l.name, l]));
  const out: T[] = INSTITUTES.map((i) => make(i.name, byName.get(i.name)));
  const configured = new Set(instituteNames());
  for (const l of live) if (!configured.has(l.name)) out.push(l);
  return out;
}
