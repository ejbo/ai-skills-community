// Shared motion primitives for the 技术专区 kit (`components/motion/*`).
//
// Deliberately NOT a 'use client' module: server components (GlareHover,
// HairlineGrid, RSC pages) import the constants below, and a 'use client'
// directive would turn every export into a client reference. The hooks in
// here are only ever called from client components, which is the boundary
// that matters.
//
// House motion budget (map/reactbits.md §3): EASE_OUT for every tween,
// springs stiffness 300–500 / damping ≥ 22 (no visible bounce), durations
// 0.2–0.6 s, hover ≤ 2px / scale ≤ 1.02 / light ≤ 8% alpha.

import { useEffect, useState } from 'react';

/** The house ease — the same curve as `Reveal` and the CSS `animate-rise`. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Tab indicators, hover pills: fast, critically damped. */
export const SPRING_SNAPPY = { type: 'spring', stiffness: 500, damping: 40 } as const;

/** Pointer-following values (tilt, magnet): soft but still overdamped. */
export const SPRING_SOFT = { stiffness: 220, damping: 26, mass: 0.6 } as const;

/** Panel slides (drawer): decisive, no overshoot past the edge. */
export const SPRING_DRAWER = { type: 'spring', stiffness: 380, damping: 40, mass: 0.8 } as const;

// ---------------------------------------------------------------------------
// Named tweens — the 技术专区 motion grammar (no component invents a duration).
//
// | Value          | Used for                                                    | Never for            |
// | SPRING_SNAPPY  | indicators following a selection/pointer (TabBar hairline,  | anything that moves  |
// |                | hover pill, listbox highlight, active-attachment hairline)  | content              |
// | SPRING_DRAWER  | sash snap-back, modal DrawerShell, rail overlay, Reorder    | text                 |
// | TWEEN_FAST     | crossfades, overlays, popovers, drop overlay                | lists                |
// | TWEEN          | bars hide/reveal, accordion rows, stack slide               | drags (transition 0) |
// | TWEEN_PANE     | dock open/close/expand width                                | drags                |
// Never animated: titles, prose, avatars, first-paint counts, route changes,
// dropdown item lists, typing/filtering, page-append rows.
// ---------------------------------------------------------------------------

export const TWEEN_FAST = { duration: 0.16, ease: EASE_OUT } as const;
export const TWEEN = { duration: 0.22, ease: EASE_OUT } as const;
export const TWEEN_PANE = { duration: 0.28, ease: EASE_OUT } as const;

/**
 * true only for mouse/trackpad users; false on the server and on touch.
 * Read in an effect (never at render) so SSR and the first client render agree.
 */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return fine;
}

/** Clamp `v` into `[-limit, limit]` (symmetric) — used by Magnetic. */
export function clamp(v: number, limit: number): number {
  const m = Math.abs(limit);
  return Math.max(-m, Math.min(m, v));
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/motion-shared.test.ts)
// ---------------------------------------------------------------------------

/** Matches one CJK ideograph / kana / hangul code point (each is its own "word"). */
const CJK_CHAR_RE = /(\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})/u;

/**
 * Split text into animation tokens. Whitespace runs are KEPT as tokens so the
 * caller can emit them as plain text and line wrapping stays native.
 * - `words`: split on whitespace; CJK runs are further split per character
 *   (there are no whitespace-delimited words in 中文, so a zone name would
 *   otherwise animate as one block).
 * - `chars`: every code point (code-point safe via `Array.from`).
 */
export function splitTextTokens(text: string, by: 'words' | 'chars'): string[] {
  if (by === 'chars') return Array.from(text);
  const out: string[] = [];
  for (const piece of text.split(/(\s+)/)) {
    if (!piece) continue;
    if (/^\s+$/.test(piece)) {
      out.push(piece);
      continue;
    }
    for (const part of piece.split(CJK_CHAR_RE)) {
      if (part) out.push(part);
    }
  }
  return out;
}

/** true for a token that is only whitespace (rendered as text, never animated). */
export function isWhitespaceToken(token: string): boolean {
  return /^\s+$/.test(token);
}

/**
 * Place values of a non-negative integer, most significant first:
 * 0 → [1], 42 → [10, 1], 1234 → [1000, 100, 10, 1].
 */
export function digitPlaces(value: number): number[] {
  const n = Number.isFinite(value) ? Math.abs(Math.trunc(value)) : 0;
  const digits = String(Math.min(n, Number.MAX_SAFE_INTEGER)).length;
  const places: number[] = [];
  for (let i = digits - 1; i >= 0; i -= 1) places.push(10 ** i);
  return places;
}

/**
 * Vertical offset (in digit heights) of glyph `digit` inside a rolling
 * column whose spring currently reads `latest` (the value already divided by
 * the column's place). 0 = the visible slot; positive = below; negative =
 * above. Nearest-direction wrap so 9 → 0 rolls one step, not nine.
 */
export function rollingDigitOffset(latest: number, digit: number): number {
  const current = ((latest % 10) + 10) % 10;
  const offset = (10 + digit - current) % 10;
  return offset > 5 ? offset - 10 : offset;
}
