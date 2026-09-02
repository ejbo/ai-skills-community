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
import { Markdown } from 'tiptap-markdown';
import { TABLE_EXTENSIONS } from '@/components/markdown-table';

function makeEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      ...TABLE_EXTENSIONS,
      Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
    ],
    content,
  });
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