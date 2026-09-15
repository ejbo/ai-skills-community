// FlowExtension — "you can always keep writing after a block". React-free, so
// tests/editor-flow.test.ts drives the real thing headless. Registered once in
// components/RichTextEditor.tsx (and mirrored in the tests that replicate its
// extension list).
//
// What it owns, and the bug each part answers (the live repro is S1–S12 in the
// 2026-09-14 editor research):
//
// 1. TRAILING PARAGRAPH. The document always ends in a paragraph. Markdown
//    cannot store an empty trailing paragraph, so every body that ENDS in a
//    table / image / card / code block / quote / list re-opened with nowhere
//    to type below it — the caret sat inside the last cell or ON the image,
//    and the only way out was an invisible 20 px gap cursor. The empty
//    paragraph serializes to nothing, so it never changes the stored markdown.
//    It is appended with `addToHistory: false` (otherwise Undo lights up on a
//    pristine editor and undo/redo ping-pong with the plugin), through
//    appendTransaction (tiptap emits `update` only for the ROOT transaction, so
//    it never makes a pristine composer dirty) plus one `preventUpdate`
//    microtask for the initially loaded document, which has no transaction.
// 2. CARET AFTER PASTE / DROP. ProseMirror leaves the selection at the "end" of
//    the inserted slice: a NodeSelection on a trailing image / rule / card
//    (the next keystroke deleted it), or inside the LAST CELL of a pasted table.
//    After a paste or an external drop that ends in such a block, the caret is
//    put on a text line right after it.
// 3. TYPING ON A SELECTED BLOCK ATOM. With an image / card / poll / rule
//    node-selected, a printable key (keypress, `insertText`, the start of an IME
//    composition) and Enter open a paragraph AFTER the node and type there,
//    instead of replacing the node. Backspace / Delete still delete it.
// 4. CLICK BELOW THE LAST BLOCK puts the caret in the trailing paragraph.
// 5. POSITION-STABLE BLOCK INSERTS for async uploads (`beginInsertBatch`): each
//    image of a batch lands where the batch was started, in completion order,
//    and the caret follows only while the author has not moved it. Before,
//    every finished upload was inserted at whatever the selection was — which
//    after the first image was a NodeSelection ON that image, so a 3-image pick
//    at the end of a post kept only the last one.
//
// It also brings FlowMarkdownSerializer (components/editor/flow-markdown.ts).

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { FlowMarkdownSerializer } from './flow-markdown';
import { ensureParagraphAt, isBlockAtom, placeBlockNode, setCaret, type PlacedBlock } from './flow-insert';

export const flowTrailingKey = new PluginKey('flowTrailingParagraph');
export const flowCaretKey = new PluginKey('flowCaret');
export const flowBatchKey = new PluginKey<ReadonlyMap<string, InsertBatch>>('flowInsertBatch');

// ── 1. trailing paragraph ─────────────────────────────────────────────────────

/** The transaction that appends the trailing paragraph, or null when the doc already ends in one. */
export function trailingParagraphTr(state: EditorState): Transaction | null {
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return null;
  const last = state.doc.lastChild;
  if (last && last.type === paragraph) return null;
  return state.tr.insert(state.doc.content.size, paragraph.create()).setMeta('addToHistory', false);
}

function trailingParagraphPlugin(): Plugin {
  return new Plugin({
    key: flowTrailingKey,
    view: (view) => {
      // The document the editor was created with has no transaction for
      // appendTransaction to see. Deferred a microtask (dispatching during view
      // construction is not allowed) — which still runs before tiptap's
      // `autofocus: 'end'`, a setTimeout — and flagged `preventUpdate` like the
      // poll / embed normalizers, so onChange never fires for it.
      queueMicrotask(() => {
        if (view.isDestroyed) return;
        const tr = trailingParagraphTr(view.state);
        if (tr) view.dispatch(tr.setMeta('preventUpdate', true));
      });
      return {};
    },
    // Runs for undo / redo too: an undo that removes the last paragraph must not
    // leave the document ending in a table again.
    appendTransaction: (_trs, _old, state) => trailingParagraphTr(state),
  });
}

// ── 3. typing on a selected block atom ───────────────────────────────────────

/**
 * With a block atom node-selected: a transaction that opens a paragraph right
 * after it (reusing an EMPTY one already there) and types `text` into it.
 * null when the selection is anything else.
 */
export function typeAfterSelectedAtom(state: EditorState, text: string): Transaction | null {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || !isBlockAtom(sel.node)) return null;
  const tr = state.tr;
  const caret = ensureParagraphAt(tr, sel.to, { reuse: 'empty' });
  if (caret == null) return null;
  if (text) tr.insertText(text, caret);
  setCaret(tr, caret + text.length);
  return tr.scrollIntoView();
}

// ── 2 + 3 + 4. caret plugin ───────────────────────────────────────────────────

/** End (in `tr.doc`) of the content the last replace step of `tr` inserted. */
function insertionEnd(tr: Transaction): number | null {
  for (let i = tr.steps.length - 1; i >= 0; i -= 1) {
    const step = tr.steps[i];
    if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) continue;
    let end: number | null = null;
    tr.mapping.maps[i].forEach((_from, _to, _newFrom, newTo) => {
      end = newTo;
    });
    if (end == null) return null;
    return tr.mapping.slice(i + 1).map(end, -1);
  }
  return null;
}

/** True when a replace step of `tr` inserted a node of the named type. */
function stepsInserted(tr: Transaction, typeName: string): boolean {
  return tr.steps.some((step) => {
    if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) return false;
    let found = false;
    // `slice` is public on both step classes; typed loosely across pm versions.
    (step as unknown as { slice: { content: { descendants: (f: (n: PMNode) => boolean) => void } } }).slice.content.descendants((n) => {
      if (n.type.name === typeName) found = true;
      return !found;
    });
    return found;
  });
}

/** Blocks the caret must not be left on / inside after a paste. */
function isHardEnd(node: PMNode | null | undefined): boolean {
  return Boolean(node && (isBlockAtom(node) || node.type.spec.tableRole === 'table' || node.type.spec.code));
}

function caretPlugin(): Plugin {
  // handleDrop says whether a drop MOVES content inside the editor; the drop
  // transaction itself does not carry that. A moved card stays selected (you
  // are rearranging it, and rule 3 keeps typing from deleting it).
  let lastDropMoved = false;

  return new Plugin({
    key: flowCaretKey,
    appendTransaction: (trs, _old, state) => {
      const first = trs[0];
      if (!first) return null;
      const root = (first.getMeta('appendedTransaction') as Transaction | undefined) ?? first;
      const ui = root.getMeta('uiEvent');
      if (ui !== 'paste' && ui !== 'drop') return null;
      if (ui === 'drop' && lastDropMoved) return null;
      if (!root.docChanged) return null;

      const sel = state.selection;
      let after: number | null = null;

      // A pasted / dropped image, rule or card — or a token paragraph the
      // poll / embed normalizer just turned into a card — is node-selected.
      if (sel instanceof NodeSelection && isBlockAtom(sel.node)) after = sel.to;

      // The slice ENDS in a table / atom / code block: the caret belongs after
      // it, not in the last cell. Only on the pass that still sees the root.
      if (after == null && first === root) {
        let end = insertionEnd(root);
        if (end != null) {
          for (const tr of trs.slice(1)) end = tr.mapping.map(end, -1);
          const $end = state.doc.resolve(Math.min(end, state.doc.content.size));
          if (!$end.parent.inlineContent && isHardEnd($end.nodeBefore)) after = $end.pos;
        }
      }

      // A pasted fenced block leaves the caret at the end of its code (the
      // slice is open into the code block, so the end rule cannot see it).
      if (after == null && sel.empty) {
        const $h = sel.$head;
        if ($h.parent.type.spec.code && $h.parentOffset === $h.parent.content.size && stepsInserted(root, $h.parent.type.name)) {
          after = $h.after();
        }
      }

      if (after == null) return null;
      const tr = state.tr;
      const caret = ensureParagraphAt(tr, after);
      if (caret == null) return null;
      return setCaret(tr, caret).scrollIntoView();
    },
    props: {
      handleDrop: (_view, _event, _slice, moved) => {
        lastDropMoved = moved;
        return false;
      },
      handleTextInput: (view, _from, _to, text) => {
        const tr = typeAfterSelectedAtom(view.state, text);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
      handleDOMEvents: {
        beforeinput: (view, event) => {
          const e = event as InputEvent;
          if (!(view.state.selection instanceof NodeSelection)) return false;
          if (e.inputType === 'insertCompositionText') {
            // Open the paragraph and let the composition continue in it (the
            // same move prosemirror-gapcursor makes for a gap cursor).
            const tr = typeAfterSelectedAtom(view.state, '');
            if (tr) view.dispatch(tr);
            return false;
          }
          if (e.inputType === 'insertText' && e.data) {
            const tr = typeAfterSelectedAtom(view.state, e.data);
            if (!tr) return false;
            e.preventDefault();
            view.dispatch(tr);
            return true;
          }
          return false;
        },
        compositionstart: (view) => {
          const tr = typeAfterSelectedAtom(view.state, '');
          if (tr) view.dispatch(tr);
          return false;
        },
        mousedown: (view, event) => {
          const e = event as MouseEvent;
          if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
          if (!view.editable || e.target !== view.dom) return false;
          const { doc } = view.state;
          const last = doc.lastChild;
          if (!last) return false;
          const dom = view.nodeDOM(doc.content.size - last.nodeSize);
          if (!(dom instanceof HTMLElement)) return false;
          // Only the empty band BELOW the last block: clicks beside a block or in
          // the top padding stay ProseMirror's (and the gap cursor's).
          if (e.clientY <= dom.getBoundingClientRect().bottom) return false;
          e.preventDefault();
          view.dispatch(view.state.tr.setSelection(Selection.atEnd(doc)).scrollIntoView());
          view.focus();
          return true;
        },
      },
    },
  });
}

// ── 5. position-stable block inserts ─────────────────────────────────────────

export interface InsertBatch {
  /** Where the next block of the batch goes (mapped through every change). */
  pos: number;
  /** 1 until the first insert (typing at the caret pushes the spot along); -1 after (the next block goes BEFORE what gets typed below the previous one). */
  assoc: 1 | -1;
  /** The selection when the batch started / after its last insert, mapped. */
  selFrom: number;
  selTo: number;
  /** The caret follows the inserts until the author moves it once. */
  follow: boolean;
}

interface BatchMeta {
  set?: { id: string; batch: InsertBatch };
  remove?: string;
}

function batchPlugin(): Plugin<ReadonlyMap<string, InsertBatch>> {
  return new Plugin<ReadonlyMap<string, InsertBatch>>({
    key: flowBatchKey,
    state: {
      init: () => new Map(),
      apply(tr, value) {
        let next = value;
        if (tr.docChanged && value.size > 0) {
          const mapped = new Map<string, InsertBatch>();
          for (const [id, b] of value) {
            mapped.set(id, {
              ...b,
              pos: tr.mapping.map(b.pos, b.assoc),
              selFrom: tr.mapping.map(b.selFrom, -1),
              selTo: tr.mapping.map(b.selTo, 1),
            });
          }
          next = mapped;
        }
        const meta = tr.getMeta(flowBatchKey) as BatchMeta | undefined;
        if (meta) {
          const copy = new Map(next);
          if (meta.set) copy.set(meta.set.id, meta.set.batch);
          if (meta.remove) copy.delete(meta.remove);
          next = copy;
        }
        return next;
      },
    },
  });
}

let batchSeq = 0;

/**
 * Starts a batch of block inserts at `rawPos` (default: the end of the
 * selection — never replacing it, an upload finishing later must not delete
 * text the author selected meanwhile). Returns the batch id.
 */
export function beginInsertBatch(view: EditorView, rawPos?: number): string {
  batchSeq += 1;
  const id = `flow-${batchSeq}`;
  const sel = view.state.selection;
  const pos = Math.max(0, Math.min(rawPos ?? sel.to, view.state.doc.content.size));
  if (flowBatchKey.getState(view.state)) {
    const batch: InsertBatch = { pos, assoc: 1, selFrom: sel.from, selTo: sel.to, follow: true };
    view.dispatch(view.state.tr.setMeta(flowBatchKey, { set: { id, batch } } satisfies BatchMeta).setMeta('addToHistory', false));
  }
  return id;
}

export interface InsertIntoBatchOptions {
  /**
   * Where to place the node instead of the batch's own tracked position — the
   * in-body file upload passes its placeholder's mapped position, so a card
   * lands exactly where its "uploading" widget was shown.
   */
  at?: number;
  /** placeBlockNode's `topLevel` (embed cards must be top-level own-line tokens). */
  topLevel?: boolean;
  /** Last touch on the transaction before it is dispatched (e.g. removing the placeholder in the same undoable step). */
  configure?: (tr: Transaction, placed: PlacedBlock) => void;
}

/**
 * Inserts `node` for the batch (see placeBlockNode for where) as ONE undoable
 * step. The caret moves onto the text line after the block only while the
 * author has not moved it since the batch started; focus is taken back only
 * from nowhere (the file dialog / body), never from another field.
 */
export function insertIntoBatch(view: EditorView, id: string, node: PMNode, opts: InsertIntoBatchOptions = {}): boolean {
  if (view.isDestroyed) return false;
  const state = view.state;
  const sel = state.selection;
  const batch = flowBatchKey.getState(state)?.get(id);
  const follow = batch ? batch.follow && sel.from === batch.selFrom && sel.to === batch.selTo : true;
  const tr = state.tr;
  const placed = placeBlockNode(tr, node, opts.at ?? (batch ? batch.pos : sel.to), { topLevel: opts.topLevel });
  if (follow && placed.caretPos != null) setCaret(tr, placed.caretPos);
  opts.configure?.(tr, placed);
  if (batch) {
    const nextPos = placed.caretPos ?? placed.nodePos + node.nodeSize;
    tr.setMeta(flowBatchKey, {
      set: { id, batch: { pos: nextPos, assoc: -1, selFrom: tr.selection.from, selTo: tr.selection.to, follow } },
    } satisfies BatchMeta);
  }
  view.dispatch(follow ? tr.scrollIntoView() : tr);
  if (follow && !view.hasFocus()) {
    const active = view.dom.ownerDocument.activeElement;
    if (!active || active === view.dom.ownerDocument.body || view.dom.contains(active)) view.focus();
  }
  return true;
}

/** Forgets a batch once its last upload settled (inserted or failed). */
export function endInsertBatch(view: EditorView, id: string): void {
  if (view.isDestroyed || !flowBatchKey.getState(view.state)?.has(id)) return;
  view.dispatch(view.state.tr.setMeta(flowBatchKey, { remove: id } satisfies BatchMeta).setMeta('addToHistory', false));
}

// ── the extension ─────────────────────────────────────────────────────────────

export const FlowExtension = Extension.create({
  name: 'editorFlow',

  addExtensions() {
    return [FlowMarkdownSerializer];
  },

  addKeyboardShortcuts() {
    return {
      // With a card / image / rule selected, Enter opens the line AFTER it —
      // ProseMirror's createParagraphNear puts it BEFORE when the node is the
      // first block, which reads as "Enter did nothing".
      Enter: ({ editor }) => {
        const tr = typeAfterSelectedAtom(editor.state, '');
        if (!tr) return false;
        editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [trailingParagraphPlugin(), caretPlugin(), batchPlugin()];
  },
});
