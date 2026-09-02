// @vitest-environment jsdom
// Pins the GFM table round trip of the editor's extension set: StarterKit has
// no table node, so before @tiptap/extension-table was registered a stored
// `| a | b |` body re-opened as flattened text and was destroyed on the next
// save. tiptap-markdown ships a table serializer (first row = tableHeader
// cells) and markdown-it parses GFM tables — this is the contract the
// RichTextEditor relies on. The extension list is imported from
// components/markdown-table.ts so this pins the SHIPPED serializer, including
// its pipe escaping (a cell holding `|` used to split into two cells).
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { TABLE_EXTENSIONS, isInsideTable, pasteEscapePos, sliceHasBlockAtom, tableEscapePos } from '@/components/markdown-table';
import { ContentEmbedBase } from '@/components/zones/embeds/embed-node-extension';

function makeEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      Image,
      ContentEmbedBase,
      ...TABLE_EXTENSIONS,
      Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
    ],
    content,
  });
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

  it('an image inserted at the caret inside a cell degrades the table to raw HTML (the bug)', () => {
    const ed = makeEditor(TABLE_MD);
    caretInFirstCell(ed);
    ed.chain().setImage({ src: '/x.png', alt: 'x' }).run();
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain('<table');
    expect(out).not.toContain('| a | b |');
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
