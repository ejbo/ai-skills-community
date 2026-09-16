// What a stored body holds that the editor's schema cannot — found BEFORE the
// author edits it, so the editor can say so instead of silently normalizing it
// away on the first save. React-free and pure over a markdown-it instance (the
// editor passes tiptap-markdown's own, so the scan reads the body exactly the
// way the editor is about to).
//
// The case that matters: Skill.descriptionMd is the uploaded README
// (app/api/skills/upload-package/route.ts) and SkillForm edits it in this
// editor. READMEs are full of badge images wrapped in links, task lists,
// footnotes and `<details>` / `<kbd>` — the reader renders every one of them,
// and one edit-and-save dropped them all. (`<sup>` / `<sub>` and the v3
// formatting spans / 行高 wrapper are editor marks now and are kept.)
//
// Deliberately NOT reported: the documented, harmless normalizations (a
// sticker's own paragraph on re-edit, table delimiter spacing), and bold around
// inline code (refused by design — components/editor/format-marks.ts).

import { RICH_LINE_HEIGHT_TAG_RE, RICH_SPAN_TAG_RE } from '@/lib/rich-marks';

export type UnsupportedConstruct = 'linked_image' | 'image_in_list' | 'task_list' | 'footnote' | 'html';

/** Report order (and the i18n key suffix: `ui.rte_unsupported_<kind>`). */
export const UNSUPPORTED_CONSTRUCTS: readonly UnsupportedConstruct[] = ['linked_image', 'image_in_list', 'task_list', 'footnote', 'html'];

interface MdToken {
  type: string;
  content: string;
  children: MdToken[] | null;
}
export interface MarkdownParserLike {
  parse(src: string, env: Record<string, unknown>): MdToken[];
}

/**
 * Tags the editor turns into nodes / marks (or that the serializer writes
 * itself). Anything else inside raw HTML is dropped on load — its text may
 * survive, the element does not.
 */
const KNOWN_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'strike', 'code', 'pre', 'a', 'img', 'sup', 'sub',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
]);
const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g;
/**
 * The formatting spans and the 行高 wrapper (lib/rich-marks.ts, contract v3 —
 * named or hex colours, px sizes, every font key) as whole opening tags. A span
 * or div with any other attributes / values is foreign.
 */
const FORMAT_OPEN_TAG_RE = new RegExp(`^(?:${RICH_SPAN_TAG_RE.source}|${RICH_LINE_HEIGHT_TAG_RE.source})$`);

function hasForeignHtml(html: string): boolean {
  if (html.includes('<!--')) return true; // a comment is dropped outright
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    const name = m[2].toLowerCase();
    if (name === 'span' || name === 'div') {
      if (m[1] === '/' || FORMAT_OPEN_TAG_RE.test(m[0])) continue;
      return true;
    }
    if (!KNOWN_TAGS.has(name)) return true;
  }
  return false;
}

/** The constructs in `src` the editor would lose on save, in UNSUPPORTED_CONSTRUCTS order. */
export function unsupportedMarkdownConstructs(md: MarkdownParserLike, src: string): UnsupportedConstruct[] {
  if (!src || !src.trim()) return [];
  const found = new Set<UnsupportedConstruct>();
  const env: Record<string, unknown> = {};
  let tokens: MdToken[];
  try {
    tokens = md.parse(src, env);
  } catch {
    return [];
  }

  // `[^1]: note` is a link reference definition to markdown-it (no footnote
  // plugin): the label keeps its caret, and the use becomes a link to "note".
  const refs = env.references as Record<string, unknown> | undefined;
  if (refs && Object.keys(refs).some((label) => label.startsWith('^'))) found.add('footnote');

  let itemStart = false;
  for (const token of tokens) {
    if (token.type === 'list_item_open') {
      itemStart = true;
      continue;
    }
    if (token.type === 'html_block') {
      if (hasForeignHtml(token.content)) found.add('html');
      continue;
    }
    if (token.type !== 'inline') continue;
    const kids = token.children ?? [];
    if (itemStart) {
      itemStart = false;
      const first = kids.find((k) => !(k.type === 'text' && !k.content.trim()));
      if (first?.type === 'image') found.add('image_in_list');
      if (first?.type === 'text' && /^\[[ xX]\](?:\s|$)/.test(first.content)) found.add('task_list');
    }
    kids.forEach((kid, i) => {
      if (kid.type === 'link_open' && kids[i + 1]?.type === 'image') found.add('linked_image');
      if (kid.type === 'html_inline' && hasForeignHtml(kid.content)) found.add('html');
    });
  }
  return UNSUPPORTED_CONSTRUCTS.filter((kind) => found.has(kind));
}
