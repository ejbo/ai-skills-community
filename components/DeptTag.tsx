'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2 } from 'lucide-react';

/**
 * 部门 / 研究所 badge shown next to a user's name (posts, comments, profiles).
 * Renders nothing when both fields are empty — callers can always include it
 * unconditionally.
 *
 * Privacy contract: pass values that already went through `toPublicAuthor()`
 * (lib/user-identity.ts) — for a private account they arrive as null, so this
 * renders nothing. Do NOT hide client-side with raw values.
 *
 * Length contract: a full org path (`ICT BG · 计算产品线 · 昇腾计算业务部 …`) used to
 * dominate every author row, so the pill is capped at `DEPT_TAG_MAX_W` (~14 CJK
 * chars) and ellipsized; the full text appears in a tooltip on hover (touch: tap),
 * and only when something is actually hidden. The cap is a plain length, not a
 * percentage — `min(100%, …)` is a cyclic percentage inside the shrink-wrapped
 * flex items many author rows use, which sizes the row to the UNtruncated text and
 * leaves phantom space; `min-w-0` lets the flex algorithm shrink the pill instead
 * when a row is narrower than the cap. The tooltip is PORTALED (body, or the
 * fullscreen element) and `position: fixed` because author rows live inside
 * `overflow-hidden` cards and `card-hover` transforms that would clip or trap an
 * in-flow tooltip. Pass `full` on identity headers (profile page) where the whole
 * path is the point: no cap, no tooltip, the text wraps instead of ellipsizing.
 */

const DEPT_TAG_MAX_W = 'max-w-[12rem]';
const SHOW_DELAY_MS = 120;
const GAP_PX = 6;
const EDGE_PX = 8;

// The pill is server-rendered on ~30 routes; React 18 warns on every SSR pass
// that useLayoutEffect "does nothing on the server", so pick the hook per runtime.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface TipPos {
  /** Pill centre x / top / bottom, viewport px. */
  x: number;
  top: number;
  bottom: number;
  /** Flipped under the pill once the layout pass finds no room above it. */
  below: boolean;
}

export function DeptTag({
  department,
  lab,
  className = '',
  full = false,
}: {
  department?: string | null;
  lab?: string | null;
  className?: string;
  /** Show the whole text (no cap, no tooltip, wraps) — identity headers only. */
  full?: boolean;
}) {
  const text = [department, lab].filter(Boolean).join(' · ');
  const pillRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<TipPos | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const hide = useCallback(() => {
    clearTimer();
    setTip(null);
  }, []);
  const show = useCallback(() => {
    clearTimer();
    const pill = pillRef.current;
    const label = labelRef.current;
    if (!pill || !label) return;
    // Nothing hidden ⇒ nothing to reveal.
    if (label.scrollWidth <= label.clientWidth) return;
    const r = pill.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom, below: false });
  }, []);
  const scheduleShow = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(show, SHOW_DELAY_MS);
  }, [show]);

  useEffect(() => clearTimer, []);

  // Position after measuring. The bubble is `w-max` (width: max-content) so it is
  // sized by its text, not by the room left of `left` — a fixed box with auto
  // width shrink-fits into `viewport − left`, which turned a pill near the right
  // edge into a tall one-word-per-line column. Then clamp it inside the viewport
  // and flip it under the pill when it would poke out of the top.
  useIsomorphicLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const half = el.offsetWidth / 2;
    const left = Math.min(Math.max(tip.x, EDGE_PX + half), window.innerWidth - EDGE_PX - half);
    el.style.left = `${left}px`;
    if (!tip.below && tip.top - GAP_PX - el.offsetHeight < EDGE_PX) {
      setTip({ ...tip, below: true });
    }
  }, [tip]);

  useEffect(() => {
    if (!tip) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!pillRef.current?.contains(e.target as Node)) hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [tip, hide]);

  if (!text) return null;

  const host = typeof document === 'undefined' ? null : (document.fullscreenElement ?? document.body);

  return (
    <>
      <span
        ref={pillRef}
        className={`inline-flex min-w-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] leading-4 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 ${
          full ? 'max-w-full' : DEPT_TAG_MAX_W
        } ${className}`}
        onPointerEnter={(e) => {
          if (!full && e.pointerType !== 'touch') scheduleShow();
        }}
        onPointerLeave={(e) => {
          // A touch pointer is transient: the browser fires pointerleave right after
          // the tap's pointerup, which would close what the tap just opened. Touch
          // tooltips close on an outside tap or scroll instead.
          if (e.pointerType !== 'touch') hide();
        }}
        onPointerDown={(e) => {
          if (full) return;
          if (e.pointerType === 'touch') {
            if (tip) hide();
            else show();
          } else {
            hide();
          }
        }}
      >
        <Building2 className="h-3 w-3 shrink-0" />
        <span ref={labelRef} className={full ? 'min-w-0 break-words' : 'truncate'}>
          {text}
        </span>
      </span>
      {tip &&
        host &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            aria-hidden
            className={`pointer-events-none fixed z-[115] w-max max-w-[min(90vw,28rem)] -translate-x-1/2 whitespace-normal break-words rounded-md bg-zinc-900 px-2.5 py-1.5 text-left text-[11px] leading-4 text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900 ${
              tip.below ? '' : '-translate-y-full'
            }`}
            style={{ left: tip.x, top: tip.below ? tip.bottom + GAP_PX : tip.top - GAP_PX }}
          >
            {text}
          </span>,
          host,
        )}
    </>
  );
}
