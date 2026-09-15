// 富文本格式标记 (text colour / background / font size / font family) — THE contract.
//
// Import-free and client-safe on purpose: the Tiptap marks
// (components/editor/format-marks.ts), the reader's sanitize schema
// (lib/markdown.ts), the palette CSS (app/rich-text.css), the plain-text
// helpers (lib/markdown-text.ts) and the tests all read these tables, so the
// editor can never emit a value the reader strips, and the reader can never
// accept a value the editor cannot re-open.
//
// STORAGE FORMAT (inside the markdown string, as inline HTML):
//   <span data-color="red">text</span>
//   <span data-bg="yellow">text</span>
//   <span data-size="lg">text</span>
//   <span data-font="serif">text</span>
// One attribute per span; several formats nest as several spans. Values are
// CLOSED sets — never a raw CSS colour, never `style=`, never a class name:
//   • `style` cannot be restricted per property by rehype-sanitize (CSS
//     injection: position:fixed overlays, url() beacons);
//   • a raw colour cannot adapt to the dark theme or the 知识库 reader themes;
//   • class names would re-open the arbitrary-class overlay hole that
//     lib/markdown.ts closes in the same change.
// The palette lives in app/rich-text.css as theme-aware CSS variables.
//
// Why these marks sit at priorities 1001–1004 (components/editor/format-marks.ts):
// above Link (1000) so a coloured @mention serializes as
// `<span …>[@x](/users/x)</span>` (mention extraction and notifications keep
// working), and above Bold so bold next to CJK text never corrupts. Nesting
// order, outermost first: size > font > bg > color.

export const RICH_TEXT_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type RichTextColor = (typeof RICH_TEXT_COLORS)[number];

export const RICH_BG_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type RichBgColor = (typeof RICH_BG_COLORS)[number];

/** Relative to the surrounding text (em), so every surface's base size still applies. */
export const RICH_FONT_SIZES = ['sm', 'lg', 'xl'] as const;
export type RichFontSize = (typeof RICH_FONT_SIZES)[number];

/** System font stacks only — the intranet cannot load web fonts. */
export const RICH_FONT_FAMILIES = ['serif', 'kai', 'mono'] as const;
export type RichFontFamily = (typeof RICH_FONT_FAMILIES)[number];

export type RichMarkKind = 'color' | 'bg' | 'size' | 'font';

/** Every kind. Iteration order only — the NESTING order of stored spans is set by mark priority in components/editor/format-marks.ts. */
export const RICH_MARK_KINDS: readonly RichMarkKind[] = ['color', 'bg', 'size', 'font'];

/** HTML attribute per kind (what is stored). */
export const RICH_MARK_ATTR: Record<RichMarkKind, 'data-color' | 'data-bg' | 'data-size' | 'data-font'> = {
  color: 'data-color',
  bg: 'data-bg',
  size: 'data-size',
  font: 'data-font',
};

/** hast property name per kind (what rehype-sanitize sees). */
export const RICH_MARK_HAST_PROP: Record<RichMarkKind, 'dataColor' | 'dataBg' | 'dataSize' | 'dataFont'> = {
  color: 'dataColor',
  bg: 'dataBg',
  size: 'dataSize',
  font: 'dataFont',
};

export const RICH_MARK_VALUES: { color: readonly RichTextColor[]; bg: readonly RichBgColor[]; size: readonly RichFontSize[]; font: readonly RichFontFamily[] } = {
  color: RICH_TEXT_COLORS,
  bg: RICH_BG_COLORS,
  size: RICH_FONT_SIZES,
  font: RICH_FONT_FAMILIES,
};

/** Tiptap mark names (schema names) per kind. */
export const RICH_MARK_NAME: Record<RichMarkKind, 'textColor' | 'textBg' | 'fontSize' | 'fontFamily'> = {
  color: 'textColor',
  bg: 'textBg',
  size: 'fontSize',
  font: 'fontFamily',
};

export function isRichMarkValue(kind: RichMarkKind, value: unknown): boolean {
  return typeof value === 'string' && (RICH_MARK_VALUES[kind] as readonly string[]).includes(value);
}

/**
 * Matches ONE opening or closing formatting span as stored. Used by the
 * plain-text helpers to drop the markup and by SKILL.md / AI-context
 * sanitizers to strip formatting while keeping the markdown.
 */
export const RICH_SPAN_TAG_RE = /<span\s+data-(?:color|bg|size|font)="[a-z]+"\s*>|<\/span>/g;
