// 行高 (line height) — a BLOCK attribute on top-level paragraphs, headings,
// lists and blockquotes. React-free; registered for every editor by
// buildRichTextExtensions (components/editor/rich-text-extensions.ts). The value
// set is lib/rich-marks.ts#RICH_LINE_HEIGHTS; the reader's allowlist is
// lib/markdown.ts (`div[data-lh]`); the rules are app/rich-text.css.
//
// STORAGE. Markdown has no block attributes, so each RUN of consecutive
// top-level blocks with the same value is wrapped in an HTML block:
//
//   <div data-lh="2">
//
//   ## 标题
//
//   正文 with [@王伟](/users/x)
//
//   </div>
//
// CommonMark ends an HTML block at the first blank line and parses what follows
// as MARKDOWN again, so everything inside keeps working exactly as it did
// unwrapped: headings still start a line (lib/zones/shared.ts#extractHeadings
// and the TOC find them), @mentions still match lib/mentions.ts, the reader
// renders the inner markdown (rehype-raw re-nests the split `<div>`/`</div>`
// around it), and the plain-text helpers drop the two tag lines
// (lib/markdown-text.ts). Nothing that has no line height is ever inside a run:
// code blocks, tables, images, rules and the own-line `[poll:]` / `[embed:]`
// cards cannot carry the attribute, so they always BREAK a run — a card token
// stays own-line at the top level where the reader's line splitters look for it.
//
// ONLY TOP LEVEL, and that is the whole design:
//   • a run is a sequence of the DOCUMENT's children, so the wrapper never has
//     to appear inside a list item, a quote or a GFM cell (where an HTML block
//     would break the surrounding markdown — a `<div>` line inside a table cell
//     turns the whole table into raw HTML);
//   • a list or a quote carries the value for everything inside it (the CSS
//     applies it to the descendants), so there is nothing to store below it;
//   • a nested block can still RECEIVE the attribute through the schema (paste
//     `<p data-lh>` into a list item, wrap a spaced paragraph in a list): the
//     guard plugin below removes it wherever it is not top level, so the editor
//     never shows a line height the saved body would silently drop;
//   • the commands target the TOP-LEVEL blocks a selection touches, and a
//     table is not one of the types — with the caret in a cell the command is
//     disabled (`can()` is false).
//
// PARSE. A block reads its own `data-lh` (copy / paste between editors — the
// editor DOM puts it on the block element, which is also what the CSS styles)
// or, failing that, its DIRECT parent `div[data-lh]` (a stored body, or HTML
// copied from a rendered post). Direct parent only: a paragraph inside a list
// item inside the wrapper is the list's content, not a run member.
//
// A STORED body is normalised first (normalizeLineHeightDom, registered as
// tiptap-markdown's `parse.updateDOM` — markdown only, never pasted HTML), so
// that opening and saving one cannot change what its readers see:
//   • `data-lh` is dropped from everything that is not a `div`. The reader's
//     sanitize schema allows it on `div` alone (lib/markdown.ts), so an
//     API-written `<p data-lh="3">` shows the DEFAULT spacing — but the editor
//     read the element's own attribute (a rule meant for clipboard HTML), showed
//     行高 3, and the first save wrote a real wrapper: spacing readers had never
//     seen. Now both sides read the same bytes the same way;
//   • a wrapper's DIRECT inline content is wrapped in a `<p>`, so it becomes a
//     paragraph that CAN carry the run's value. Without it, ProseMirror created
//     an implicit paragraph — an element with no parse rule, so getAttrs never
//     ran and `<div data-lh="2">正文</div>` (an API body with no blank lines)
//     lost its line height on the first save although the reader applied it.
// What the editor still cannot keep, because the storage format is
// top-level-only (see above): a wrapper INSIDE a list item / quote / cell (the
// guard strips nested values) and a wrapper around a table, a code block, an
// image or a rule (those types carry no line height). The reader paints those;
// the first editor save drops the wrapper and keeps the content.
//
// SERIALIZE. FlowMarkdownSerializer (components/editor/flow-markdown.ts) renders
// the document's children through serializeTopLevelBlocks below. The test-only
// `flow: false` reference stack does not, and drops the wrapper.

import { Extension, type CommandProps, type Editor } from '@tiptap/core';
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Selection, type Transaction } from '@tiptap/pm/state';
import {
  RICH_LINE_HEIGHT_ATTR,
  isRichLineHeight,
  normalizeLineHeight,
  type RichLineHeight,
} from '@/lib/rich-marks';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineHeight: {
      /**
       * 行高 for every top-level paragraph / heading / list / blockquote the
       * selection touches (the caret's block when empty). `value` from
       * RICH_LINE_HEIGHTS, as string or number. False (and nothing changes)
       * for an unlisted value or when no such block is selected — a caret in a
       * table cell or a code block.
       */
      setLineHeight: (value: string | number) => ReturnType;
      /** Back to the surface's default line height. Same targets and availability as setLineHeight. */
      unsetLineHeight: () => ReturnType;
    };
  }
}

/** Node attribute name (schema). */
export const LINE_HEIGHT_NODE_ATTR = 'lineHeight';

/** The node types that can carry a line height — at the TOP LEVEL only. */
export const LINE_HEIGHT_NODE_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote'] as const;

const TYPE_SET: ReadonlySet<string> = new Set(LINE_HEIGHT_NODE_TYPES);

/** The stored line height of a node, or null (also for a node type that cannot carry one). */
export function lineHeightOf(node: PMNode): RichLineHeight | null {
  if (!TYPE_SET.has(node.type.name)) return null;
  const value = node.attrs[LINE_HEIGHT_NODE_ATTR];
  return isRichLineHeight(value) ? value : null;
}

// ─── markdown parse: the loaded DOM says what the reader says ───────────────

/**
 * Tags ProseMirror parses as BLOCKS here, so they never join an implicit
 * paragraph. `img` is deliberately absent: a 表情包 is inline, and a block
 * image wrapped by mistake is lifted straight back out by tiptap-markdown's
 * own normalizeBlocks (which runs after this).
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'IFRAME', 'LI', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL', 'VIDEO',
]);

/** Wraps each run of the element's direct INLINE children (text, inline elements) in a `<p>`. */
function wrapDirectInlineContent(el: Element): void {
  const doc = el.ownerDocument;
  if (!doc) return;
  let run: ChildNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const p = doc.createElement('p');
    el.insertBefore(p, run[0]);
    for (const node of run) p.appendChild(node);
    run = [];
  };
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      // Whitespace between two blocks is layout, not content: it starts no run.
      if (run.length > 0 || (node.textContent ?? '').trim() !== '') run.push(node);
      continue;
    }
    if (node.nodeType === 1 && !BLOCK_TAGS.has((node as Element).tagName)) {
      run.push(node);
      continue;
    }
    flush();
  }
  flush();
}

/**
 * Makes the DOM tiptap-markdown built from a STORED body agree with what the
 * reader renders from the same bytes (see the header): a wrapper's direct
 * inline content becomes a paragraph, and `data-lh` survives on the wrapper
 * `div` alone. Exported for the tests; registered as `parse.updateDOM` below,
 * so pasted HTML (the editor-to-editor shape, where the attribute sits on the
 * block itself) never goes through it.
 */
export function normalizeLineHeightDom(root: HTMLElement): void {
  const attr = RICH_LINE_HEIGHT_ATTR;
  for (const div of Array.from(root.querySelectorAll(`div[${attr}]`))) wrapDirectInlineContent(div);
  for (const el of Array.from(root.querySelectorAll(`[${attr}]`))) {
    if (el.tagName !== 'DIV') el.removeAttribute(attr);
  }
}

/** DOM → attribute: the element's own `data-lh`, else its direct parent `div[data-lh]` (see the header). */
export function readLineHeightFromDom(el: HTMLElement): RichLineHeight | null {
  const own = el.getAttribute(RICH_LINE_HEIGHT_ATTR);
  if (own != null) return isRichLineHeight(own) ? own : null;
  const parent = el.parentElement;
  if (!parent || parent.tagName !== 'DIV') return null;
  const inherited = parent.getAttribute(RICH_LINE_HEIGHT_ATTR);
  return isRichLineHeight(inherited) ? inherited : null;
}

// ─── targets ─────────────────────────────────────────────────────────────────

export interface LineHeightTarget {
  pos: number;
  node: PMNode;
}

/**
 * The top-level blocks a selection touches that can carry a line height, in
 * document order. A position AT depth 0 (a node selection's end, the end of an
 * AllSelection) does not select the block after it; a gap cursor selects none.
 */
export function lineHeightTargets(doc: PMNode, selection: Selection): LineHeightTarget[] {
  const wanted = new Set<number>();
  for (const range of selection.ranges) {
    const { $from, $to } = range;
    const start = $from.index(0);
    const end = $to.depth === 0 ? $to.index(0) - 1 : $to.index(0);
    for (let i = start; i <= end && i < doc.childCount; i += 1) wanted.add(i);
  }
  const out: LineHeightTarget[] = [];
  if (wanted.size === 0) return out;
  // One pass for the positions (a per-target offset sum is quadratic under Select All).
  doc.forEach((node, pos, index) => {
    if (wanted.has(index) && TYPE_SET.has(node.type.name)) out.push({ pos, node });
  });
  return out;
}

/** Types whose 行高 covers everything inside them — one caret sets the WHOLE list / quote. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['bulletList', 'orderedList', 'blockquote']);

/**
 * True when the blocks 行高 would be set on include a whole list or quote. The
 * scope is the storage format (top-level runs — see the header) and it is not
 * guessable from a caret sitting in one list item, so the 行高 menu says it
 * (components/editor/toolbar/FontSelects.tsx).
 */
export function lineHeightCoversContainer(doc: PMNode, selection: Selection): boolean {
  return lineHeightTargets(doc, selection).some((t) => CONTAINER_TYPES.has(t.node.type.name));
}

function setOn(tr: Transaction, targets: readonly LineHeightTarget[], value: RichLineHeight | null): boolean {
  let changed = false;
  for (const { pos, node } of targets) {
    if ((node.attrs[LINE_HEIGHT_NODE_ATTR] ?? null) === value) continue;
    tr.setNodeAttribute(pos, LINE_HEIGHT_NODE_ATTR, value);
    changed = true;
  }
  return changed;
}

/**
 * Resets the line height of the top-level blocks `tr`'s selection touches.
 * Exported for 清除格式 (components/editor/format-marks.ts#clearRichFormatting).
 * Returns true when something changed.
 */
export function resetLineHeightInSelection(tr: Transaction): boolean {
  return setOn(tr, lineHeightTargets(tr.doc, tr.selection), null);
}

/**
 * The line height shared by every target block of the selection, or null when
 * they differ, none has one, or nothing selectable is selected. The 行高
 * dropdown shows this.
 */
export function activeLineHeight(editor: Editor): RichLineHeight | null {
  const targets = lineHeightTargets(editor.state.doc, editor.state.selection);
  if (targets.length === 0) return null;
  const first = lineHeightOf(targets[0].node);
  if (first == null) return null;
  return targets.every((t) => lineHeightOf(t.node) === first) ? first : null;
}

// ─── serializer: runs of top-level blocks ────────────────────────────────────

/** The subset of prosemirror-markdown's serializer state the wrapper needs. */
export interface TopLevelSerializerState {
  write(content?: string): void;
  closeBlock(node: PMNode): void;
  render(node: PMNode, parent: PMNode, index: number): void;
}

/**
 * Stands in for "the block that just closed" after a wrapper tag. renderList
 * compares `closed.type` with the next list's type to separate two adjacent
 * lists of the same kind; the wrapper already separates them, and must never
 * look like a list itself.
 */
const WRAPPER_CLOSED = { type: { name: '__lineHeightWrapper' } } as unknown as PMNode;

/** An empty paragraph serializes to nothing: it neither starts nor breaks a run. */
const isTransparent = (node: PMNode) => node.type.name === 'paragraph' && node.childCount === 0;

/**
 * Renders the document's (or a top-level slice's) children like
 * `renderContent`, wrapping each run of consecutive blocks with the same line
 * height in `<div data-lh="v">` + blank line … blank line + `</div>`.
 * Empty paragraphs inside a run stay inside it (so a stray empty line does not
 * split a run into two wrappers that the next save would merge); empty
 * paragraphs at a run's edges are rendered outside it.
 */
export function serializeTopLevelBlocks(state: TopLevelSerializerState, content: PMNode | Fragment): void {
  const parent = content as PMNode;
  const children: PMNode[] = [];
  content.forEach((child) => {
    children.push(child);
  });
  let i = 0;
  while (i < children.length) {
    const value = isTransparent(children[i]) ? null : lineHeightOf(children[i]);
    if (value == null) {
      state.render(children[i], parent, i);
      i += 1;
      continue;
    }
    // Extend over same-valued blocks and interior empty paragraphs.
    let last = i;
    for (let j = i + 1; j < children.length; j += 1) {
      if (isTransparent(children[j])) continue;
      if (lineHeightOf(children[j]) !== value) break;
      last = j;
    }
    state.write(`<div ${RICH_LINE_HEIGHT_ATTR}="${value}">`);
    state.closeBlock(WRAPPER_CLOSED);
    for (let k = i; k <= last; k += 1) state.render(children[k], parent, k);
    state.write('</div>');
    state.closeBlock(WRAPPER_CLOSED);
    i = last + 1;
  }
}

// ─── guard: never below the top level, never an unlisted value ──────────────

const guardKey = new PluginKey('lineHeightGuard');

/**
 * Containers already verified to hold no nested line height. ProseMirror nodes
 * are immutable and shared between document versions, so an untouched
 * top-level list is the SAME object in the next state — each transaction only
 * walks the top-level blocks it actually replaced.
 */
const cleanContainers = new WeakSet<PMNode>();

/** Positions of attribute values to clear: nested ones, and invalid ones at the top level. */
function invalidLineHeights(doc: PMNode): number[] {
  const out: number[] = [];
  doc.forEach((child, offset) => {
    const top = child.attrs[LINE_HEIGHT_NODE_ATTR];
    if (top != null && !isRichLineHeight(top)) out.push(offset);
    if (child.isTextblock || child.isLeaf || cleanContainers.has(child)) return;
    let found = false;
    child.descendants((node, pos) => {
      if (node.attrs[LINE_HEIGHT_NODE_ATTR] != null && TYPE_SET.has(node.type.name)) {
        out.push(offset + 1 + pos);
        found = true;
      }
      return !node.isTextblock;
    });
    if (!found) cleanContainers.add(child);
  });
  return out;
}

function clearAt(tr: Transaction, positions: readonly number[]): Transaction {
  for (const pos of positions) tr.setNodeAttribute(pos, LINE_HEIGHT_NODE_ATTR, null);
  return tr;
}

// ─── extension ───────────────────────────────────────────────────────────────

export const LineHeight = Extension.create({
  name: 'lineHeight',

  addStorage() {
    return {
      // tiptap-markdown calls this on the DOM it built from MARKDOWN (stored
      // bodies, markdown pasted as text) — never on pasted HTML.
      markdown: { parse: { updateDOM: (element: HTMLElement) => normalizeLineHeightDom(element) } },
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...LINE_HEIGHT_NODE_TYPES],
        attributes: {
          [LINE_HEIGHT_NODE_ATTR]: {
            default: null,
            // Enter at the end of a 2.0 paragraph continues at 2.0 (Word, Docs).
            keepOnSplit: true,
            parseHTML: (el: HTMLElement) => readLineHeightFromDom(el),
            // Editor DOM only (the markdown serializer never reads renderHTML):
            // the attribute on the block element is what app/rich-text.css styles.
            renderHTML: (attrs: Record<string, unknown>) =>
              isRichLineHeight(attrs[LINE_HEIGHT_NODE_ATTR]) ? { [RICH_LINE_HEIGHT_ATTR]: attrs[LINE_HEIGHT_NODE_ATTR] } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (value: string | number) =>
        ({ tr, dispatch }: CommandProps) => {
          const stored = normalizeLineHeight(value);
          if (stored == null) return false;
          const targets = lineHeightTargets(tr.doc, tr.selection);
          if (targets.length === 0) return false;
          if (dispatch) setOn(tr, targets, stored);
          return true;
        },
      unsetLineHeight:
        () =>
        ({ tr, dispatch }: CommandProps) => {
          const targets = lineHeightTargets(tr.doc, tr.selection);
          if (targets.length === 0) return false;
          if (dispatch) setOn(tr, targets, null);
          return true;
        },
    };
  },

  onCreate() {
    const { state, view } = this.editor;
    const bad = invalidLineHeights(state.doc);
    if (bad.length === 0) return;
    view.dispatch(clearAt(state.tr, bad).setMeta('addToHistory', false).setMeta('preventUpdate', true));
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: guardKey,
        appendTransaction(transactions: readonly Transaction[], _old: EditorState, newState: EditorState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const bad = invalidLineHeights(newState.doc);
          if (bad.length === 0) return null;
          // Recorded in history on purpose (prosemirror-history groups an
          // appended transaction with its root): undoing "wrap in a list" must
          // give the paragraph its line height back. With addToHistory:false the
          // strip would outlive the undo. A root that is itself out of history
          // (a normalizer, onCreate) keeps its appended strip out too.
          return clearAt(newState.tr, bad);
        },
      }),
    ];
  },
});
