'use client';

// Shared anchoring for any dropdown that must escape its own header.
//
// Written for the 技术专区 header menus (管理 / 已加入) and the navbar's overflow
// menu; the language and user menus, the editor's 文字样式 popover and the @人
// picker ride it too. The first two sit inside an ancestor that would otherwise eat the
// panel — the zone header <section> is `relative overflow-hidden` (cover image
// + HairlineGrid) so an absolutely positioned menu is CLIPPED at ANY z-index,
// and `NavBarShell` carries a `transition-transform` that makes it a
// containing block for `position: fixed`. The fix is the one `DeptTag` uses:
// PORTAL the panel to <body> and position it from the trigger's getClientRect.
//
// This hook owns everything portaling costs us, so the two menus can never
// drift apart:
//   • the panel is no longer a DOM descendant of the trigger ⇒ outside-click
//     tests BOTH nodes;
//   • it no longer scrolls with the page ⇒ re-measure on scroll/resize (capture
//     phase, so nested scrollers count) and close once the trigger scrolls out
//     of the viewport;
//   • it flips above the trigger when there is no room below, clamps to the
//     VISIBLE viewport, and caps its own height (scrolling internally) on short
//     screens.
//
// "Visible" is `window.visualViewport`, not `innerWidth`/`innerHeight`. The two
// differ exactly when it matters: a phone page with anything wider than the
// screen gets a LAYOUT viewport wider than the device (Chrome reported
// innerWidth 415 on a 390 px phone while the navbar overflowed), so a panel
// clamped to innerWidth ended 17 px past the glass with its last column cut
// off — and, pinch-zoomed, the layout viewport is not what the reader sees at
// all. `position: fixed` coordinates are layout-viewport coordinates, and the
// visual viewport's `offsetLeft/offsetTop` are expressed in exactly those, so
// the visible box is [offsetLeft, offsetLeft + width] × [offsetTop, offsetTop +
// height]. On desktop it also keeps a panel off the vertical scrollbar, which
// innerWidth counts and the visual viewport does not.
//
// Callers keep their own focus management — the ARIA pattern differs between a
// roving-focus menu and a single confirm popover.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Viewport pixels — the panel is `position: fixed`. */
export interface AnchoredPos {
  left: number;
  top: number;
  maxHeight: number;
  /** Flipped above the trigger because there was no room below it. */
  up: boolean;
}

const GAP_PX = 8;
const EDGE_PX = 8;
const MIN_PANEL_H = 160;

// The triggers are server-rendered on every zone route; React 18 warns that
// useLayoutEffect "does nothing on the server", so pick the hook per runtime.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The part of the layout viewport the reader can actually see, in `position: fixed` px. */
export interface VisibleBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The visible box: the visual viewport where the browser has one, else the
 * document's client box (which, unlike `innerWidth`, excludes the scrollbar).
 */
export function visibleViewport(): VisibleBox {
  const vv = window.visualViewport;
  if (vv) return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
  const root = document.documentElement;
  return { left: 0, top: 0, width: root.clientWidth || window.innerWidth, height: root.clientHeight || window.innerHeight };
}

/**
 * Where a panel of `width` × `height` goes next to `trigger`, kept inside
 * `viewport` (see the header for why that is the VISIBLE box). Returns null when
 * the trigger itself is out of sight — the caller closes the panel.
 *
 * Pure so the geometry is testable without a browser; `place()` feeds it live
 * measurements.
 */
export function anchoredPosition(args: {
  trigger: { left: number; right: number; top: number; bottom: number };
  width: number;
  height: number;
  align: 'left' | 'right';
  viewport: VisibleBox;
}): AnchoredPos | null {
  const { trigger: r, width: w, height: h, align, viewport: vp } = args;
  const vpRight = vp.left + vp.width;
  const vpBottom = vp.top + vp.height;
  if (r.bottom < vp.top || r.top > vpBottom) return null;
  const roomBelow = vpBottom - r.bottom - GAP_PX - EDGE_PX;
  const roomAbove = r.top - vp.top - GAP_PX - EDGE_PX;
  const up = h > roomBelow && roomAbove > roomBelow;
  const maxHeight = Math.max(MIN_PANEL_H, Math.floor(up ? roomAbove : roomBelow));
  const anchored = align === 'right' ? r.right - w : r.left;
  const minLeft = vp.left + EDGE_PX;
  // A panel wider than the visible box pins to its left edge (and overflows
  // right) rather than to the right edge — the start of a menu is what reads.
  const maxLeft = Math.max(minLeft, vpRight - EDGE_PX - w);
  const left = Math.round(Math.min(Math.max(anchored, minLeft), maxLeft));
  const top = Math.round(up ? Math.max(vp.top + EDGE_PX, r.top - GAP_PX - Math.min(h, maxHeight)) : r.bottom + GAP_PX);
  return { left, top, maxHeight, up };
}

export interface AnchoredPanelOptions {
  /** First-paint width estimate in px, refined once the real panel is measured. */
  width: number;
  /** First-paint height estimate in px (recompute it from the item count). */
  height: number;
  /** Which trigger edge the panel lines up with. Default 'right'. */
  align?: 'left' | 'right';
  /** Fires when the panel closes — reset any transient state (a confirm step). */
  onClose?: () => void;
}

export interface AnchoredPanel<T extends HTMLElement> {
  open: boolean;
  /** Measures first, so the panel never paints once at 0,0 and then jumps. */
  openPanel: () => void;
  close: (refocus?: boolean) => void;
  toggle: () => void;
  pos: AnchoredPos | null;
  triggerRef: React.MutableRefObject<T | null>;
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Portal target — null until mounted (SSR has no document). */
  host: Element | null;
  /** Re-measure by hand after the panel's own content changes size. */
  place: () => void;
}

export function useAnchoredPanel<T extends HTMLElement>(opts: AnchoredPanelOptions): AnchoredPanel<T> {
  const { width, height, align = 'right', onClose } = opts;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<AnchoredPos | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const triggerRef = useRef<T | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Kept in a ref so the close callback stays stable across renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Fullscreen first (a `fixed` child of <body> is invisible while another
  // element owns the fullscreen layer) — the same target DeptTag portals to.
  useEffect(() => setHost(document.fullscreenElement ?? document.body), []);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    onCloseRef.current?.();
    if (refocus) triggerRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const panel = panelRef.current;
    const next = anchoredPosition({
      trigger: btn.getBoundingClientRect(),
      width: panel?.offsetWidth || width,
      height: panel?.offsetHeight || height,
      align,
      viewport: visibleViewport(),
    });
    // Trigger scrolled out of sight — a menu floating over unrelated content is
    // worse than no menu.
    if (!next) {
      close();
      return;
    }
    setPos((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight && prev.up === next.up
        ? prev // identical ⇒ same object, so the measure→place loop settles after one pass
        : next,
    );
  }, [align, close, height, width]);

  const openPanel = useCallback(() => {
    place(); // measure before the first paint so it never lands at 0,0
    setOpen(true);
  }, [place]);

  const toggle = useCallback(() => {
    if (open) close();
    else openPanel();
  }, [close, open, openPanel]);

  // Measure the real panel once it is in the DOM (and again when it changes size).
  useIsomorphicLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // rAF-coalesced: every scroll frame would otherwise force a layout read.
    let frame = 0;
    const reposition = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    // Capture phase: the zone page itself does not scroll internally today, but
    // a nested scroller must not leave the panel stranded.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    // Pinch-zoom and the on-screen keyboard move the VISUAL viewport without a
    // window resize or scroll — and that is the box the panel is clamped to.
    const vv = window.visualViewport;
    vv?.addEventListener('resize', reposition);
    vv?.addEventListener('scroll', reposition);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      vv?.removeEventListener('resize', reposition);
      vv?.removeEventListener('scroll', reposition);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // The panel is NOT a descendant of the trigger any more — test both.
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return { open, openPanel, close, toggle, pos, triggerRef, panelRef, host, place };
}
