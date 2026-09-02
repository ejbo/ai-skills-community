'use client';

// Sash mechanics for the docked reading panel (ref-tech §1.3, adopted):
//   - pointer capture on the handle (all later pointer events route to it even
//     over the page or the PDF iframe), `touch-action: none`, `select-none` +
//     `cursor-col-resize` on <body> for the duration of the drag;
//   - ZERO React state per move: the live width is written straight to the
//     aside — through the bound MotionValue when the host provides one (so
//     framer's own latest value never drifts from the DOM and a later width
//     tween starts from where the sash left it), else `style.width` inside one
//     rAF per frame — and committed (state + onCommit + localStorage) once, on
//     release;
//   - past a bound the width rubber-bands (tanh, ≤ 42 px) and springs back on
//     release with SPRING_DRAWER; reduced motion ⇒ no overshoot, instant;
//   - keyboard on the separator (APG window splitter): ←/→ ± DOCK_STEP (Shift
//     ×4), Home = max, End = min, Enter = default; double-click = default;
//   - a window resize re-clamps the committed width (a persisted 760 must not
//     swallow a 1280 laptop);
//   - a drag ENDS on more than pointerup / pointercancel: Escape (capture-phase,
//     consumed — the provider's two-stage ESC must not also close the dock)
//     cancels back to the start width, a window blur (alt-tab) commits where
//     the pointer was, and the hook's unmount cleanup ends it too. Without the
//     last one a dock closed mid-drag (route change, ✕ under the shield) left
//     <body> with `select-none cursor-col-resize` forever — `lostpointercapture`
//     for a removed handle fires at the document, never at the handle.
// Pure geometry lives in split-shared.ts; this module is the only one that
// reads `window`.

import { animate, type MotionValue } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { SPRING_DRAWER } from '@/lib/motion';
import {
  DOCK_DEFAULT,
  DOCK_HARD_MAX,
  DOCK_MIN,
  DOCK_STEP,
  DOCK_STORAGE_KEY,
  clampDockWidth,
  dockMaxFor,
  rubberBand,
} from './split-shared';

export interface SeparatorProps {
  role: 'separator';
  'aria-orientation': 'vertical';
  'aria-valuemin': number;
  'aria-valuemax': number;
  'aria-valuenow': number;
  tabIndex: 0;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  style: CSSProperties;
}

export interface SplitResizeOptions {
  /** `useReducedMotion()` from the host — config only (no overshoot, no spring). */
  reduce: boolean;
  /** Called once per committed width (release / keyboard / reset / re-clamp). */
  onCommit: (w: number) => void;
  /** The committed width the host renders at rest; changes (storage hydration) are mirrored. */
  initial: number;
  /**
   * The aside's bound width MotionValue (`style={{ width: value }}`). When
   * given, live writes and the snap-back go through it instead of `style.width`.
   */
  value?: MotionValue<number>;
}

export interface SplitResize {
  /** Committed width (aria-valuenow). */
  width: number;
  dragging: boolean;
  separatorProps: SeparatorProps;
  /** Back to DOCK_DEFAULT (double-click / Enter). */
  reset: () => void;
  /** Programmatic commit (clamped). */
  setWidth: (w: number) => void;
}

const BODY_DRAG_CLASSES = ['select-none', 'cursor-col-resize'];

function persist(w: number) {
  try {
    localStorage.setItem(DOCK_STORAGE_KEY, String(w));
  } catch {
    /* private mode / quota — the width just does not survive the reload */
  }
}

export function useSplitResize(asideRef: RefObject<HTMLElement>, { reduce, onCommit, initial, value }: SplitResizeOptions): SplitResize {
  const [width, setWidthState] = useState(initial);
  const [dragging, setDragging] = useState(false);
  // aria-valuemax needs window; DOCK_HARD_MAX until the mount effect measures.
  const [max, setMax] = useState(DOCK_HARD_MAX);
  const widthRef = useRef(initial);
  const rafRef = useRef(0);
  const onCommitRef = useRef(onCommit);
  const reduceRef = useRef(reduce);
  // The active drag's terminator (null between drags) — reachable from the
  // unmount cleanup so the body classes / capture / shield never outlive the sash.
  const endDragRef = useRef<((cancel: boolean) => void) | null>(null);
  useEffect(() => {
    onCommitRef.current = onCommit;
    reduceRef.current = reduce;
  });
  useEffect(() => () => endDragRef.current?.(true), []);

  // The host owns the resting width (it hydrates from storage after mount);
  // mirror it so keyboard steps start from the real value.
  useEffect(() => {
    if (initial === widthRef.current) return;
    widthRef.current = initial;
    setWidthState(initial);
  }, [initial]);

  const paint = useCallback(
    (w: number) => {
      if (value) {
        value.set(w);
        return;
      }
      const el = asideRef.current;
      if (el) el.style.width = `${w}px`;
    },
    [asideRef, value],
  );

  const commit = useCallback(
    (w: number) => {
      widthRef.current = w;
      setWidthState(w);
      onCommitRef.current(w);
      persist(w);
    },
    [],
  );

  useEffect(() => {
    const sync = () => {
      const vw = window.innerWidth;
      setMax(dockMaxFor(vw));
      const clamped = clampDockWidth(widthRef.current, vw);
      if (clamped !== widthRef.current) commit(clamped);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [commit]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const handle = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* capture is best-effort; the shield still catches the pointer */
      }
      // A grab mid-tween must win over the running width animation.
      value?.stop();
      const startX = e.clientX;
      const startW = widthRef.current;
      const vw = window.innerWidth;
      const maxW = dockMaxFor(vw);
      let live = startW;
      let overshoot = 0;
      let done = false;

      document.body.classList.add(...BODY_DRAG_CLASSES);
      setDragging(true);

      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const raw = startW + (startX - ev.clientX); // right-docked: dragging left widens
        overshoot = raw < DOCK_MIN ? raw - DOCK_MIN : raw > maxW ? raw - maxW : 0;
        live = clampDockWidth(raw, vw) + rubberBand(overshoot, reduceRef.current);
        if (value) {
          // framer batches the DOM write into its own frame — one per frame.
          value.set(live);
        } else {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => paint(live));
        }
      };
      const end = (cancel: boolean) => {
        if (done) return;
        done = true;
        endDragRef.current = null;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        handle.removeEventListener('lostpointercapture', onUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('keydown', onKey, { capture: true });
        cancelAnimationFrame(rafRef.current);
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
        document.body.classList.remove(...BODY_DRAG_CLASSES);
        setDragging(false);

        if (cancel) {
          // Escape / unmount: back to where the drag started, nothing committed.
          paint(startW);
          return;
        }

        const final = clampDockWidth(live, window.innerWidth);
        if (overshoot !== 0 && !reduceRef.current && live !== final) {
          // Rubber band → spring back to the bound, then commit.
          const controls = value
            ? animate(value, final, SPRING_DRAWER)
            : asideRef.current
              ? animate(asideRef.current, { width: final }, SPRING_DRAWER)
              : null;
          if (controls) {
            void controls.then(() => commit(final));
            return;
          }
        }
        paint(final);
        commit(final);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        end(false);
      };
      // The pointer is gone with the window focus: keep what was dragged.
      const onBlur = () => end(false);
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        end(true);
      };
      endDragRef.current = end;
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
      handle.addEventListener('lostpointercapture', onUp);
      window.addEventListener('blur', onBlur);
      window.addEventListener('keydown', onKey, { capture: true });
    },
    [asideRef, commit, paint, value],
  );

  // Keyboard commits without a manual paint: the host's width tween carries the
  // aside to the new value (instant under reduced motion).
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? DOCK_STEP * 4 : DOCK_STEP;
      let next: number | null = null;
      switch (e.key) {
        case 'ArrowLeft':
          next = widthRef.current + step;
          break;
        case 'ArrowRight':
          next = widthRef.current - step;
          break;
        case 'Home':
          next = dockMaxFor(window.innerWidth);
          break;
        case 'End':
          next = DOCK_MIN;
          break;
        case 'Enter':
          next = DOCK_DEFAULT;
          break;
        default:
          return;
      }
      e.preventDefault();
      const clamped = clampDockWidth(next, window.innerWidth);
      if (clamped !== widthRef.current) commit(clamped);
    },
    [commit],
  );

  const reset = useCallback(() => {
    const clamped = clampDockWidth(DOCK_DEFAULT, window.innerWidth);
    if (clamped !== widthRef.current) commit(clamped);
  }, [commit]);

  const setWidth = useCallback(
    (w: number) => {
      const clamped = clampDockWidth(w, window.innerWidth);
      if (clamped !== widthRef.current) commit(clamped);
    },
    [commit],
  );

  const separatorProps: SeparatorProps = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuemin': DOCK_MIN,
    'aria-valuemax': max,
    'aria-valuenow': width,
    tabIndex: 0,
    onPointerDown,
    onKeyDown,
    onDoubleClick: reset,
    style: { touchAction: 'none' },
  };

  return { width, dragging, separatorProps, reset, setWidth };
}
