// Docked reading panel — the pure geometry of the split (plain module, no React,
// no window). Everything here is unit-tested (tests/zones-split-shared.test.ts);
// the DOM-facing half lives in useSplitResize.ts and reads window only there.
//
// The panel is right-docked and the ARTICLE keeps a floor: DOCK_MAX is whatever
// the viewport leaves once ARTICLE_MIN (640) is reserved, capped at DOCK_HARD_MAX
// so an ultrawide monitor does not turn the panel into a second page. A drag past
// a bound rubber-bands (tanh — asymptote RUBBER_BAND_PX·RUBBER_BAND_K ≈ 42 px) and
// springs back on release; with reduced motion the overshoot is zero.

export const DOCK_MIN = 380;
export const DOCK_DEFAULT = 520;
/** ←/→ on the sash; Shift multiplies by 4. */
export const DOCK_STEP = 16;
export const DOCK_STORAGE_KEY = 'zones:dock:w';
/** Page column floor: DOCK_MAX = viewport − ARTICLE_MIN. */
export const ARTICLE_MIN = 640;
export const DOCK_HARD_MAX = 760;
export const RUBBER_BAND_PX = 120;
export const RUBBER_BAND_K = 0.35;

/** Widest the panel may be at this viewport (never below DOCK_MIN, so the clamp stays well-ordered). */
export function dockMaxFor(viewportWidth: number): number {
  const vw = Number.isFinite(viewportWidth) ? viewportWidth : 0;
  return Math.max(DOCK_MIN, Math.min(DOCK_HARD_MAX, Math.round(vw - ARTICLE_MIN)));
}

/** Clamp into [DOCK_MIN, dockMaxFor(vw)]; NaN / ±∞ fall back to DOCK_DEFAULT (then clamped). */
export function clampDockWidth(width: number, viewportWidth: number): number {
  const w = Number.isFinite(width) ? width : DOCK_DEFAULT;
  return Math.min(Math.max(Math.round(w), DOCK_MIN), dockMaxFor(viewportWidth));
}

/**
 * Visual overshoot for a drag `overshoot` px past a bound (sign-preserving).
 * tanh gives a soft, bounded resistance; reduced motion ⇒ no overshoot at all.
 */
export function rubberBand(overshoot: number, reduce: boolean): number {
  if (reduce || !Number.isFinite(overshoot) || overshoot === 0) return 0;
  return Math.tanh(overshoot / RUBBER_BAND_PX) * RUBBER_BAND_PX * RUBBER_BAND_K;
}

/** Parse a persisted width (localStorage) and clamp it; garbage ⇒ DOCK_DEFAULT. */
export function readStoredWidth(raw: string | null | undefined, viewportWidth: number): number {
  if (raw == null) return clampDockWidth(DOCK_DEFAULT, viewportWidth);
  const trimmed = String(raw).trim();
  const n = /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return clampDockWidth(Number.isFinite(n) ? n : DOCK_DEFAULT, viewportWidth);
}
