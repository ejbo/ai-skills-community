// GFM table support for the house editor, kept React-free so the headless
// round-trip test (tests/rte-table.test.ts) exercises the REAL extension set
// rather than a hand-rolled replica — the same reason
// components/zones/embeds/embed-node-extension.ts is a plain module.

import { getHTMLFromFragment } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

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

/** True when the table is expressible as GFM: header row, no spans, one block per cell. */
function isGfmTable(node: PMNode): boolean {
  const rows: PMNode[] = [];
  node.forEach((row) => rows.push(row));
  if (rows.length === 0) return false;
  const unusable = (cell: PMNode, wantHeader: boolean) =>
    (wantHeader ? cell.type.name !== 'tableHeader' : cell.type.name === 'tableHeader') ||
    (cell.attrs.colspan ?? 1) > 1 ||
    (cell.attrs.rowspan ?? 1) > 1 ||
    cell.childCount > 1;
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

const MarkdownTable = Table.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: PMNode) {
          if (!isGfmTable(node)) {
            // Merged cells or a multi-block cell: markdown cannot say it, so the
            // table rides as raw HTML (what the library does too — `html: true`).
            state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema));
            state.closeBlock(node);
            return;
          }
          state.inTable = true;
          node.forEach((row, _rowOffset, rowIndex) => {
            state.write('| ');
            row.forEach((cell, _cellOffset, cellIndex) => {
              if (cellIndex) state.write(' | ');
              const content = cell.firstChild;
              if (content && content.textContent.trim()) {
                const start = state.out.length;
                state.renderInline(content);
                state.out = state.out.slice(0, start) + state.out.slice(start).replace(/\|/g, String.raw`\|`);
              }
            });
            state.write(' |');
            state.ensureNewLine();
            if (!rowIndex) {
              state.write(`| ${Array.from({ length: row.childCount }, () => '---').join(' | ')} |`);
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

const TABLE_EXTENSIONS = [MarkdownTable.configure({ resizable: false }), TableRow, TableHeader, TableCell];

export { MarkdownTable, TABLE_EXTENSIONS, isGfmTable };
