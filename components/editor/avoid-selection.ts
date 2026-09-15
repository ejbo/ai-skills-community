// Keeps a floating panel off the text it acts on. Pure (no DOM, no React) so the
// geometry is unit-tested; TextStyleMenu feeds it live measurements.
//
// Why: the 文字样式 popover is anchored under its toolbar trigger, and the
// toolbar is sticky — so the panel always opens in the same box right under the
// toolbar, which is exactly where the selected text is whenever the author
// formats the first lines of a post or scrolls a paragraph up under the toolbar.
// For mouse users the panel stays open between picks (colour, then background,
// size, font), so they picked every one of them blind.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PanelBox {
  left: number;
  top: number;
  width: number;
  height: number;
  maxHeight: number;
}

export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

const GAP_PX = 8;
const EDGE_PX = 8;
/** Below this the panel is too short to use; the original spot wins then. */
const MIN_PANEL_H = 160;

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Where `panel` goes so it does not cover `selection`, trying in order: the
 * spot it already has (when it does not overlap), right of the selection, left
 * of it, below it, above it. Every candidate stays inside `viewport`; when none
 * fits, the original spot is kept (covering the text beats a panel off screen).
 */
export function panelAvoidingSelection(panel: PanelBox, selection: Rect | null, viewport: Viewport): PanelBox {
  if (!selection) return panel;
  const height = Math.min(panel.height, panel.maxHeight);
  const box = (left: number, top: number, h = height): Rect => ({ left, top, right: left + panel.width, bottom: top + h });
  if (!overlaps(box(panel.left, panel.top), selection)) return panel;

  const vpLeft = viewport.left + EDGE_PX;
  const vpTop = viewport.top + EDGE_PX;
  const vpRight = viewport.left + viewport.width - EDGE_PX;
  const vpBottom = viewport.top + viewport.height - EDGE_PX;
  const fitsVertically = panel.top >= vpTop && panel.top + height <= vpBottom;

  const right = selection.right + GAP_PX;
  if (fitsVertically && right + panel.width <= vpRight) return { ...panel, left: Math.round(right) };

  const left = selection.left - GAP_PX - panel.width;
  if (fitsVertically && left >= vpLeft) return { ...panel, left: Math.round(left) };

  const below = selection.bottom + GAP_PX;
  const roomBelow = vpBottom - below;
  if (roomBelow >= Math.min(height, MIN_PANEL_H)) {
    return { ...panel, top: Math.round(below), maxHeight: Math.max(MIN_PANEL_H, Math.floor(Math.min(panel.maxHeight, roomBelow))) };
  }

  const above = selection.top - GAP_PX - height;
  if (above >= vpTop) return { ...panel, top: Math.round(above) };

  return panel;
}
