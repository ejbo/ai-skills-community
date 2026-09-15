'use client';

// 名片 tilt engine — the React Bits <ProfileCard/> engine, unchanged in feel:
// exponential smoothing toward the pointer (tau 0.14 s; 0.6 s during the intro),
// an intro sweep from the top-right corner to the centre, and every value
// written straight to CSS custom properties on the wrapper. No React state per
// frame — a tilting card never re-renders.
//
// Differences from the reference, each on purpose:
//   - the rAF loop STOPS once settled. The reference keeps spinning while
//     `document.hasFocus()`, i.e. forever — with a hover card, a profile hero
//     and two editor previews that is four idle loops on one page.
//   - touch pointers are ignored and there is no deviceorientation path; the
//     caller only enables this for fine pointers without reduced motion.
//   - `suspendRef` freezes the target while the editor drags the media, so
//     the card does not rotate under the finger that is reframing it.
//   - `amplitude` scales the rotation (the reflective card tilts less); the
//     lighting vars always travel the full range.

import { useEffect, useRef } from 'react';

const INTRO_MS = 1200;
const INTRO_X_OFFSET = 70;
const INTRO_Y_OFFSET = 60;
const ENTER_TRANSITION_MS = 180;
const DEFAULT_TAU = 0.14;
const INTRO_TAU = 0.6;

const clamp = (v: number, min = 0, max = 100) => Math.min(Math.max(v, min), max);
const round = (v: number, precision = 3) => parseFloat(v.toFixed(precision));
const adjust = (v: number, fMin: number, fMax: number, tMin: number, tMax: number) =>
  round(tMin + ((tMax - tMin) * (v - fMin)) / (fMax - fMin));

/** The vars the engine writes inline. Their resting values live in profile-card.css on `.pc-root`. */
const TILT_VARS = [
  '--pointer-x',
  '--pointer-y',
  '--background-x',
  '--background-y',
  '--pointer-from-center',
  '--pointer-from-top',
  '--pointer-from-left',
  '--rotate-x',
  '--rotate-y',
] as const;

export interface CardTiltOptions {
  enabled: boolean;
  /** Rotation multiplier (1 = the reference's ±10° / ±12.5°). */
  amplitude?: number;
}

export function useCardTilt<W extends HTMLElement = HTMLDivElement, S extends HTMLElement = HTMLDivElement>({
  enabled,
  amplitude = 1,
}: CardTiltOptions) {
  const wrapRef = useRef<W>(null);
  const shellRef = useRef<S>(null);
  const suspendRef = useRef(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const shell = shellRef.current;
    if (!enabled || !wrap || !shell) return;

    let rafId: number | null = null;
    let running = false;
    let lastTs = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let introUntil = 0;
    let enterTimer: number | null = null;
    let settleRaf: number | null = null;

    const setVars = (x: number, y: number) => {
      const width = shell.clientWidth || 1;
      const height = shell.clientHeight || 1;
      const px = clamp((100 / width) * x);
      const py = clamp((100 / height) * y);
      const cx = px - 50;
      const cy = py - 50;
      const s = wrap.style;
      s.setProperty('--pointer-x', `${px}%`);
      s.setProperty('--pointer-y', `${py}%`);
      s.setProperty('--background-x', `${adjust(px, 0, 100, 35, 65)}%`);
      s.setProperty('--background-y', `${adjust(py, 0, 100, 35, 65)}%`);
      s.setProperty('--pointer-from-center', `${clamp(Math.hypot(cy, cx) / 50, 0, 1)}`);
      s.setProperty('--pointer-from-top', `${py / 100}`);
      s.setProperty('--pointer-from-left', `${px / 100}`);
      s.setProperty('--rotate-x', `${round((-cx / 5) * amplitude)}deg`);
      s.setProperty('--rotate-y', `${round((cy / 4) * amplitude)}deg`);
    };

    const step = (ts: number) => {
      if (!running) return;
      if (lastTs === 0) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      const k = 1 - Math.exp(-dt / (ts < introUntil ? INTRO_TAU : DEFAULT_TAU));
      currentX += (targetX - currentX) * k;
      currentY += (targetY - currentY) * k;
      setVars(currentX, currentY);
      const far = Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05;
      if (far || ts < introUntil) {
        rafId = requestAnimationFrame(step);
      } else {
        running = false;
        lastTs = 0;
        rafId = null;
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    };

    const setTarget = (x: number, y: number) => {
      targetX = x;
      targetY = y;
      start();
    };

    const toCenter = () => setTarget(shell.clientWidth / 2, shell.clientHeight / 2);

    const offsets = (e: PointerEvent) => {
      const r = shell.getBoundingClientRect();
      // getBoundingClientRect is the TILTED box; the engine works in the flat
      // box's coordinates, so rescale by client size (identical at rest).
      const sx = r.width ? shell.clientWidth / r.width : 1;
      const sy = r.height ? shell.clientHeight / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };

    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (settleRaf) cancelAnimationFrame(settleRaf);
      settleRaf = null;
      wrap.classList.add('is-active', 'is-entering');
      if (enterTimer) window.clearTimeout(enterTimer);
      enterTimer = window.setTimeout(() => wrap.classList.remove('is-entering'), ENTER_TRANSITION_MS);
      if (suspendRef.current) return;
      const { x, y } = offsets(e);
      setTarget(x, y);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || suspendRef.current) return;
      const { x, y } = offsets(e);
      setTarget(x, y);
    };

    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      toCenter();
      const settle = () => {
        if (Math.hypot(targetX - currentX, targetY - currentY) < 0.6) {
          wrap.classList.remove('is-active');
          settleRaf = null;
        } else {
          settleRaf = requestAnimationFrame(settle);
        }
      };
      if (settleRaf) cancelAnimationFrame(settleRaf);
      settleRaf = requestAnimationFrame(settle);
    };

    shell.addEventListener('pointerenter', onEnter);
    shell.addEventListener('pointermove', onMove);
    shell.addEventListener('pointerleave', onLeave);

    // Intro sweep: the light starts near the top-right corner and drifts to the
    // centre — it only moves the lighting vars (rotation needs `.is-active`).
    currentX = (shell.clientWidth || 0) - INTRO_X_OFFSET;
    currentY = INTRO_Y_OFFSET;
    setVars(currentX, currentY);
    introUntil = performance.now() + INTRO_MS;
    toCenter();

    return () => {
      shell.removeEventListener('pointerenter', onEnter);
      shell.removeEventListener('pointermove', onMove);
      shell.removeEventListener('pointerleave', onLeave);
      if (rafId) cancelAnimationFrame(rafId);
      if (settleRaf) cancelAnimationFrame(settleRaf);
      if (enterTimer) window.clearTimeout(enterTimer);
      running = false;
      wrap.classList.remove('is-active', 'is-entering');
      for (const k of TILT_VARS) wrap.style.removeProperty(k);
    };
  }, [enabled, amplitude]);

  return { wrapRef, shellRef, suspendRef };
}
