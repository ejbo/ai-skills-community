// 富文本格式标记 (text colour / background / font size / font family / line
// height) — THE contract. v3 (2026-09-15): full colour, numeric 字号, Latin and
// CJK font families, 行高.
//
// Import-free and client-safe on purpose: the Tiptap marks
// (components/editor/format-marks.ts, components/editor/line-height.ts), the
// reader's sanitize schema (lib/markdown.ts) and its post-sanitize style plugin
// (lib/markdown-rich-style.ts), the palette CSS (app/rich-text.css), the
// plain-text helpers (lib/markdown-text.ts) and the tests all read these tables,
// so the editor can never emit a value the reader strips, and the reader can
// never accept a value the editor cannot re-open.
//
// STORAGE FORMAT (inside the markdown string, as inline HTML):
//   <span data-color="red">text</span>        legacy named colour (kept forever)
//   <span data-color="#1f6feb">text</span>    any colour, lowercase #rrggbb
//   <span data-bg="yellow">text</span>        / data-bg="#fff3b0"
//   <span data-size="lg">text</span>          legacy relative size (sm / lg / xl)
//   <span data-size="24">text</span>          px, from RICH_FONT_SIZES_PX
//   <span data-font="serif">text</span>       a closed font KEY, never a family name
//   <sup>text</sup> / <sub>text</sub>         (components/editor/script-marks.ts)
//   <div data-lh="1.5">                       行高 — a run of top-level blocks:
//                                             blank line, their markdown, blank
//                                             line, </div> (components/editor/line-height.ts)
// One attribute per span; several formats nest as several spans. Values are
// CLOSED sets or the one strict hex shape — never `style=`, never a class name,
// never a CSS keyword or function:
//   • `style` cannot be restricted per property by rehype-sanitize (CSS
//     injection: position:fixed overlays, url() beacons). Hex colours still
//     reach the page as a CUSTOM PROPERTY (`--rt-c:#rrggbb`), but that style is
//     built AFTER the sanitizer by lib/markdown-rich-style.ts from a value that
//     matched RICH_HEX_COLOR_RE — seven characters that cannot contain `;`,
//     `(`, `url` or anything but a colour — and it is never stored;
//   • a named colour follows the site's and the 知识库 reader's themes through
//     curated tokens; a hex colour is kept legible on dark grounds by an OKLCH
//     lightness clamp in app/rich-text.css;
//   • class names would re-open the arbitrary-class overlay hole that
//     lib/markdown.ts closed.
//
// Why these marks sit at priorities 1001–1004 (components/editor/format-marks.ts):
// above Link (1000) so a coloured @mention serializes as
// `<span …>[@x](/users/x)</span>` (mention extraction and notifications keep
// working), and above Bold so bold next to CJK text never corrupts. Nesting
// order, outermost first: sup/sub > size > font > bg > color.

// ─── colours ────────────────────────────────────────────────────────────────

/** Legacy named text colours. Stored bodies use them, so they stay valid FOREVER (curated per-theme tokens). */
export const RICH_TEXT_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type RichTextColor = (typeof RICH_TEXT_COLORS)[number];

/** Legacy named backgrounds — same names, their own (lighter) tokens. */
export const RICH_BG_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type RichBgColor = (typeof RICH_BG_COLORS)[number];

/**
 * The ONE stored hex shape: `#` + six LOWERCASE hex digits. Anchored and
 * flag-free (hast-util-sanitize calls `.test()` per value; a `g` flag would make
 * it stateful). No alpha: an 8-digit colour would let the author paint text
 * invisible on every ground, and the dark-ground clamp could not undo that.
 */
export const RICH_HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

/** A stored colour value: a legacy name or strict hex. */
export type RichColorValue = RichTextColor | `#${string}`;

/** True only for the STORED form (`#rrggbb`, lowercase). Use normalizeHexColor for user input. */
export function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === 'string' && RICH_HEX_COLOR_RE.test(value);
}

/**
 * User input → the stored hex form, or null. Accepts `#rgb` and `#rrggbb` in any
 * case (surrounding whitespace ignored) and returns lowercase `#rrggbb`
 * (`#ABC` → `#aabbcc`). Refuses everything else: no `#rgba` / `#rrggbbaa`, no
 * digits without `#`, no CSS names (`white`, `transparent`), no functions.
 * The legacy palette names are not hex — callers check isRichMarkValue first.
 */
export function normalizeHexColor(value: unknown): `#${string}` | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v as `#${string}`;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short ? (`#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` as `#${string}`) : null;
}

// ─── font sizes ─────────────────────────────────────────────────────────────

/**
 * Legacy RELATIVE sizes (em — 小 / 大 / 特大). Kept valid forever; the v3
 * toolbar no longer offers them. NOTE: this export stays the legacy list —
 * RICH_FONT_SIZE_VALUES is every accepted value.
 */
export const RICH_FONT_SIZES = ['sm', 'lg', 'xl'] as const;
export type RichFontSize = (typeof RICH_FONT_SIZES)[number];

/** 字号 in px, the Word / 飞书 list. Stored as the bare number: `data-size="24"`. */
export const RICH_FONT_SIZES_PX = [10, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72] as const;
export type RichFontSizePx = (typeof RICH_FONT_SIZES_PX)[number];

/** Every accepted `data-size` value: legacy keywords, then the px list as strings. */
export const RICH_FONT_SIZE_VALUES: readonly string[] = [...RICH_FONT_SIZES, ...RICH_FONT_SIZES_PX.map(String)];
export type RichFontSizeValue = RichFontSize | `${RichFontSizePx}`;

// ─── font families ──────────────────────────────────────────────────────────

/**
 * The legacy keys (宋体 / 楷体 / 等宽). Kept valid forever. NOTE: this export
 * stays the legacy list — RICH_FONT_FAMILY_KEYS is every accepted key.
 */
export const RICH_FONT_FAMILIES = ['serif', 'kai', 'mono'] as const;

/** CJK keys, in the order a 字体 dropdown shows them (苹方/雅黑 first — it is what body text already looks like). */
export const RICH_CJK_FONT_FAMILIES = ['sans', 'serif', 'hei', 'kai', 'fangsong', 'lishu'] as const;

/** Latin keys, in dropdown order (monospace last). */
export const RICH_LATIN_FONT_FAMILIES = [
  'arial',
  'helvetica',
  'times',
  'georgia',
  'garamond',
  'palatino',
  'verdana',
  'tahoma',
  'trebuchet',
  'segoe',
  'comic',
  'impact',
  'courier',
  'consolas',
  'mono',
] as const;

export const RICH_FONT_FAMILY_KEYS = [...RICH_CJK_FONT_FAMILIES, ...RICH_LATIN_FONT_FAMILIES] as const;
export type RichFontFamily = (typeof RICH_FONT_FAMILY_KEYS)[number];

/**
 * key → CSS font-family stack. SYSTEM fonts only: the intranet cannot load web
 * fonts (and the self-hosted Inter / JetBrains Mono are latin subsets), so each
 * stack names the Windows, macOS and Linux spellings and ends in a generic
 * family — a missing font degrades to its genre, never to the page default.
 * A Latin family applied to Chinese text falls back per glyph to the system CJK
 * face of the same generic family.
 *
 * app/rich-text.css carries the SAME strings as `--rt-font-<key>` (CSS cannot
 * import this table); tests/rich-marks-v3.test.ts pins the two together. The
 * toolbar's dropdown previews each entry with this stack.
 */
export const RICH_FONT_FAMILY_STACKS: Readonly<Record<RichFontFamily, string>> = {
  sans: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', sans-serif",
  serif: "'Songti SC', STSong, SimSun, 'Noto Serif CJK SC', 'Noto Serif SC', 'Source Han Serif SC', serif",
  hei: "SimHei, 'Heiti SC', STHeiti, 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', sans-serif",
  kai: "'Kaiti SC', STKaiti, KaiTi, 'Kaiti TC', BiauKai, serif",
  fangsong: "FangSong, STFangsong, 'FangSong_GB2312', 'Fangsong SC', 'Songti SC', serif",
  lishu: "LiSu, STLiti, 'Libian SC', 'Baoli SC', 'Kaiti SC', serif",
  arial: "Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif",
  helvetica: "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif",
  times: "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif",
  georgia: "Georgia, 'DejaVu Serif', serif",
  garamond: "Garamond, 'EB Garamond', 'Apple Garamond', 'Adobe Garamond Pro', Baskerville, 'Times New Roman', serif",
  palatino: "'Palatino Linotype', Palatino, 'Book Antiqua', 'URW Palladio L', serif",
  verdana: "Verdana, 'DejaVu Sans', Geneva, sans-serif",
  tahoma: "Tahoma, Verdana, Geneva, 'DejaVu Sans', sans-serif",
  trebuchet: "'Trebuchet MS', 'Lucida Grande', 'Lucida Sans Unicode', 'DejaVu Sans', sans-serif",
  segoe: "'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, sans-serif",
  comic: "'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Comic Neue', cursive",
  impact: "Impact, Haettenschweiler, 'Arial Narrow Bold', 'Franklin Gothic Bold', sans-serif",
  courier: "'Courier New', Courier, 'Liberation Mono', 'Nimbus Mono PS', monospace",
  consolas: "Consolas, 'Cascadia Mono', Menlo, Monaco, 'DejaVu Sans Mono', monospace",
  mono: "var(--font-geist-mono), 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

// ─── line height (行高) ──────────────────────────────────────────────────────

/** 行高 factors, stored verbatim as `data-lh="1.5"`. Unitless, so they scale with every surface's font size. */
export const RICH_LINE_HEIGHTS = ['1', '1.15', '1.5', '1.75', '2', '2.5', '3'] as const;
export type RichLineHeight = (typeof RICH_LINE_HEIGHTS)[number];

/** The stored attribute of the 行高 wrapper div (and of the block element in the editor DOM). */
export const RICH_LINE_HEIGHT_ATTR = 'data-lh';
/** Its hast property name (what rehype-sanitize sees). */
export const RICH_LINE_HEIGHT_HAST_PROP = 'dataLh';

/** Line height input (a list value as string or number: `2`, `'1.5'`) → the stored string, or null. */
export function normalizeLineHeight(value: unknown): RichLineHeight | null {
  const s = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return typeof s === 'string' && (RICH_LINE_HEIGHTS as readonly string[]).includes(s) ? (s as RichLineHeight) : null;
}

export function isRichLineHeight(value: unknown): value is RichLineHeight {
  return typeof value === 'string' && (RICH_LINE_HEIGHTS as readonly string[]).includes(value);
}

// ─── the four inline kinds ──────────────────────────────────────────────────

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

/**
 * The ENUMERATED values per kind. Colour and background additionally accept any
 * strict hex (isHexColor) — an open set that cannot be listed; isRichMarkValue
 * is the complete validator.
 */
export const RICH_MARK_VALUES: {
  color: readonly RichTextColor[];
  bg: readonly RichBgColor[];
  size: readonly string[];
  font: readonly RichFontFamily[];
} = {
  color: RICH_TEXT_COLORS,
  bg: RICH_BG_COLORS,
  size: RICH_FONT_SIZE_VALUES,
  font: RICH_FONT_FAMILY_KEYS,
};

/** Tiptap mark names (schema names) per kind. */
export const RICH_MARK_NAME: Record<RichMarkKind, 'textColor' | 'textBg' | 'fontSize' | 'fontFamily'> = {
  color: 'textColor',
  bg: 'textBg',
  size: 'fontSize',
  font: 'fontFamily',
};

/** THE validator of a STORED value (exact: case, hex shape and list membership all matter). */
export function isRichMarkValue(kind: RichMarkKind, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if ((kind === 'color' || kind === 'bg') && isHexColor(value)) return true;
  return (RICH_MARK_VALUES[kind] as readonly string[]).includes(value);
}

/**
 * User / toolbar input → the stored value, or null. Colour: a legacy name as-is
 * or normalizeHexColor. Size: a listed keyword or px value, as string or number
 * (`24` → `'24'`; `'24px'` is refused). Font: a listed key.
 */
export function normalizeRichMarkValue(kind: RichMarkKind, value: unknown): string | null {
  if (kind === 'color' || kind === 'bg') {
    if (isRichMarkValue(kind, value)) return value as string;
    return normalizeHexColor(value);
  }
  const s = kind === 'size' && typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return isRichMarkValue(kind, s) ? (s as string) : null;
}

// ─── stored-tag regexes (plain-text helpers, SKILL.md / AI context strip) ───

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (values: readonly string[]) => values.map(escapeRe).join('|');

/**
 * Matches ONE opening or closing formatting span as stored — EXACT values only
 * (a `data-color="Red"` or `data-size="24px"` span is foreign HTML, which is
 * what the sanitizer thinks of it too). Global: used with `.replace` by the
 * plain-text helpers and by SKILL.md / AI-context sanitizers to strip
 * formatting while keeping the markdown. Does NOT match sup/sub (they carry
 * meaning — `H<sub>2</sub>O`) or the 行高 wrapper (RICH_LINE_HEIGHT_TAG_RE).
 */
export const RICH_SPAN_TAG_RE = new RegExp(
  `<span\\s+(?:data-(?:color|bg)="(?:${alt(RICH_TEXT_COLORS)}|#[0-9a-f]{6})"|data-size="(?:${alt(RICH_FONT_SIZE_VALUES)})"|data-font="(?:${alt(RICH_FONT_FAMILY_KEYS)})")\\s*>|<\\/span>`,
  'g',
);

/** Matches ONE opening or closing 行高 wrapper as stored (`<div data-lh="1.5">` / `</div>`). Global, like RICH_SPAN_TAG_RE. */
export const RICH_LINE_HEIGHT_TAG_RE = new RegExp(`<div\\s+data-lh="(?:${alt(RICH_LINE_HEIGHTS)})"\\s*>|<\\/div>`, 'g');
