// GFM table support for the house editor, kept React-free so the headless
// round-trip test (tests/rte-table.test.ts) exercises the REAL extension set
// rather than a hand-rolled replica — the same reason
// components/zones/embeds/embed-node-extension.ts is a plain module.

import { Extension, getHTMLFromFragment, type Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode, type Slice } from '@tiptap/pm/model';
import { Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import Table, { createTable } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ensureParagraphAt, isBlockAtom, placeBlockNode, setCaret, tableDepthAt } from '@/components/editor/flow-insert';

// GFM tables. `resizable: false` — column widths would serialize as HTML,
// and markdown is the storage format; the reader renders plain GFM tables.
//
// The serializer below REPLACES tiptap-markdown's: GFM delimits cells with `|`,
// so a literal pipe inside a cell must be written `\|`, and the library renders
// cell content straight into the row (`state.renderInline`) while
// prosemirror-markdown's escaper leaves `|` alone. A cell holding `a | b`
// therefore came back as TWO cells on the next parse — opening a post in the
// editor and saving it silently corrupted the table (`| a \| b | ok |` →
// `| a | b | ok |`). We keep the library's walk so every other cell serializes
// byte-identically, and escape only the slice each cell produced; `parse` stays
// the default spec's (markdown-it already turns `\|` back into a pipe).
// `getMarkdownSpec` merges `{...defaultSpec, ...ourSpec}`, so overriding
// `serialize` alone is enough.

/**
 * True when the table is expressible as GFM: header row, no spans, ONE
 * PARAGRAPH per cell. A cell whose single block is a code block, a list, a
 * quote, a heading or a block image used to pass (only `childCount > 1` was
 * refused) — the row writer then rendered that block's newlines / blank lines
 * straight into the `| … |` row: a code block's second line became a new row
 * with the neighbouring cells shifted into it, a list ended the table and threw
 * the next cell out as a paragraph, a heading lost its `#`, an image-only cell
 * was written empty. Such a table now takes the raw-HTML path, like merged cells.
 */
function isGfmTable(node: PMNode): boolean {
  const rows: PMNode[] = [];
  node.forEach((row) => rows.push(row));
  if (rows.length === 0) return false;
  const unusable = (cell: PMNode, wantHeader: boolean) =>
    (wantHeader ? cell.type.name !== 'tableHeader' : cell.type.name === 'tableHeader') ||
    (cell.attrs.colspan ?? 1) > 1 ||
    (cell.attrs.rowspan ?? 1) > 1 ||
    cell.childCount !== 1 ||
    cell.firstChild?.type.name !== 'paragraph';
  let ok = true;
  rows[0].forEach((cell) => {
    if (unusable(cell, true)) ok = false;
  });
  for (const row of rows.slice(1)) {
    row.forEach((cell) => {
      if (unusable(cell, false)) ok = false;
    });
  }
  return ok;
}

// ── Moving around and out of a table ─────────────────────────────────────────
// A GFM cell holds ONE line of inline content, so the keys an author reaches for
// first must not build a cell markdown cannot store:
// - Enter / Shift-Enter in a cell insert a HARD BREAK. Enter used to split the
//   cell's paragraph, `isGfmTable` then refused the table and the whole thing
//   was silently stored as raw `<table style=…>` HTML. A hard break inside a
//   cell serializes as `<br>` (tiptap-markdown's hardBreak spec checks
//   `state.inTable`, which the serializer below sets) — never `\` + newline,
//   which would end the table row — and parses back to a hard break.
// - Mod-Enter leaves the table: the caret lands on the (empty, created if
//   needed) line after it.
// - ArrowDown on the last row / ArrowRight at the end of the last cell land on
//   the block after the table instead of an invisible gap cursor.
// ORDER MATTERS: RichTextEditor registers TABLE_EXTENSIONS BEFORE
// MentionSuggestion. tiptap runs same-priority plugins in REVERSE registration
// order, so the @人 popup's key handler sees Enter / arrows first and a cell
// line break happens only when the popup declined the key (tests/mention-editor
// pins it). Registered after it, Enter in a cell would insert a break instead
// of picking the highlighted person.

type TableRoleSpec = { tableRole?: string };
const roleOf = (node: PMNode): string | undefined => (node.type.spec as TableRoleSpec).tableRole;
const isCellRole = (role: string | undefined) => role === 'cell' || role === 'header_cell';

/** Enter / Shift-Enter inside a cell: a hard break (GFM `<br>`), never a second paragraph. */
function cellLineBreak(editor: Editor): boolean {
  const { state } = editor;
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return false;
  const { $from } = sel;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code || $from.depth < 1) return false;
  if (!isCellRole(roleOf($from.node(-1)))) return false;
  const hardBreak = state.schema.nodes.hardBreak;
  if (!hardBreak) return false;
  editor.view.dispatch(state.tr.replaceSelectionWith(hardBreak.create(), true).scrollIntoView());
  return true;
}

/** Selection anchor used to find "the table the caret is in" (a CellSelection has no text caret). */
function tableAnchor(state: EditorState) {
  const sel = state.selection;
  return sel instanceof CellSelection ? sel.$anchorCell : sel.$from;
}

/**
 * A text line directly above / below the table the selection is in: an EMPTY
 * paragraph already there is reused (pressing twice does not stack blank
 * lines), otherwise one is inserted. null outside a table. Backs the
 * TableToolbar 「在表格上方/下方插入段落」 buttons and Mod-Enter.
 */
export function paragraphBesideTableTr(state: EditorState, side: 'before' | 'after'): Transaction | null {
  const $pos = tableAnchor(state);
  const depth = tableDepthAt($pos);
  if (!depth) return null;
  const tr = state.tr;
  if (side === 'after') {
    const caret = ensureParagraphAt(tr, $pos.after(depth), { reuse: 'empty' });
    return caret == null ? null : setCaret(tr, caret).scrollIntoView();
  }
  const paragraph = state.schema.nodes.paragraph;
  const before = $pos.before(depth);
  const $before = tr.doc.resolve(before);
  const prev = $before.nodeBefore;
  if (paragraph && prev?.type === paragraph && prev.content.size === 0) return setCaret(tr, before - 1).scrollIntoView();
  const index = $before.index();
  if (!paragraph || !$before.parent.canReplaceWith(index, index, paragraph)) return null;
  tr.insert(before, paragraph.create());
  return setCaret(tr, before + 1).scrollIntoView();
}

/** Toolbar / command form of paragraphBesideTableTr. */
export function insertParagraphBesideTable(editor: Editor, side: 'before' | 'after'): boolean {
  const tr = paragraphBesideTableTr(editor.state, side);
  if (!tr) return false;
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

/**
 * ArrowDown in the table's LAST ROW (on the cell's last line) / ArrowRight at
 * the very end of the LAST CELL: the caret goes to the block after the table —
 * into it when it holds text, onto a new paragraph when it is another table,
 * a card or nothing. prosemirror-tables alone answered with a gap cursor that
 * nobody could see.
 */
export function arrowOutOfTableTr(
  state: EditorState,
  dir: 'down' | 'right',
  atVisualEnd: () => boolean = () => true,
): Transaction | null {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return null;
  const $h = sel.$head;
  let tableDepth = 0;
  for (let d = $h.depth; d > 0; d -= 1) {
    if (roleOf($h.node(d)) === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (!tableDepth || $h.depth < tableDepth + 3) return null;
  const table = $h.node(tableDepth);
  if ($h.index(tableDepth) !== table.childCount - 1) return null; // not the last row
  if (dir === 'right' && $h.index(tableDepth + 1) !== $h.node(tableDepth + 1).childCount - 1) return null; // not the last cell
  // Inside the cell: on its last block…
  for (let d = $h.depth - 1; d >= tableDepth + 2; d -= 1) {
    if ($h.indexAfter(d) !== $h.node(d).childCount) return null;
  }
  // …at the end of it (ArrowRight), or on its last visual line (ArrowDown).
  if (dir === 'right' && $h.parentOffset !== $h.parent.content.size) return null;
  if (!atVisualEnd()) return null;

  const after = $h.after(tableDepth);
  const tr = state.tr;
  const next = tr.doc.resolve(after).nodeAfter;
  if (next && !isBlockAtom(next) && roleOf(next) !== 'table') {
    const target = Selection.findFrom(tr.doc.resolve(after), 1, true);
    if (target) return tr.setSelection(target).scrollIntoView();
  }
  const caret = ensureParagraphAt(tr, after);
  return caret == null ? null : setCaret(tr, caret).scrollIntoView();
}

function runArrowOut(editor: Editor, dir: 'down' | 'right'): boolean {
  const { view } = editor;
  const tr = arrowOutOfTableTr(editor.state, dir, () => {
    try {
      return view.endOfTextblock(dir);
    } catch {
      return true; // no layout (headless): the structural checks above stand
    }
  });
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

const MarkdownTable = Table.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () => cellLineBreak(this.editor),
      'Shift-Enter': () => cellLineBreak(this.editor),
      'Mod-Enter': () => {
        const tr = paragraphBesideTableTr(this.editor.state, 'after');
        if (!tr) return false;
        this.editor.view.dispatch(tr);
        return true;
      },
      ArrowDown: () => runArrowOut(this.editor, 'down'),
      ArrowRight: () => runArrowOut(this.editor, 'right'),
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      // The 插入表格 button. tiptap's own command `replaceSelectionWith`s the
      // table: it ate the empty line the caret was on, nested the table inside a
      // list item / quote, and nested a table inside a CELL (markdown cannot say
      // either — both were stored as raw HTML). Now: refused inside a table
      // (which is what disables the button there), lifted to the top level out
      // of lists / quotes, placed by the shared block rule
      // (components/editor/flow-insert.ts) with a text line after it, and the
      // caret in the first cell.
      insertTable:
        ({ rows = 3, cols = 3, withHeaderRow = true } = {}) =>
        ({ tr, dispatch, editor }) => {
          const sel = tr.selection;
          if (tableDepthAt(tr.doc.resolve(sel.from)) > 0 || sel instanceof CellSelection) return false;
          if (dispatch) {
            const node = createTable(editor.schema, rows, cols, withHeaderRow);
            // `to`: after a node-selected image, never replacing it; after selected text, never deleting it.
            const placed = placeBlockNode(tr, node, sel.to, { topLevel: true });
            tr.setSelection(TextSelection.near(tr.doc.resolve(placed.nodePos + 1))).scrollIntoView();
          }
          return true;
        },
    };
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: PMNode) {
          if (!isGfmTable(node)) {
            // Merged cells or a cell holding anything but one paragraph: markdown
            // cannot say it, so the table rides as raw HTML (what the library
            // does too — `html: true`).
            state.write(htmlBlockSafe(getHTMLFromFragment(Fragment.from(node), node.type.schema)));
            state.closeBlock(node);
            return;
          }
          state.inTable = true;
          node.forEach((row, _rowOffset, rowIndex) => {
            state.write('| ');
            row.forEach((cell, _cellOffset, cellIndex) => {
              if (cellIndex) state.write(' | ');
              const content = cell.firstChild;
              // A cell whose only content is a 表情包 (an inline atom) has no
              // text — `textContent.trim()` alone wrote it as an empty cell.
              if (content && (content.textContent.trim() || hasInlineNode(content))) {
                const start = state.out.length;
                state.renderInline(content);
                state.out = state.out.slice(0, start) + state.out.slice(start).replace(/\|/g, String.raw`\|`);
              }
            });
            state.write(' |');
            state.ensureNewLine();
            if (!rowIndex) {
              // GFM alignment is per column and lives in the delimiter row; the
              // header cells carry it (`align`, parsed from markdown-it's
              // `style="text-align:…"`). It used to be written as `---` always,
              // so every edit left-aligned a numeric column.
              const delims: string[] = [];
              row.forEach((cell) => delims.push(ALIGN_DELIMITER[cell.attrs.align as string] ?? '---'));
              state.write(`| ${delims.join(' | ')} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
      },
    };
  },
});

// ── Column alignment ─────────────────────────────────────────────────────────
// `| :--- | :---: | ---: |` — markdown-it renders it as `style="text-align:…"`
// on every th / td. The stock cells have no attribute for it, so it was dropped
// on load and the delimiter row above was always `---`.

const ALIGN_VALUES = new Set(['left', 'center', 'right']);
const ALIGN_DELIMITER: Record<string, string> = { left: ':---', center: ':---:', right: '---:' };

const alignAttribute = {
  align: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => {
      const value = (el.style?.textAlign || el.getAttribute('align') || '').toLowerCase();
      return ALIGN_VALUES.has(value) ? value : null;
    },
    // `style` for the editor (it beats the stylesheet's `text-align: left`),
    // `align` for a raw-HTML table in the reader (its sanitizer drops `style`
    // and keeps `align` on th / td).
    renderHTML: (attrs: Record<string, unknown>) =>
      typeof attrs.align === 'string' && ALIGN_VALUES.has(attrs.align) ? { style: `text-align: ${attrs.align}`, align: attrs.align } : {},
  },
};

const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute };
  },
});

const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute };
  },
});

/** True when `node` (a textblock) holds a non-text inline node — a sticker, a hard break. */
function hasInlineNode(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (!child.isText) found = true;
  });
  return found;
}

/**
 * Raw HTML as a markdown HTML BLOCK ends at the first blank line — in
 * markdown-it (the editor) and in remark (the reader) alike. The only newlines
 * in serialized table HTML are text inside `<pre>` (a code block in a cell), so
 * a blank line there cut the table in half on the next open. Each newline that
 * would start a blank line is written as the `&#10;` entity instead: the same
 * character once parsed, but no line of the source is empty.
 */
function htmlBlockSafe(html: string): string {
  let out = html;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/\n([ \t]*)\n/g, '\n$1&#10;');
  } while (out !== prev);
  return out;
}

// ── Block types refused inside a cell ────────────────────────────────────────
// A GFM cell is one line of inline content. Heading / list / quote / code block
// in a cell are legal tiptap documents, but the table then has to be stored as
// raw HTML (isGfmTable) — exactly the degradation the cell Enter rule avoids.
// So their toolbar buttons are disabled there (RichTextEditor asks
// `caretInTableCell`) and their shortcuts are swallowed. The markdown input
// rules (`- `, `> `, "```", `# `) and pasted blocks still get through: the
// serializer's HTML path is the backstop that keeps every cell's content.

/** True when the selection (a caret, a text range or a CellSelection) is inside a table cell. */
export function caretInTableCell(state: EditorState): boolean {
  const $pos = tableAnchor(state);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (isCellRole(roleOf($pos.node(depth)))) return true;
  }
  return state.selection instanceof CellSelection;
}

const BLOCK_TYPE_SHORTCUTS = ['Mod-Alt-c', 'Mod-Shift-7', 'Mod-Shift-8', 'Mod-Shift-b', 'Mod-Alt-1', 'Mod-Alt-2', 'Mod-Alt-3', 'Mod-Alt-4', 'Mod-Alt-5', 'Mod-Alt-6'];

/** Priority 102: above CodeBlockBase (101), whose Mod-Alt-c would otherwise run first. */
const TableCellBlockGuard = Extension.create({
  name: 'tableCellBlockGuard',
  priority: 102,
  addKeyboardShortcuts() {
    return Object.fromEntries(BLOCK_TYPE_SHORTCUTS.map((key) => [key, () => caretInTableCell(this.editor.state)]));
  },
});

const TABLE_EXTENSIONS = [MarkdownTable.configure({ resizable: false }), TableRow, AlignedTableHeader, AlignedTableCell, TableCellBlockGuard];

// ── Keeping BLOCK atoms out of cells ─────────────────────────────────────────
// A GFM cell is inline-only, but tiptap's cells are `block+`: an image pasted
// with the caret in a cell, or an embed / poll card dragged into one, is a
// legal document that markdown cannot say. `isGfmTable` then refuses the table
// and the WHOLE thing is stored as raw `<table style=…>` HTML — and an embed
// inside a cell is no longer an own-line token, so the reader never resolves
// it (silently invisible). Narrowing the cells to `paragraph+` was measured and
// rejected: ProseMirror then TEARS an already-stored table apart at the offending
// cell when it parses it, which loses more than it saves. The editor instead
// keeps block atoms out at the three doors they can come through — insertion
// (`tableEscapePos`), an in-editor drag (`isInsideTable` + `sliceHasBlockAtom`)
// and a PASTE (`pasteEscapePos`): a markdown `![x](…)` pasted as TEXT is parsed
// by tiptap-markdown into a block image before `handlePaste` ever sees it, so
// ProseMirror's own paste drops it straight into the cell.

/**
 * Where a BLOCK insert must go when the caret sits inside a table: right after
 * the table. null when the selection is not in one (insert at the caret).
 */
function tableEscapePos(state: EditorState): number | null {
  const { $to } = state.selection;
  for (let depth = $to.depth; depth > 0; depth -= 1) {
    if ($to.node(depth).type.spec.tableRole === 'table') return $to.after(depth);
  }
  return null;
}

/** True when `pos` resolves inside a table (any cell / row / the table itself). */
function isInsideTable(state: EditorState, pos: number): boolean {
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size));
  const $pos = state.doc.resolve(clamped);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.tableRole === 'table') return true;
  }
  return false;
}

/**
 * Where a PASTED slice must go when it carries a block atom and the caret sits
 * in a table cell: right after the table. null ⇒ paste where the caret is.
 * The same lift as `tableEscapePos`, for the door the caret rule cannot cover —
 * the slice is already parsed by the time `handlePaste` runs, so the check has
 * to be on the slice, not on what was typed.
 */
function pasteEscapePos(state: EditorState, slice: Slice): number | null {
  return sliceHasBlockAtom(slice) ? tableEscapePos(state) : null;
}

/** True when a dragged slice carries a block atom (image / embed card / poll). */
function sliceHasBlockAtom(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((node) => {
    if (found) return false;
    if (node.isBlock && node.isAtom) found = true;
    return !found;
  });
  return found;
}

export { MarkdownTable, TABLE_EXTENSIONS, isGfmTable, isInsideTable, pasteEscapePos, sliceHasBlockAtom, tableEscapePos };
