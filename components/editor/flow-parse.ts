// How markdown and pasted HTML come INTO the editor — the parse-side half of
// "open, edit, save must not change what the reader shows". React-free;
// registered for every editor by buildRichTextExtensions
// (components/editor/rich-text-extensions.ts), with or without FlowExtension.
//
// tiptap-markdown renders the body to HTML with markdown-it, post-processes that
// HTML, and lets ProseMirror parse it. Three places where what the EDITOR built
// disagreed with what the READER renders from the same bytes:
//
// 1. SOFT LINE BREAKS right after a formatted run vanished. markdown-it renders
//    a soft break as a literal "\n"; tiptap-markdown's normalizeDOM then strips
//    a leading "\n" from EVERY text node that follows an element (meant for the
//    newlines between blocks) — including the soft break after `</strong>`,
//    `</code>`, `</a>`, `</span>`. `The **code**\nis done` came back as
//    `The **code**is done`; hard-wrapped READMEs (Skill.descriptionMd) glued a
//    word pair on every wrapped line after inline code. A soft break is rendered
//    as a SPACE instead: ProseMirror turned the "\n" between plain words into a
//    space anyway, so every other body parses exactly as before.
//
// 2. OWN-LINE `[embed:…]` / `[poll:…]` TOKENS written without a blank line
//    around them (API bodies, seed scripts, a plain textarea). The reader splits
//    the body LINE BY LINE (lib/polls-shared.ts splitPollSegments,
//    lib/zones/shared.ts splitEmbedSegments — fence-aware) and shows a card; the
//    editor's markdown-it read the same line as a paragraph continuation, a
//    lazy list / quote line or a table ROW, so the normalizers (which only
//    replace a top-level paragraph that is exactly the token) never saw it, and
//    the next save escaped it into literal text — the card was gone and an
//    in-body file stopped counting for bodyFileKeys. Before markdown-it's block
//    parse, every line the reader would treat as a token gets its own blank-line
//    isolated block, with the same fence tracking and the same token regexes.
//
// 3. PASTED `<p><img></p>` (how nearly every web page wraps a picture). The
//    image node is a BLOCK, so ProseMirror's clipboard parser closed the
//    paragraph first and left an EMPTY paragraph above every pasted picture — a
//    visible gap the stored markdown cannot even represent. tiptap-markdown lifts
//    block elements out of `<p>` for markdown it renders, but pasted HTML never
//    goes through it. The same lift runs on pasted HTML, and the source page's
//    `width` / `height` / `style` on those images is dropped: a layout width
//    from somebody else's page is what turned a pasted picture into raw
//    `<img width="400">` HTML instead of `![alt](src)`.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { POLL_TOKEN_RE } from '@/lib/polls-shared';
import { STICKER_URL_PREFIX } from '@/lib/stickers';
import { parseEmbedToken } from '@/lib/zones/shared';

// ── 2. own-line tokens ────────────────────────────────────────────────────────

/** Same fence opener the reader's splitters track (lib/polls-shared.ts, lib/zones/shared.ts). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** True when the reader would render `line` as a poll / embed card. */
function isOwnLineToken(line: string): boolean {
  return POLL_TOKEN_RE.test(line) || parseEmbedToken(line) != null;
}

/**
 * Puts every line the reader treats as an own-line `[poll:…]` / `[embed:…]`
 * token into its own block: a blank line before it (unless it opens the body or
 * already follows one), the token without indentation, a blank line before the
 * next non-blank line. Lines inside ``` / ~~~ fences are left alone, like the
 * reader does. Returns `src` itself when nothing needs to change.
 */
export function isolateOwnLineTokens(src: string): string {
  if (!src.includes('[poll:') && !src.includes('[embed:')) return src;
  const lines = src.split('\n');
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  let blankBeforeNext = false;
  let changed = false;

  for (const line of lines) {
    const fenceMark = FENCE_RE.exec(line);
    const inFenceOrOpening = fence != null || fenceMark != null;
    if (fenceMark) {
      const char = fenceMark[1][0];
      const len = fenceMark[1].length;
      if (!fence) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
    }
    if (!inFenceOrOpening && isOwnLineToken(line)) {
      if (out.length > 0 && out[out.length - 1].trim() !== '') {
        out.push('');
        changed = true;
      }
      const token = line.trim();
      if (token !== line) changed = true;
      out.push(token);
      blankBeforeNext = true;
      continue;
    }
    if (blankBeforeNext && line.trim() !== '') {
      out.push('');
      changed = true;
    }
    blankBeforeNext = false;
    out.push(line);
  }
  return changed ? out.join('\n') : src;
}

// ── markdown-it setup ─────────────────────────────────────────────────────────

type MdCoreState = { src: string };
type MarkdownItLike = {
  core: { ruler: { after(after: string, name: string, fn: (state: MdCoreState) => void): void } };
  renderer: { rules: Record<string, unknown> };
};

const SETUP_DONE = Symbol.for('aic.editor.flowParse');

/**
 * tiptap-markdown calls every extension's `parse.setup` before EVERY parse on
 * the same markdown-it instance, so anything that adds a rule must be idempotent
 * (a pushed core rule would pile up one copy per setContent / paste).
 */
function setupMarkdownIt(md: MarkdownItLike): void {
  // 1: a soft break is a space. Assigned (not wrapped), so it is idempotent by
  // construction; it also replaces tiptap-markdown's own "strip the trailing
  // newline" wrapper for softbreak, which a space does not need.
  md.renderer.rules.softbreak = () => ' ';

  const flagged = md as unknown as Record<symbol, boolean>;
  if (flagged[SETUP_DONE]) return;
  flagged[SETUP_DONE] = true;
  // 2: after `normalize` (CRLF → LF), before the block parse reads `src`.
  md.core.ruler.after('normalize', 'aic_own_line_tokens', (state) => {
    state.src = isolateOwnLineTokens(state.src);
  });
}

// ── 3. pasted HTML ────────────────────────────────────────────────────────────

/** A fragment that still carries something worth a paragraph (text, an inline image, a line break). */
function hasContent(frag: DocumentFragment): boolean {
  return (frag.textContent ?? '').trim() !== '' || frag.querySelector('img, br') != null;
}

/**
 * Moves every non-sticker `<img>` out of the `<p>` around it (splitting the
 * paragraph into the text before and after), and drops the source page's
 * sizing on it. HTML copied from ProseMirror itself (`data-pm-slice`) is left
 * alone — it carries the open depth of the slice on its first element, and the
 * editor's own images are never inside a paragraph anyway.
 */
export function liftPastedBlockImages(html: string): string {
  if (!/<img[\s>]/i.test(html) || html.includes('data-pm-slice') || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const img of Array.from(doc.body.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith(STICKER_URL_PREFIX)) continue; // stickers are inline and stay in the sentence
    if (img.hasAttribute('width') || img.hasAttribute('height') || img.hasAttribute('style')) {
      img.removeAttribute('width');
      img.removeAttribute('height');
      img.removeAttribute('style');
      changed = true;
    }
    const p = img.closest('p');
    if (!p || img.closest('pre')) continue;
    const before = doc.createRange();
    before.setStart(p, 0);
    before.setEndBefore(img);
    const head = before.extractContents();
    const after = doc.createRange();
    after.setStartAfter(img);
    after.setEnd(p, p.childNodes.length);
    const tail = after.extractContents();
    if (hasContent(head)) {
      const headP = p.cloneNode(false) as HTMLElement;
      headP.appendChild(head);
      p.before(headP);
    }
    p.before(img);
    if (hasContent(tail)) {
      const tailP = p.cloneNode(false) as HTMLElement;
      tailP.appendChild(tail);
      p.after(tailP);
    }
    p.remove();
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

export const flowParseKey = new PluginKey('flowParse');

export const FlowMarkdownParse = Extension.create({
  name: 'flowMarkdownParse',

  addStorage() {
    return {
      markdown: {
        parse: {
          setup: setupMarkdownIt,
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: flowParseKey,
        props: {
          transformPastedHTML: (html) => liftPastedBlockImages(html),
        },
      }),
    ];
  },
});
