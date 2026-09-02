// Page band under the docked panel (plain module — imported by RSC-safe code
// and the client provider alike). `usePageBand()` publishes it so a page can
// drop a rail or tighten its grid when the panel takes the room; 'wide' is the
// server/first-render value so SSR markup never depends on a measurement.

export type PageBand = 'wide' | 'narrow';

/** The page column keeps its two-column layouts at or above this width. */
export const WIDE_PAGE_MIN_PX = 1008;

/** ≥ WIDE_PAGE_MIN_PX ⇒ 'wide'; NaN / unmeasured ⇒ 'wide' (never narrow a page by accident). */
export function pageBandFor(pageWidthPx: number): PageBand {
  if (!Number.isFinite(pageWidthPx)) return 'wide';
  return pageWidthPx >= WIDE_PAGE_MIN_PX ? 'wide' : 'narrow';
}
