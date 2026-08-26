'use client';

// 技术专区 — shared anchoring for header dropdowns (ask #1).
//
// The zone header <section> is `relative overflow-hidden` (cover image +
// HairlineGrid), so an absolutely positioned menu inside it is CLIPPED by that
// ancestor at ANY z-index — and neighbouring `card-hover` transforms create
// containing blocks that also trap `position: fixed`. The fix both header
// dropdowns (管理 and 已加入) use is the same one `DeptTag` uses: PORTAL the
// panel to <body> and position it from the trigger's getClientRect.
//
// This hook owns everything portaling costs us, so the two menus can never
// drift apart:
//   • the panel is no longer a DOM descendant of the trigger ⇒ outside-click
//     tests BOTH nodes;
//   • it no longer scrolls with the page ⇒ re-measure on scroll/resize (capture
//     phase, so nested scrollers count) and close once the trigger scrolls out
//     of the viewport;
//   • it flips above the trigger when there is no room below, clamps to the
//     viewport, and caps its own height (scrolling internally) on short screens.
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
    const r = btn.getBoundingClientRect();
    // Trigger scrolled out of sight — a menu floating over unrelated content is
    // worse than no menu.
    if (r.bottom < 0 || r.top > window.innerHeight) {
      close();
      return;
    }
    const panel = panelRef.current;
    const w = panel?.offsetWidth || width;
    const h = panel?.offsetHeight || height;
    const roomBelow = window.innerHeight - r.bottom - GAP_PX - EDGE_PX;
    const roomAbove = r.top - GAP_PX - EDGE_PX;
    const up = h > roomBelow && roomAbove > roomBelow;
    const maxHeight = Math.max(MIN_PANEL_H, Math.floor(up ? roomAbove : roomBelow));
    const anchored = align === 'right' ? r.right - w : r.left;
    const left = Math.round(
      Math.min(Math.max(anchored, EDGE_PX), Math.max(EDGE_PX, window.innerWidth - EDGE_PX - w)),
    );
    const top = Math.round(up ? Math.max(EDGE_PX, r.top - GAP_PX - Math.min(h, maxHeight)) : r.bottom + GAP_PX);
    setPos((prev) =>
      prev && prev.left === left && prev.top === top && prev.maxHeight === maxHeight && prev.up === up
        ? prev // identical ⇒ same object, so the measure→place loop settles after one pass
        : { left, top, maxHeight, up },
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
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
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
