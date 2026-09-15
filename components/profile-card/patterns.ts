// 名片材质 — the inline textures a card paints. Plain module (no 'use client'),
// no stored string ever reaches CSS: every value below is a compile-time
// constant, and the only per-member input (CardConfig.pattern) is a closed enum.
//
// Masks are WHITE shapes on TRANSPARENT, so they cut the holo shine the same
// whether the browser applies them as a luminance mask (the React Bits
// reference, `mask-mode: luminance`) or as an alpha mask (the default for
// `mask-image`, and the only mode `-webkit-mask-image` knows). A black-on-white
// tile would invert between the two.

import type { CardPattern } from '@/lib/profile/shared';

const svg = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`,
  )}")`;

export interface CardPatternMask {
  /** CSS `url(...)` of one tile. */
  url: string;
  /** Tile edge in design units (1u = 1px on the 320px card), scaled with the card; 0 = cover. */
  size: number;
}

/**
 * grid  — hairline lattice with a brighter node at every crossing (a foil
 *         trading card's etched grid)
 * dots  — halftone screen
 * waves — guilloché-like sine strokes (banknote security print)
 * none  — no pattern: the shine covers the whole face, a full holo foil
 *
 * Strokes are deliberately translucent: the reference cuts its shine through a
 * sparse, mid-grey icon image; a dense opaque lattice turns into a white wire
 * mesh over the name the moment the card lights up.
 */
export const CARD_PATTERN_MASKS: Record<CardPattern, CardPatternMask> = {
  grid: {
    url: svg(
      36,
      36,
      "<path d='M0 .5H36M.5 0V36' stroke='white' stroke-opacity='.2' stroke-width='1' fill='none'/><circle cx='.5' cy='.5' r='1.5' fill='white' fill-opacity='.85'/>",
    ),
    size: 36,
  },
  dots: {
    url: svg(14, 14, "<circle cx='7' cy='7' r='1.7' fill='white' fill-opacity='.55'/>"),
    size: 14,
  },
  waves: {
    url: svg(
      56,
      20,
      "<path d='M0 10C9.33 3.5 18.67 3.5 28 10S46.67 16.5 56 10' stroke='white' stroke-opacity='.3' stroke-width='1.2' fill='none'/>",
    ),
    size: 56,
  },
  // A solid layer, not `none`: the shine's mask intersects this with a
  // pointer-centred falloff, and a `none` layer would intersect to nothing.
  none: { url: 'linear-gradient(#000, #000)', size: 0 },
};

/**
 * Film grain for the shine's `::before` layer (React Bits `--grain`) and the
 * reflective noise. feTurbulence is rasterised once into a small tile the
 * browser repeats — the same trick as the homepage HeroBackdrop, with no
 * binary asset to ship.
 */
export const CARD_GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";
