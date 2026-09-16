// rehype plugin — hex text / background colours become CSS custom properties.
// Runs AFTER rehype-sanitize (components/MarkdownRenderer.tsx), like
// lib/markdown-code-lines.ts, and for the same reason: it only emits attributes
// it builds itself from validated values, so the sanitize schema never has to
// allow `style`.
//
// Why a custom property and not `style="color: …"` from the stored body:
//   • `style` cannot be allowed by the sanitizer per property (a stored
//     `style="position:fixed; inset:0"` is a page overlay), so it is never
//     stored and never allowed. What reaches this plugin is a `data-color` /
//     `data-bg` value the schema already matched against the closed palette
//     names or RICH_HEX_COLOR_RE — and this plugin re-checks the hex shape
//     itself before writing it, so the emitted style is exactly
//     `--rt-c:#rrggbb` / `--rt-bg:#rrggbb` (seven characters that cannot close
//     the declaration, call a function or load anything), even if a future
//     schema change loosened the allowlist;
//   • a variable, not the colour itself: app/rich-text.css decides how it is
//     painted — `color: var(--rt-c)`, clamped to a readable OKLCH lightness on
//     dark grounds (site dark theme, 知识库 reader 深色), with an automatic text
//     colour on a hex background. A literal `color:` here would be unreadable
//     black-on-black in the dark theme and could not be clamped.
// The editor renders the same property on the same span (components/editor/format-marks.ts
// renderHTML), so writing and reading share one set of CSS rules.
//
// Legacy named colours carry no style: their curated per-theme tokens are
// selected by the attribute value alone.

import { RICH_HEX_COLOR_RE, RICH_MARK_HAST_PROP } from '@/lib/rich-marks';

type HElement = {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HNode[];
};
type HNode = HElement | { type: string; children?: HNode[] };

/** The custom property each colour attribute feeds (app/rich-text.css reads them). */
export const RICH_STYLE_PROPERTY = { color: '--rt-c', bg: '--rt-bg' } as const;

/**
 * The inline style for a span's validated colour attributes, or null when it
 * has none. Exported for the tests; the plugin below is the only caller.
 */
export function richStyleFor(properties: Record<string, unknown> | undefined): string | null {
  if (!properties) return null;
  const parts: string[] = [];
  const color = properties[RICH_MARK_HAST_PROP.color];
  const bg = properties[RICH_MARK_HAST_PROP.bg];
  if (typeof color === 'string' && RICH_HEX_COLOR_RE.test(color)) parts.push(`${RICH_STYLE_PROPERTY.color}:${color}`);
  if (typeof bg === 'string' && RICH_HEX_COLOR_RE.test(bg)) parts.push(`${RICH_STYLE_PROPERTY.bg}:${bg}`);
  return parts.length > 0 ? parts.join(';') : null;
}

/**
 * rehype plugin — must be registered AFTER rehype-sanitize. Sets
 * `style="--rt-c:#rrggbb"` / `--rt-bg` on every `<span>` whose `data-color` /
 * `data-bg` is a strict hex colour, and REMOVES any other style from spans
 * (nothing legitimate can have put one there after sanitize). Iterative walk:
 * a deeply nested body cannot overflow the stack.
 */
export function rehypeRichStyle() {
  return (tree: unknown) => {
    const stack: HNode[] = [tree as HNode];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === 'element' && (node as HElement).tagName === 'span') {
        const el = node as HElement;
        const style = richStyleFor(el.properties);
        if (style) el.properties = { ...el.properties, style };
        else if (el.properties && 'style' in el.properties) {
          const { style: _dropped, ...rest } = el.properties;
          el.properties = rest;
        }
      }
      const children = (node as { children?: HNode[] }).children;
      if (Array.isArray(children)) for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
  };
}
