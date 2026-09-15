// Where a BLOCK lands and where the caret goes next — the one placement rule
// every block insert in the house editor shares (image uploads, the table
// button, pasted content, typing on a selected card). React-free so the
// headless tests drive it directly (tests/editor-flow.test.ts).
//
// The rule, from the author's point of view: the block appears where the caret
// is, and the caret ends up on a TEXT line right after it, ready to keep
// writing. The two failures it replaces:
// - tiptap's `setImage` / `insertTable` REPLACE the empty paragraph the caret
//   sits in, so the line the author just made with Enter was eaten and the new
//   block became the end of the document;
// - after an atom insert the selection was a NodeSelection on the atom, so the
//   next keystroke silently deleted the image that was just uploaded.

import type { Node as PMNode, NodeType, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { canSplit } from '@tiptap/pm/transform';

/** Depth of the OUTERMOST table around `$pos`, or 0 when it is not in one. */
export function tableDepthAt($pos: ResolvedPos): number {
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    if ($pos.node(depth).type.spec.tableRole === 'table') return depth;
  }
  return 0;
}

/** Image, embed card, poll card, horizontal rule: a block you select, not type into. */
export function isBlockAtom(node: PMNode | null | undefined): boolean {
  return Boolean(node && node.isBlock && node.isAtom);
}

/**
 * Makes sure a paragraph starts at `pos` (a boundary between two blocks) and
 * returns the text position at its start. An existing paragraph right there is
 * reused — a batch of inserts must not stack blank lines — otherwise an empty
 * one is inserted. `reuse: 'empty'` reuses only an EMPTY paragraph (typing on a
 * selected card must open a new line, not prepend to the next paragraph).
 * null when the parent cannot hold a paragraph at `pos`.
 */
export function ensureParagraphAt(tr: Transaction, pos: number, opts: { reuse?: 'any' | 'empty' } = {}): number | null {
  const paragraph = tr.doc.type.schema.nodes.paragraph as NodeType | undefined;
  if (!paragraph) return null;
  const $pos = tr.doc.resolve(pos);
  if ($pos.parent.inlineContent) return null; // not a block boundary
  const next = $pos.nodeAfter;
  if (next?.type === paragraph && (opts.reuse !== 'empty' || next.content.size === 0)) return pos + 1;
  const index = $pos.index();
  if (!$pos.parent.canReplaceWith(index, index, paragraph)) return null;
  tr.insert(pos, paragraph.create());
  return pos + 1;
}

export interface PlacedBlock {
  /** Position of the inserted node in `tr.doc`. */
  nodePos: number;
  /** A text position right after the node (start of the paragraph that follows), or null. */
  caretPos: number | null;
}

export interface PlaceOptions {
  /** Tables: lift out of lists / blockquotes to the document top level. */
  topLevel?: boolean;
}

/**
 * Inserts `node` (a block) into `tr` at the caret-ish position `rawPos` and
 * guarantees a paragraph after it. Does NOT move the selection — callers decide
 * (an upload that finishes while the author types elsewhere must not yank the
 * caret). Placement:
 *
 * - inside a table ⇒ right after the table (a GFM cell is inline-only; a block
 *   in a cell degrades the whole table to raw HTML — components/markdown-table.ts);
 * - `topLevel` and inside a list / quote ⇒ after that top-level block;
 * - in an EMPTY textblock, or at the START of one ⇒ before it: the line stays
 *   (it is the line the author made) and becomes the line after the block;
 * - at the END of a non-empty textblock ⇒ a new empty paragraph is split off
 *   and the block goes before it;
 * - in the MIDDLE ⇒ split, the block between the halves;
 * - in a code block ⇒ after the code block;
 * - at a block boundary (gap cursor, after a node selection) ⇒ right there.
 */
export function placeBlockNode(tr: Transaction, node: PMNode, rawPos: number, opts: PlaceOptions = {}): PlacedBlock {
  const doc = tr.doc;
  const paragraph = doc.type.schema.nodes.paragraph as NodeType | undefined;
  const $raw = doc.resolve(Math.max(0, Math.min(rawPos, doc.content.size)));

  const insertAt = (pos: number, mode: 'before' | 'between'): PlacedBlock => {
    const $at = tr.doc.resolve(pos);
    const index = $at.index();
    let nodePos = pos;
    if ($at.parent.canReplaceWith(index, index, node.type)) {
      tr.insert(pos, node);
    } else {
      // e.g. an image as the FIRST child of a list item (`paragraph block*`):
      // let ProseMirror walk the hint out to a parent that accepts the node,
      // then find where it went from the step's own map.
      tr.replaceRangeWith(pos, pos, node);
      let end = pos + node.nodeSize;
      tr.mapping.maps[tr.mapping.maps.length - 1]?.forEach((_from, _to, _newFrom, newTo) => {
        end = newTo;
      });
      nodePos = end - node.nodeSize;
    }
    const after = nodePos + node.nodeSize;
    if (mode === 'before') {
      const next = tr.doc.resolve(after).nodeAfter;
      if (next?.isTextblock) return { nodePos, caretPos: after + 1 };
    }
    return { nodePos, caretPos: ensureParagraphAt(tr, after) };
  };

  const tableDepth = tableDepthAt($raw);
  if (tableDepth > 0) return insertAt($raw.after(tableDepth), 'between');
  if (opts.topLevel && $raw.depth > 1) return insertAt($raw.after(1), 'between');
  if (!$raw.parent.isTextblock) return insertAt($raw.pos, 'between');
  if ($raw.parent.type.spec.code) return insertAt($raw.after(), 'between');

  const depth = $raw.depth;
  const size = $raw.parent.content.size;
  if (size === 0 || $raw.parentOffset === 0) return insertAt($raw.before(depth), 'before');

  const atEnd = $raw.parentOffset === size;
  const typesAfter = atEnd && paragraph ? [{ type: paragraph }] : undefined;
  if (!canSplit(doc, $raw.pos, 1, typesAfter)) return insertAt($raw.after(depth), 'between');
  tr.split($raw.pos, 1, typesAfter);
  // After the split the boundary between the two halves is `pos + 1`; the
  // second half (the new empty paragraph when splitting at the end) follows.
  return insertAt($raw.pos + 1, 'before');
}

/** Sets a collapsed text caret at `pos` when it is a valid text position. */
export function setCaret(tr: Transaction, pos: number | null): Transaction {
  if (pos == null) return tr;
  const $pos = tr.doc.resolve(Math.max(0, Math.min(pos, tr.doc.content.size)));
  if (!$pos.parent.inlineContent) return tr;
  return tr.setSelection(TextSelection.create(tr.doc, $pos.pos));
}
