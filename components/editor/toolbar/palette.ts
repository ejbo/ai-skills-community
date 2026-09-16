// The 文字颜色 / 背景色 palette — the DATA half of ColorPicker.tsx. React-free
// and next-intl-free (names are message KEYS + params the component resolves),
// so tests/editor-toolbar-v3.test.ts pins the grid without mounting anything.
//
// Layout follows Word / Google Docs, which is what the owner asked the toolbar
// to feel like:
//   • 主题颜色 — a 10 × 6 grid: one BASE row of ten hues, then five rows of the
//     same hues lightened 80 / 60 / 40 % and darkened 25 / 50 % (Word's theme
//     grid). The two neutral columns (白 / 黑) walk towards grey instead, so
//     black, white and five greys are all one click away.
//   • 标准色 — Word's ten "Standard Colors", verbatim.
//   • 最近使用 — the last ten colours this browser applied, per kind.
//
// Everything is computed ONCE at module load (the grid is 70 swatches; the
// toolbar re-renders on every transaction and must never rebuild it).
//
// Stored values are always lowercase `#rrggbb` (lib/rich-marks.ts#isHexColor):
// the grid is written in that form, and custom input goes through
// normalizeHexColor before it reaches a command.

import { RICH_TEXT_COLORS, isHexColor, normalizeHexColor } from '@/lib/rich-marks';

export type ColorKind = 'color' | 'bg';

/** One swatch: its stored value and how to name it for a screen reader. */
export interface Swatch {
  hex: `#${string}`;
  /** `ui` message key of the colour's name (`rte_color_red`). */
  nameKey: string;
  /** A tint / shade of a base hue — named "红色，浅色 80%". */
  shade?: { dir: 'lighter' | 'darker'; percent: number };
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hexOf = (r: number, g: number, b: number): `#${string}` =>
  `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}` as `#${string}`;
const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Mix towards white by `t` (0–1) — Word's "Lighter t%". */
export function lighten(hex: string, t: number): `#${string}` {
  const [r, g, b] = rgbOf(hex);
  return hexOf(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

/** Mix towards black by `t` (0–1) — Word's "Darker t%". */
export function darken(hex: string, t: number): `#${string}` {
  const [r, g, b] = rgbOf(hex);
  return hexOf(r * (1 - t), g * (1 - t), b * (1 - t));
}

/** The ten theme hues (Material 600 for the eight colours: saturated, never neon). */
const THEME_BASE: ReadonlyArray<{ hex: `#${string}`; nameKey: string }> = [
  { hex: '#ffffff', nameKey: 'rte_color_white' },
  { hex: '#000000', nameKey: 'rte_color_black' },
  { hex: '#e53935', nameKey: 'rte_color_red' },
  { hex: '#fb8c00', nameKey: 'rte_color_orange' },
  { hex: '#fdd835', nameKey: 'rte_color_yellow' },
  { hex: '#43a047', nameKey: 'rte_color_green' },
  { hex: '#00acc1', nameKey: 'rte_color_teal' },
  { hex: '#1e88e5', nameKey: 'rte_color_blue' },
  { hex: '#8e24aa', nameKey: 'rte_color_purple' },
  { hex: '#d81b60', nameKey: 'rte_color_pink' },
];

/** Rows 1–5 below the base row: Word's order (three tints, then two shades). */
const COLOUR_SHADES: ReadonlyArray<{ dir: 'lighter' | 'darker'; percent: number }> = [
  { dir: 'lighter', percent: 80 },
  { dir: 'lighter', percent: 60 },
  { dir: 'lighter', percent: 40 },
  { dir: 'darker', percent: 25 },
  { dir: 'darker', percent: 50 },
];
/** White can only get darker, black only lighter — Word's neutral columns. */
const WHITE_SHADES = [5, 15, 25, 35, 50].map((percent) => ({ dir: 'darker' as const, percent }));
const BLACK_SHADES = [50, 35, 25, 15, 5].map((percent) => ({ dir: 'lighter' as const, percent }));

export const PALETTE_COLUMNS = 10;

/** 主题颜色: 6 rows × 10 columns, row 0 = the base hues. */
export const THEME_GRID: readonly (readonly Swatch[])[] = (() => {
  const rows: Swatch[][] = [THEME_BASE.map((b) => ({ hex: b.hex, nameKey: b.nameKey }))];
  for (let r = 0; r < COLOUR_SHADES.length; r += 1) {
    rows.push(
      THEME_BASE.map((b, col) => {
        const shade = col === 0 ? WHITE_SHADES[r] : col === 1 ? BLACK_SHADES[r] : COLOUR_SHADES[r];
        const t = shade.percent / 100;
        return { hex: shade.dir === 'lighter' ? lighten(b.hex, t) : darken(b.hex, t), nameKey: b.nameKey, shade };
      }),
    );
  }
  return rows;
})();

/** 标准色: Word's Standard Colors row. */
export const STANDARD_COLORS: readonly Swatch[] = [
  { hex: '#c00000', nameKey: 'rte_color_dark_red' },
  { hex: '#ff0000', nameKey: 'rte_color_red' },
  { hex: '#ffc000', nameKey: 'rte_color_orange' },
  { hex: '#ffff00', nameKey: 'rte_color_yellow' },
  { hex: '#92d050', nameKey: 'rte_color_light_green' },
  { hex: '#00b050', nameKey: 'rte_color_green' },
  { hex: '#00b0f0', nameKey: 'rte_color_light_blue' },
  { hex: '#0070c0', nameKey: 'rte_color_blue' },
  { hex: '#002060', nameKey: 'rte_color_dark_blue' },
  { hex: '#7030a0', nameKey: 'rte_color_purple' },
];

/** What the split button applies before the author has picked anything (Word: red text, yellow highlight). */
export const DEFAULT_LAST_COLOR: Readonly<Record<ColorKind, `#${string}`>> = { color: '#ff0000', bg: '#ffff00' };

/**
 * A legacy named value (stored bodies from v2 keep `data-color="red"`) → the
 * palette swatch that stands for it, so selecting old red text marks the red
 * swatch as current. The name is still a curated per-theme token, not this hex
 * — picking the swatch again stores the hex.
 */
export const LEGACY_COLOR_SWATCH: Readonly<Record<(typeof RICH_TEXT_COLORS)[number], `#${string}`>> = {
  gray: THEME_GRID[1][1].hex, // black, lighter 50 %
  red: THEME_BASE[2].hex,
  orange: THEME_BASE[3].hex,
  yellow: THEME_BASE[4].hex,
  green: THEME_BASE[5].hex,
  teal: THEME_BASE[6].hex,
  blue: THEME_BASE[7].hex,
  purple: THEME_BASE[8].hex,
  pink: THEME_BASE[9].hex,
};

/** The swatch value to mark active for a stored mark value (hex as-is, a legacy name through the map, else null). */
export function swatchValueFor(stored: string | null | undefined): `#${string}` | null {
  if (!stored) return null;
  if (isHexColor(stored)) return stored;
  return (LEGACY_COLOR_SWATCH as Record<string, `#${string}`>)[stored] ?? null;
}

/** Relative luminance (WCAG) of a stored hex — decides a check mark's ink on the swatch. */
export function luminanceOf(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Ink for a mark drawn ON the swatch: dark on light colours, white on dark ones. */
export function inkOn(hex: string): '#000000' | '#ffffff' {
  return luminanceOf(hex) > 0.4 ? '#000000' : '#ffffff';
}

// ─── per-browser memory (最近使用 + the split button's last colour) ──────────
// localStorage can be missing (SSR), blocked (a private window, site data off)
// or full; every access is guarded and a failure just means "no memory".

export const RECENT_COLORS_MAX = 10;
const recentKey = (kind: ColorKind) => `rte:recent-colors:${kind}`;
const lastKey = (kind: ColorKind) => `rte:last-color:${kind}`;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Parses a stored recent list: valid hex only, deduped, capped. Anything else → []. */
export function parseRecentColors(raw: string | null): `#${string}`[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const out: `#${string}`[] = [];
    for (const v of list) {
      if (isHexColor(v) && !out.includes(v)) out.push(v);
      if (out.length >= RECENT_COLORS_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** `hex` moved to the front of `list`, deduped, capped at RECENT_COLORS_MAX. */
export function withRecentColor(list: readonly `#${string}`[], hex: `#${string}`): `#${string}`[] {
  return [hex, ...list.filter((v) => v !== hex)].slice(0, RECENT_COLORS_MAX);
}

export function readRecentColors(kind: ColorKind): `#${string}`[] {
  try {
    return parseRecentColors(storage()?.getItem(recentKey(kind)) ?? null);
  } catch {
    return [];
  }
}

/** Records an applied colour (front of the list) and remembers it as the split button's colour. Returns the new list. */
export function rememberColor(kind: ColorKind, value: string): `#${string}`[] {
  const hex = normalizeHexColor(value);
  if (!hex) return readRecentColors(kind);
  const next = withRecentColor(readRecentColors(kind), hex);
  try {
    const s = storage();
    s?.setItem(recentKey(kind), JSON.stringify(next));
    s?.setItem(lastKey(kind), hex);
  } catch {
    /* quota / blocked: the pick still applied */
  }
  return next;
}

export function readLastColor(kind: ColorKind): `#${string}` {
  try {
    const v = storage()?.getItem(lastKey(kind));
    return isHexColor(v) ? v : DEFAULT_LAST_COLOR[kind];
  } catch {
    return DEFAULT_LAST_COLOR[kind];
  }
}
