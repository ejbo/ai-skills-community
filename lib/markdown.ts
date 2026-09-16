import { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import {
  RICH_BG_COLORS,
  RICH_FONT_FAMILY_KEYS,
  RICH_FONT_SIZE_VALUES,
  RICH_HEX_COLOR_RE,
  RICH_LINE_HEIGHTS,
  RICH_LINE_HEIGHT_HAST_PROP,
  RICH_MARK_HAST_PROP,
  RICH_TEXT_COLORS,
} from '@/lib/rich-marks';

const baseAttributes = defaultSchema.attributes ?? {};

/**
 * highlight.js token classes as rehype-highlight (lowlight) emits them:
 *   `hljs-keyword`, `hljs-built_in`, `hljs-meta-string` … — the prefixed first scope;
 *   `function_`, `class_`, `invoke__` …                  — highlight.js 11 sub-scopes
 *                                                          (`title.function` → `hljs-title function_`).
 * Anchored and flag-free (hast-util-sanitize calls `.test()` per token; a `g`
 * flag would make it stateful).
 */
const HLJS_TOKEN_CLASS = /^hljs-[a-z0-9_-]+$/;
const HLJS_SUBSCOPE_CLASS = /^[a-z][a-z0-9]*_+$/;

/**
 * GitHub-style sanitize schema — the trust boundary for every stored markdown
 * body (MarkdownRenderer runs it LAST, after rehype-raw and rehype-highlight).
 * Scripts, inline event handlers, `style`, `javascript:` URLs and unlisted tags
 * are stripped.
 *
 * Class names are ENUMERATED, never free. `span` and `pre` used to accept any
 * `className`, which let a body posted straight to the API store
 * `<a href=…><span class="fixed inset-0 z-[100] bg-white">会话已过期</span></a>`
 * — every Tailwind utility used anywhere in the source ships in the CSS, so that
 * rendered as a full-page, attacker-worded link over whatever page showed the
 * body. Now:
 *   • `span` — highlight.js token classes only;
 *   • `code` — `language-*` (remark) and `hljs` (rehype-highlight) only;
 *   • `pre`  — no class at all (nothing legitimate puts one there).
 * hast-util-sanitize takes the FIRST definition that names an attribute, so
 * each element lists `className` exactly once.
 *
 * 富文本格式 (lib/rich-marks.ts, contract v3): `<span data-color|data-bg|data-size|data-font>`
 * with CLOSED value lists, plus the ONE strict hex shape for colour and
 * background (RICH_HEX_COLOR_RE, `#` + six lowercase hex digits — hast-util-sanitize
 * tests RegExp entries against the value) — a value outside them drops that
 * attribute (the text stays). `<div data-lh>` (行高 runs) takes the closed
 * line-height list; `sup` / `sub` come from the GitHub default schema with no
 * attributes. The palette and rules live in app/rich-text.css; a hex value
 * reaches CSS as a custom property set AFTER this schema by
 * lib/markdown-rich-style.ts. Deliberately NOT allowed: `style` (cannot be
 * limited per CSS property — position:fixed overlays, url() beacons), `<mark>`,
 * `<font>`, `<u>`.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...baseAttributes,
    code: [['className', /^language-./, 'hljs']],
    span: [
      ['className', 'hljs', HLJS_TOKEN_CLASS, HLJS_SUBSCOPE_CLASS],
      [RICH_MARK_HAST_PROP.color, ...RICH_TEXT_COLORS, RICH_HEX_COLOR_RE],
      [RICH_MARK_HAST_PROP.bg, ...RICH_BG_COLORS, RICH_HEX_COLOR_RE],
      [RICH_MARK_HAST_PROP.size, ...RICH_FONT_SIZE_VALUES],
      [RICH_MARK_HAST_PROP.font, ...RICH_FONT_FAMILY_KEYS],
    ],
    // The default schema's microdata attributes stay; 行高 is the only addition.
    div: [...(baseAttributes.div ?? []), [RICH_LINE_HEIGHT_HAST_PROP, ...RICH_LINE_HEIGHTS]],
    // Rich-text editor output: keep image + link attributes so inserted images
    // and links survive sanitization. (Relative src/href pass the protocol check;
    // `javascript:` etc. are still stripped — the trust boundary is intact.)
    img: [...(baseAttributes.img ?? []), 'src', 'alt', 'title', 'width', 'height'],
    a: [...(baseAttributes.a ?? []), 'href', 'title', 'target', 'rel'],
  },
};
