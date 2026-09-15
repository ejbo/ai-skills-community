// @vitest-environment jsdom
// Pins the GFM table round trip of the editor's extension set: StarterKit has
// no table node, so before @tiptap/extension-table was registered a stored
// `| a | b |` body re-opened as flattened text and was destroyed on the next
// save. tiptap-markdown ships a table serializer (first row = tableHeader
// cells) and markdown-it parses GFM tables — this is the contract the
// RichTextEditor relies on. The extension list is imported from
// components/markdown-table.ts so this pins the SHIPPED serializer, including
// its pipe escaping (a cell holding `|` used to split into two cells).
//
// 2026-09-14: the image node is now the SHIPPED BasePathImage
// (components/editor/flow-image.ts) instead of stock @tiptap/extension-image,
// and two expectations that pinned the OLD behaviour were flipped — see the
// "used to" notes on the cell Enter / image-in-cell / nested-table tests.
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { beginInsertBatch, insertIntoBatch } from '@/components/editor/flow-extension';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { caretInTableCell, isGfmTable, isInsideTable, pasteEscapePos, sliceHasBlockAtom, tableEscapePos } from '@/components/markdown-table';

function makeEditor(content: string) {
  // The REAL list (components/editor/rich-text-extensions.ts), with the embed
  // node the 技术专区 composer registers.
  return new Editor({ extensions: buildRichTextExtensions({ embed: {} }), content });
}

const TABLE_MD = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

/** Caret inside the first data cell. */
function caretInFirstCell(ed: Editor): number {
  let at = -1;
  ed.state.doc.descendants((n, pos) => {
    if (at < 0 && n.type.name === 'tableCell') at = pos + 2;
    return true;
  });
  ed.commands.setTextSelection(at);
  return at;
}

const typeNames = (ed: Editor) => {
  const out = new Set<string>();
  ed.state.doc.descendants((n) => {
    out.add(n.type.name);
    return true;
  });
  return out;
};

describe('GFM tables in the editor', () => {
  it('a markdown table loads as a table node and serializes back as a GFM table', () => {
    const ed = makeEditor('| a | b |\n|---|---|\n| 1 | 2 |');
    const types = typeNames(ed);
    expect(types.has('table')).toBe(true);
    expect(types.has('tableHeader')).toBe(true);
    expect(types.has('tableCell')).toBe(true);
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain('| a | b |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('| 1 | 2 |');
    ed.destroy();
  });

  it('survives a second round trip (edit → save → reopen) unchanged', () => {
    const ed = makeEditor('intro\n\n| 名称 | 值 |\n| --- | --- |\n| x | **1** |\n| y | 2 |\n\nafter');
    const once = ed.storage.markdown.getMarkdown();
    ed.commands.setContent(once, false);
    expect(ed.storage.markdown.getMarkdown()).toBe(once);
    expect(once).toContain('| x | **1** |');
    ed.destroy();
  });

  it('the toolbar insert (3×3 with a header row) produces a markdown table', () => {
    const ed = makeEditor('');
    ed.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    const out = ed.storage.markdown.getMarkdown();
    expect(out.split('\n').filter((l: string) => l.startsWith('|'))).toHaveLength(4); // header + delimiter + 2 rows
    expect(out).toContain('| --- | --- | --- |');
    ed.destroy();
  });

  it('Enter in a cell is a hard break and the table stays GFM (it used to split the cell → raw HTML table)', () => {
    const ed = makeEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    const at = caretInFirstCell(ed) + 1; // end of "1"
    ed.commands.setTextSelection(at);
    ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ed.commands.insertContent('more');
    expect(isGfmTable(ed.state.doc.firstChild!)).toBe(true);
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain('| 1<br>more | 2 |');
    expect(out).not.toContain('<table');
    ed.destroy();
  });

  it('inserting a table with the caret in a cell is refused (a nested table used to be stored as raw HTML)', () => {
    const ed = makeEditor(TABLE_MD);
    caretInFirstCell(ed);
    expect(ed.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()).toBe(false);
    expect(ed.storage.markdown.getMarkdown()).not.toContain('<table');
    ed.destroy();
  });

  it('keeps a literal pipe inside a cell (escaped) across a round trip', () => {
    // Before the house serializer escaped it, `a \| b` came back as TWO cells:
    // the row silently gained a column every time the post was opened + saved.
    const ed = makeEditor('| cmd | note |\n| --- | --- |\n| a \\| b | ok |\n');
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain('a \\| b');
    // Re-parsing the output must give back the same two-column row, not three.
    ed.commands.setContent(out, false);
    const rows: string[][] = [];
    ed.state.doc.descendants((n) => {
      if (n.type.name !== 'tableRow') return true;
      const cells: string[] = [];
      n.forEach((c) => cells.push(c.textContent));
      rows.push(cells);
      return false;
    });
    expect(rows).toEqual([
      ['cmd', 'note'],
      ['a | b', 'ok'],
    ]);
    expect(ed.storage.markdown.getMarkdown()).toBe(out);
    ed.destroy();
  });

  it('escapes a pipe that arrives inside a code span', () => {
    const ed = makeEditor('| shell |\n| --- |\n| `a \\| b` |\n');
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain('\\|');
    ed.commands.setContent(out, false);
    const cells: string[] = [];
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'tableCell') cells.push(n.textContent);
      return true;
    });
    expect(cells).toEqual(['a | b']);
    ed.destroy();
  });
});

// A GFM cell is inline-only, but tiptap cells are `block+`: a screenshot pasted
// with the caret in a cell used to land INSIDE it, `isGfmTable` then refused the
// table and the whole thing was stored as raw `<table style=…>` HTML. An embed
// card there is worse — it stops being an own-line token, so the reader never
// resolves it and it is silently invisible.
describe('block atoms and table cells', () => {
  it('tableEscapePos is null outside a table and the position after the table inside one', () => {
    const plain = makeEditor('hello');
    expect(tableEscapePos(plain.state)).toBeNull();
    plain.destroy();

    // A doc that STARTS with a table puts the initial caret in its first cell.
    const ed = makeEditor(`intro\n\n${TABLE_MD}`);
    ed.commands.setTextSelection(2);
    expect(tableEscapePos(ed.state)).toBeNull();
    caretInFirstCell(ed);
    const after = tableEscapePos(ed.state);
    expect(after).not.toBeNull();
    // Right after the table node: nothing of the table is left beyond it.
    expect(ed.state.doc.resolve(after as number).depth).toBe(0);
    expect(ed.state.doc.resolve(after as number).nodeBefore?.type.name).toBe('table');
    ed.destroy();
  });

  it('an image inserted by the editor with the caret inside a cell lands after the table (raw setImage there used to degrade the table to HTML)', () => {
    const ed = makeEditor(TABLE_MD);
    caretInFirstCell(ed);
    const batch = beginInsertBatch(ed.view);
    insertIntoBatch(ed.view, batch, ed.schema.nodes.image.create({ src: '/x.png', alt: 'x' }));
    const out = ed.storage.markdown.getMarkdown();
    expect(out).not.toContain('<table');
    expect(out).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n![x](/x.png)');
    ed.destroy();
  });

  it('the same image inserted at tableEscapePos keeps the table GFM and lands after it', () => {
    const ed = makeEditor(TABLE_MD);
    caretInFirstCell(ed);
    const escape = tableEscapePos(ed.state) as number;
    ed.chain().insertContentAt(escape, { type: 'image', attrs: { src: '/x.png', alt: 'x' } }).run();
    const out = ed.storage.markdown.getMarkdown();
    expect(out).not.toContain('<table');
    expect(out).toContain('| a | b |');
    expect(out).toContain('| 1 | 2 |');
    expect(out.trimEnd().endsWith('![x](/x.png)')).toBe(true);
    ed.destroy();
  });

  it('isInsideTable answers for a cell position and not for one outside', () => {
    const ed = makeEditor(`intro\n\n${TABLE_MD}`);
    const inCell = caretInFirstCell(ed);
    expect(isInsideTable(ed.state, inCell)).toBe(true);
    expect(isInsideTable(ed.state, 2)).toBe(false); // inside 'intro'
    expect(isInsideTable(ed.state, 10 ** 6)).toBe(false); // clamped to the doc end
    ed.destroy();
  });

  // The third door: a markdown `![x](…)` pasted as TEXT is already a BLOCK image
  // by the time `handlePaste` runs (tiptap-markdown parses the clipboard), so the
  // caret rule cannot see it coming — the check has to be on the parsed slice.
  // Confirmed live in Chrome before the fix: the <img> landed inside the <td>.
  it('pasteEscapePos lifts a block-atom slice out of a cell and leaves every other paste alone', () => {
    const ed = makeEditor(`intro\n\n${TABLE_MD}`);
    // An image slice + a plain-text slice, both taken from a real document.
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'image', attrs: { src: '/x.png' } });
    let imgAt = -1;
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image') imgAt = pos;
      return true;
    });
    const imageSlice = ed.state.doc.slice(imgAt, imgAt + 1);
    const textSlice = ed.state.doc.slice(1, 3);

    ed.commands.setTextSelection(2); // in 'intro', outside the table
    expect(pasteEscapePos(ed.state, imageSlice)).toBeNull();

    caretInFirstCell(ed);
    expect(pasteEscapePos(ed.state, textSlice)).toBeNull(); // ordinary text still pastes at the caret
    const escape = pasteEscapePos(ed.state, imageSlice);
    expect(escape).toBe(tableEscapePos(ed.state));
    expect(escape).not.toBeNull();

    // And the lift keeps the table plain GFM (the un-lifted paste does not).
    ed.view.dispatch(ed.state.tr.insert(escape as number, imageSlice.content));
    const out = ed.storage.markdown.getMarkdown();
    expect(out).not.toContain('<table');
    expect(out).toContain('| a | b |');
    ed.destroy();
  });

  it('sliceHasBlockAtom sees a dragged image / embed card but not dragged text', () => {
    const ed = makeEditor('one\n\n[embed:file:file/abc.pdf]');
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'image', attrs: { src: '/x.png' } });
    const positions: Record<string, { from: number; to: number }> = {};
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image' || n.type.name === 'contentEmbed') positions[n.type.name] = { from: pos, to: pos + n.nodeSize };
      return true;
    });
    expect(sliceHasBlockAtom(ed.state.doc.slice(positions.image.from, positions.image.to))).toBe(true);
    expect(sliceHasBlockAtom(ed.state.doc.slice(positions.contentEmbed.from, positions.contentEmbed.to))).toBe(true);
    expect(sliceHasBlockAtom(ed.state.doc.slice(1, 3))).toBe(false); // 'on' out of the first paragraph
    ed.destroy();
  });
});

/** Every row's cell texts, in order. */
function tableRows(ed: Editor): string[][] {
  const rows: string[][] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name !== 'tableRow') return true;
    const cells: string[] = [];
    n.forEach((c) => cells.push(c.textContent));
    rows.push(cells);
    return false;
  });
  return rows;
}

/** The node type of every cell's first block, row by row. */
function cellShapes(ed: Editor): string[][] {
  const rows: string[][] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name !== 'tableRow') return true;
    const cells: string[] = [];
    n.forEach((c) => cells.push(c.firstChild?.type.name ?? ''));
    rows.push(cells);
    return false;
  });
  return rows;
}

// ED-3: a cell whose ONLY block is a code block / list / quote / heading passed
// `isGfmTable` (it refused only `childCount > 1`), and the row writer put that
// block's newlines straight into the `| … |` row: extra rows, cells shifted out
// of the table, the list / heading lost.
describe('a cell holding something a GFM cell cannot say', () => {
  const SOURCE = '| h1 | h2 |\n| --- | --- |\n| c1 | c2 |\n\nafter';
  const caretAtEndOfC1 = (ed: Editor) => {
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isTextblock && n.textContent === 'c1') at = pos + 1 + n.content.size;
      return at < 0;
    });
    ed.commands.setTextSelection(at);
  };
  const commands: Array<[string, (ed: Editor) => void, string]> = [
    ['code block', (ed) => ed.chain().toggleCodeBlock().insertContent('line1').run(), 'codeBlock'],
    ['bullet list', (ed) => ed.chain().toggleBulletList().run(), 'bulletList'],
    ['ordered list', (ed) => ed.chain().toggleOrderedList().run(), 'orderedList'],
    ['blockquote', (ed) => ed.chain().toggleBlockquote().run(), 'blockquote'],
    ['heading', (ed) => ed.chain().toggleHeading({ level: 2 }).run(), 'heading'],
  ];
  for (const [name, run, shape] of commands) {
    it(`${name}: the table goes to raw HTML and reopens with the same rows, cells and block`, () => {
      const ed = makeEditor(SOURCE);
      caretAtEndOfC1(ed);
      run(ed);
      const rowsBefore = tableRows(ed);
      expect(isGfmTable(ed.state.doc.firstChild!)).toBe(false);
      const out = ed.storage.markdown.getMarkdown();
      expect(out).toContain('<table');
      expect(out.endsWith('after')).toBe(true);

      const again = makeEditor(out);
      expect(tableRows(again)).toEqual(rowsBefore);
      expect(cellShapes(again)[1][0]).toBe(shape);
      expect(again.state.doc.lastChild?.textContent).toBe('after');
      expect(again.storage.markdown.getMarkdown()).toBe(out);
      ed.destroy();
      again.destroy();
    });
  }

  it('a code block with a BLANK line in a cell does not cut the HTML table in half', () => {
    const ed = makeEditor(SOURCE);
    caretAtEndOfC1(ed);
    ed.chain().toggleCodeBlock().run();
    ed.commands.insertContent({ type: 'text', text: 'a\n\n\nb' });
    const code = (e: Editor) => {
      let text = '';
      e.state.doc.descendants((n) => {
        if (n.type.name === 'codeBlock') text = n.textContent;
        return true;
      });
      return text;
    };
    const before = code(ed);
    const out = ed.storage.markdown.getMarkdown();
    const tableHtml = out.slice(out.indexOf('<table'), out.indexOf('</table>'));
    expect(tableHtml).toContain('<pre');
    expect(tableHtml.split('\n').some((line: string) => line.trim() === '')).toBe(false);
    const again = makeEditor(out);
    expect(code(again)).toBe(before);
    expect(tableRows(again)).toEqual(tableRows(ed));
    expect(again.storage.markdown.getMarkdown()).toBe(out);
    ed.destroy();
    again.destroy();
  });

  it('a plain paragraph with a hard break stays GFM', () => {
    const ed = makeEditor('| a | b |\n| --- | --- |\n| 1<br>x | 2 |');
    expect(isGfmTable(ed.state.doc.firstChild!)).toBe(true);
    expect(ed.storage.markdown.getMarkdown()).toContain('| 1<br>x | 2 |');
    ed.destroy();
  });

  it('the block-type shortcuts are swallowed in a cell and still work outside one', () => {
    const ed = makeEditor(SOURCE);
    caretAtEndOfC1(ed);
    expect(caretInTableCell(ed.state)).toBe(true);
    for (const key of ['Mod-Alt-c', 'Mod-Shift-8', 'Mod-Shift-7', 'Mod-Shift-b', 'Mod-Alt-2']) {
      const parts = key.split('-');
      const event = new KeyboardEvent('keydown', {
        key: parts[parts.length - 1],
        ctrlKey: true,
        altKey: parts.includes('Alt'),
        shiftKey: parts.includes('Shift'),
        bubbles: true,
        cancelable: true,
      });
      ed.view.dom.dispatchEvent(event);
      expect([key, isGfmTable(ed.state.doc.firstChild!)]).toEqual([key, true]);
    }
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    expect(caretInTableCell(ed.state)).toBe(false);
    ed.destroy();
  });
});

// ED-9: `| :--- | :---: | ---: |` was written back as `| --- | --- | --- |` —
// every edit left-aligned a numeric column.
describe('column alignment', () => {
  it('survives a round trip, byte-identical, and the reader HTML keeps it', () => {
    const src = '| a | b | c | d |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |';
    const ed = makeEditor(src);
    const aligns: (string | null)[] = [];
    ed.state.doc.firstChild!.firstChild!.forEach((c) => aligns.push(c.attrs.align as string | null));
    expect(aligns).toEqual(['left', 'center', 'right', null]);
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain('| :--- | :---: | ---: | --- |');
    const again = makeEditor(out);
    expect(again.storage.markdown.getMarkdown()).toBe(out);
    ed.destroy();
    again.destroy();
  });

  it('a column added next to an aligned one writes `---`; an unaligned table is unchanged', () => {
    const ed = makeEditor('| a | b |\n| --- | ---: |\n| 1 | 2 |');
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'tableHeader') at = pos + 2;
      return true;
    });
    ed.commands.setTextSelection(at);
    ed.commands.addColumnAfter();
    expect(ed.storage.markdown.getMarkdown()).toContain('| --- | --- | ---: |');
    const plain = makeEditor(TABLE_MD);
    expect(plain.storage.markdown.getMarkdown()).toContain('| --- | --- |');
    ed.destroy();
    plain.destroy();
  });

  it('a raw-HTML table carries `align` (the reader sanitizer keeps it, drops style)', () => {
    const ed = makeEditor('| a | b |\n| :---: | --- |\n| 1 | 2 |');
    // Merge the header cells: markdown cannot say it, the table goes HTML.
    const out0 = ed.storage.markdown.getMarkdown();
    expect(out0).toContain(':---:');
    let firstCell = -1;
    ed.state.doc.descendants((n, pos) => {
      if (firstCell < 0 && n.type.name === 'tableCell') firstCell = pos + 2;
      return true;
    });
    ed.commands.setTextSelection(firstCell);
    ed.chain().toggleBulletList().run();
    const html = ed.storage.markdown.getMarkdown();
    expect(html).toMatch(/<th[^>]*align="center"/);
    ed.destroy();
  });
});

// ED-11: a cell whose only content is a sticker (an inline atom — no text) or a
// block image was written as an EMPTY cell.
describe('image-only cells', () => {
  it('a sticker-only header or body cell keeps its sticker', () => {
    for (const src of [
      '| ![s](/api/uploads/stickers/abc.png) | 开心 |\n| --- | --- |\n| 1 | 2 |',
      '| a | b |\n| --- | --- |\n| ![s](/api/uploads/stickers/abc.png) | 2 |',
    ]) {
      const ed = makeEditor(src);
      expect(typeNames(ed).has('stickerImage')).toBe(true);
      const out = ed.storage.markdown.getMarkdown();
      expect(out).toContain('![s](/api/uploads/stickers/abc.png)');
      expect(out).not.toContain('<table');
      const again = makeEditor(out);
      expect(again.storage.markdown.getMarkdown()).toBe(out);
      ed.destroy();
      again.destroy();
    }
  });

  it('a sticker inserted into an empty cell (the 😊 picker) is kept', () => {
    const ed = makeEditor('');
    ed.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    ed.chain().insertContent({ type: 'stickerImage', attrs: { src: '/api/uploads/stickers/abc.png', alt: 'sticker' } }).run();
    expect(ed.storage.markdown.getMarkdown()).toContain('/api/uploads/stickers/abc.png');
    ed.destroy();
  });

  it('a block image as a cell’s only content keeps its src (the table goes HTML)', () => {
    const ed = makeEditor('| ![a](/api/uploads/images/a.png) | b |\n| --- | --- |\n| 1 | 2 |');
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain('/api/uploads/images/a.png');
    const again = makeEditor(out);
    expect(again.storage.markdown.getMarkdown()).toContain('/api/uploads/images/a.png');
    ed.destroy();
    again.destroy();
  });
});
