// 组织架构 —— 研究所 → 实验室 → 版块. The vocabulary lives here; the DATA lives in
// the 版块 themselves.
//
// 2026-09-11 (owner decision): the hard-coded list of six 研究所 is GONE, and
// the same day the STRUCTURE moved into the database: 管理后台 → 技术专区 →
// 组织架构 maintains `OrgInstitute` / `OrgLab` rows, `lib/zones/org-catalog.ts`
// loads them into `createOrg(rows)`, and every server consumer takes that `OrgApi`
// as a parameter. `INSTITUTES` below stays EMPTY — it is only the static fallback.
//
// Earlier note (still true for the storage model): There
// are not that many yet, and the people who know which lab a board belongs to
// are the 版主 who create it — so a 版块 now names its own 研究所 and 实验室 (free
// text with suggestions from every value already in use), and every surface
// that used to read the configured tree (navbar tiles, hub rail, pickers)
// reads the LIVE tree instead: whatever the rows carry, busiest first.
//
// The machinery below is kept, with an EMPTY configuration, for two reasons:
//  • every consumer still goes through `mergeInstitutes` / `labsOf` /
//    `instituteOrder`, so pinning an order or artwork later is one entry here,
//    not a rewrite; and
//  • the org tests exercise the merge rules against a fixture (they mock this
//    module with `createOrg(fixture)`), which is the only place a non-empty
//    tree exists today.
//
// HOW IT MAPS ONTO THE COLUMNS (no migration, deliberately)
//   Zone.lab        ← 研究所 name (the TOP level; the navbar tiles; `?lab=`)
//   Zone.department ← 实验室 name (the level under it;                `?department=`)
// The column names are historical and now read backwards; they are kept because
// they are already in URLs, bookmarks, notification links and every existing
// row. Read them through this module and the vocabulary stays straight.

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
  /** One-line description shown in the admin catalog and the navbar tile (optional). */
  description?: string;
}

/**
 * The org helpers over ONE tree. `lib/zones/org-catalog.ts` builds one from the
 * admin-maintained `OrgInstitute` / `OrgLab` tables (`getOrg()`); the static
 * `defaultOrg` below is the empty fallback and what the org tests mock over.
 */
export type OrgApi = ReturnType<typeof createOrg>;

/** The pure helpers over a given tree — `createOrg(fixture)` in tests. */
export function createOrg(institutes: readonly Institute[]) {
  const instituteNames = (): string[] => institutes.map((i) => i.name);
  const labsOf = (institute: string): string[] => {
    const key = institute.trim();
    return institutes.find((i) => i.name === key)?.labs ?? [];
  };
  const allLabs = (): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const inst of institutes) {
      for (const lab of inst.labs) {
        const l = lab.trim();
        if (!l || seen.has(l)) continue;
        seen.add(l);
        out.push(l);
      }
    }
    return out;
  };
  /**
   * Which 研究所 a 实验室 belongs to, or null when it is not in the tree.
   * Ambiguity is refused rather than guessed.
   */
  const instituteOf = (lab: string): string | null => {
    const key = lab.trim();
    if (!key) return null;
    const hits = institutes.filter((i) => i.labs.includes(key));
    return hits.length === 1 ? hits[0].name : null;
  };
  const isKnownInstitute = (name: string): boolean => institutes.some((i) => i.name === name.trim());
  /** Configured position, or `institutes.length` for anything not in the tree. */
  const instituteOrder = (name: string): number => {
    const i = institutes.findIndex((x) => x.name === name.trim());
    return i === -1 ? institutes.length : i;
  };
  /**
   * Merge the configured tree with what the live rows actually carry. Configured
   * institutes keep their slot (at zero when empty); unconfigured ones follow in
   * the caller's order — with an empty config that is simply the live list.
   */
  const mergeInstitutes = <T extends { name: string }>(
    live: readonly T[],
    make: (name: string, live: T | undefined) => T,
  ): T[] => {
    const byName = new Map(live.map((l) => [l.name, l]));
    const out: T[] = institutes.map((i) => make(i.name, byName.get(i.name)));
    const configured = new Set(instituteNames());
    for (const l of live) if (!configured.has(l.name)) out.push(l);
    return out;
  };
  return { INSTITUTES: institutes, instituteNames, labsOf, allLabs, instituteOf, isKnownInstitute, instituteOrder, mergeInstitutes };
}

/**
 * ─── EDIT ME (optional) ───────────────────────────────────────────────────
 * Deliberately EMPTY: the org chart is whatever the 版块 say it is. Add an
 * entry only to pin a 研究所's position or give it artwork (`public/labs/`);
 * nothing is a whitelist and a 版块 filed under any name keeps working.
 */
export const INSTITUTES: Institute[] = [];

/** How many 研究所 tiles the navbar grid will ever show. */
export const INSTITUTE_TILE_MAX = 6;

const org = createOrg(INSTITUTES);
/**
 * The STATIC (empty) tree. Server code that needs the admin-maintained catalog
 * must go through `getOrg()` in lib/zones/org-catalog.ts and pass the result
 * down to the pure helpers (`withConfiguredInstitutes(tree, org)` etc.).
 */
export const defaultOrg: OrgApi = org;

/** 研究所 names in configured order. */
export const instituteNames: () => string[] = org.instituteNames;
/** The 实验室 of one 研究所 ([] when unknown — never null, callers concat freely). */
export const labsOf: (institute: string) => string[] = org.labsOf;
/** Every configured 实验室, deduped, in institute order. */
export const allLabs: () => string[] = org.allLabs;
export const instituteOf: (lab: string) => string | null = org.instituteOf;
export const isKnownInstitute: (name: string) => boolean = org.isKnownInstitute;
export const instituteOrder: (name: string) => number = org.instituteOrder;
export const mergeInstitutes: <T extends { name: string }>(
  live: readonly T[],
  make: (name: string, live: T | undefined) => T,
) => T[] = org.mergeInstitutes;
