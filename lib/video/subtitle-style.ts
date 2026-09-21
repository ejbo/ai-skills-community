// 字幕样式 — the viewer's OWN subtitle preferences (size, position, background,
// colour …). Pure and import-free: the player, the settings panel and the unit
// tests share it.
//
// These are per-BROWSER preferences, not content: they live in localStorage
// (`video:subtitle-style`), never on the server, and one viewer's choice can
// never reach another viewer. Everything that comes back out of storage goes
// through parseSubtitleStyle — a closed value set per field and a numeric clamp
// per range — so a hand-edited or stale entry degrades to the defaults instead
// of reaching a style attribute.
//
// Geometry is expressed relative to the PLAYER FRAME, so the same stored value
// works inline, in fullscreen and on a phone:
//   scale  multiplies a font size the player derives from the frame's width
//   x      horizontal centre of the cue block, % of frame width
//   y      distance of the cue block's BOTTOM edge from the frame's bottom, % of
//          frame height (small = near the bottom, where subtitles usually sit)

export const SUBTITLE_MODES = ['off', 'zh', 'en', 'both'] as const;
/** Which track(s) to show. `both` = 双语: the viewer's language on top, the other below. */
export type SubtitleMode = (typeof SUBTITLE_MODES)[number];

export const SUBTITLE_COLORS = ['white', 'yellow', 'cyan', 'green'] as const;
export type SubtitleColor = (typeof SUBTITLE_COLORS)[number];

/** The classic subtitle palette. These are MATERIAL (the viewer's text), not chrome — colour is allowed here. */
export const SUBTITLE_COLOR_HEX: Record<SubtitleColor, string> = {
  white: '#ffffff',
  yellow: '#ffe14d',
  cyan: '#7ee8fa',
  green: '#9af58a',
};

export interface SubtitleStyle {
  /** Font scale, 0.6 – 2.0. */
  scale: number;
  /** Horizontal centre, % of the frame (10 – 90). */
  x: number;
  /** Bottom edge above the frame's bottom, % of the frame (2 – 88). */
  y: number;
  /** Background box opacity, 0 (none) – 1. */
  bgOpacity: number;
  color: SubtitleColor;
  /** Dark outline + shadow around the glyphs — what keeps text legible with no background. */
  outline: boolean;
  bold: boolean;
}

export const SUBTITLE_SCALE_MIN = 0.6;
export const SUBTITLE_SCALE_MAX = 2;
export const SUBTITLE_SCALE_STEP = 0.1;
export const SUBTITLE_X_MIN = 10;
export const SUBTITLE_X_MAX = 90;
export const SUBTITLE_Y_MIN = 2;
export const SUBTITLE_Y_MAX = 88;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  scale: 1,
  x: 50,
  y: 7,
  bgOpacity: 0.6,
  color: 'white',
  outline: true,
  bold: false,
};

export const SUBTITLE_STYLE_STORAGE_KEY = 'video:subtitle-style';
export const SUBTITLE_MODE_STORAGE_KEY = 'video:subtitle';

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

const round = (n: number, step: number) => Math.round(n / step) * step;

/** Any value (parsed JSON, a partial patch, junk) → a complete, in-range style. Never throws. */
export function parseSubtitleStyle(raw: unknown): SubtitleStyle {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SUBTITLE_STYLE;
  return {
    scale: Number(round(clampNumber(o.scale, SUBTITLE_SCALE_MIN, SUBTITLE_SCALE_MAX, d.scale), 0.05).toFixed(2)),
    x: Number(clampNumber(o.x, SUBTITLE_X_MIN, SUBTITLE_X_MAX, d.x).toFixed(1)),
    y: Number(clampNumber(o.y, SUBTITLE_Y_MIN, SUBTITLE_Y_MAX, d.y).toFixed(1)),
    bgOpacity: Number(round(clampNumber(o.bgOpacity, 0, 1, d.bgOpacity), 0.05).toFixed(2)),
    color: (SUBTITLE_COLORS as readonly unknown[]).includes(o.color) ? (o.color as SubtitleColor) : d.color,
    outline: typeof o.outline === 'boolean' ? o.outline : d.outline,
    bold: typeof o.bold === 'boolean' ? o.bold : d.bold,
  };
}

export function parseSubtitleStyleJson(text: string | null | undefined): SubtitleStyle {
  if (!text) return DEFAULT_SUBTITLE_STYLE;
  try {
    return parseSubtitleStyle(JSON.parse(text));
  } catch {
    return DEFAULT_SUBTITLE_STYLE;
  }
}

export function isDefaultSubtitleStyle(s: SubtitleStyle): boolean {
  const d = DEFAULT_SUBTITLE_STYLE;
  return (
    s.scale === d.scale &&
    s.x === d.x &&
    s.y === d.y &&
    s.bgOpacity === d.bgOpacity &&
    s.color === d.color &&
    s.outline === d.outline &&
    s.bold === d.bold
  );
}

/** Quick vertical presets for the panel; the free position comes from dragging the cue itself. */
export const SUBTITLE_POSITION_PRESETS = {
  bottom: { x: 50, y: DEFAULT_SUBTITLE_STYLE.y },
  middle: { x: 50, y: 44 },
  top: { x: 50, y: 84 },
} as const;
export type SubtitlePositionPreset = keyof typeof SUBTITLE_POSITION_PRESETS;

/** Which preset (if any) a style currently sits on — drives the pressed state of the three buttons. */
export function matchingPositionPreset(s: Pick<SubtitleStyle, 'x' | 'y'>): SubtitlePositionPreset | null {
  for (const key of Object.keys(SUBTITLE_POSITION_PRESETS) as SubtitlePositionPreset[]) {
    const p = SUBTITLE_POSITION_PRESETS[key];
    if (Math.abs(s.x - p.x) < 0.75 && Math.abs(s.y - p.y) < 0.75) return key;
  }
  return null;
}

/**
 * Base font size (px, before `scale`) for a frame this wide. Linear in the
 * frame's width so fullscreen text grows with the picture, clamped so a phone
 * stays readable and a 4K wall does not shout.
 */
export function subtitleBaseFontPx(frameWidth: number): number {
  if (!(frameWidth > 0)) return 18;
  return Math.min(46, Math.max(13, frameWidth * 0.0245));
}

/** The mode a viewer ends up with, given what they asked for and which tracks this video actually has. */
export function resolveSubtitleMode(wanted: SubtitleMode, has: { zh: boolean; en: boolean }): SubtitleMode {
  if (!has.zh && !has.en) return 'off';
  if (wanted === 'off') return 'off';
  if (wanted === 'both') return has.zh && has.en ? 'both' : has.zh ? 'zh' : 'en';
  if (wanted === 'zh') return has.zh ? 'zh' : 'en';
  return has.en ? 'en' : 'zh';
}

export function parseSubtitleMode(raw: unknown): SubtitleMode | null {
  return (SUBTITLE_MODES as readonly unknown[]).includes(raw) ? (raw as SubtitleMode) : null;
}

/** First-visit default: subtitles ON in the viewer's UI language (fr reads the English track). */
export function defaultSubtitleMode(locale: string | null | undefined): SubtitleMode {
  return (locale ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** In 双语 the viewer's own language leads. */
export function bilingualOrder(locale: string | null | undefined): ['zh', 'en'] | ['en', 'zh'] {
  return (locale ?? '').toLowerCase().startsWith('zh') ? ['zh', 'en'] : ['en', 'zh'];
}
