// 最热 — the pure half of the hotness ranking (owner, 2026-10-09: 「把时间的实效算进去，
// 比如最近一周算是最新的，加上其火不火」).
//
// Score = Σ over every engagement EVENT inside the window of
//   weight(kind) × 0.5 ^ (age / HALF_LIFE)
// — the same shape Reddit/HN use (points over decayed time), but summed per
// event so a doc stays hot only while people keep touching it. A view from six
// days ago is worth ~1/4 of one from today; a comment outweighs a view 5:1. A
// doc with no events in the window does not rank. The doc's own creation is
// one (weak) event, so a fresh submission appears at the bottom of 最热 until
// readers arrive instead of being invisible for a week.
//
// The ranking itself runs in SQL (lib/library-queries.ts#getHotDocs) with these
// constants; this module exists so the arithmetic is unit-tested and the
// numbers live in exactly one place.

export const HOT_WINDOW_DAYS = 7;
export const HOT_HALF_LIFE_DAYS = 3;

export const HOT_WEIGHTS = {
  /** A LibraryView row — one per visitor per day. */
  view: 1,
  /** A LibraryProgress touch — someone actually reading (updatedAt moves on every ping). */
  read: 3,
  /** 加入书架. */
  shelf: 4,
  /** 喜欢. */
  like: 2,
  /** A visible comment. */
  comment: 5,
  /** A highlight / note. */
  note: 4,
  /** The doc's own creation (freshness). */
  fresh: 2,
} as const;
export type HotEventKind = keyof typeof HOT_WEIGHTS;

const DAY_MS = 86_400_000;

/** 0.5 ^ (age / half-life); 1 for "just now", 0.5 after HOT_HALF_LIFE_DAYS, ~0.2 after a week. */
export function decayWeight(ageMs: number, halfLifeDays = HOT_HALF_LIFE_DAYS): number {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / (halfLifeDays * DAY_MS));
}

/** Reference implementation of the SQL ranking for one doc (tests pin SQL ⇔ TS agreement by construction). */
export function hotScore(events: { kind: HotEventKind; ageMs: number }[], now = Date.now()): number {
  void now;
  let score = 0;
  for (const e of events) {
    if (e.ageMs > HOT_WINDOW_DAYS * DAY_MS) continue;
    score += HOT_WEIGHTS[e.kind] * decayWeight(e.ageMs);
  }
  return score;
}
