// @vitest-environment jsdom
//
// "You can always keep writing after a block" — the headless contract of
// components/editor/flow-*.ts + components/markdown-table.ts, driven through the
// SAME extension stack components/RichTextEditor.tsx registers —
// buildRichTextExtensions (components/editor/rich-text-extensions.ts) with the
// 技术专区 embed + upload nodes, React node views omitted (the image node view
// is plain DOM and runs here). Nothing to mirror: there is one list.
//
// Each block maps to one defect found by the 2026-09-14 editor research:
//   F1  a block image never ended its block: whatever followed was glued onto
//       the image line (headings / lists / tables became literal text in the
//       reader, embed + poll tokens stopped being own-line tokens)
//   F2  no trailing paragraph: a body ending in a table / image / card had
//       nowhere to type below it
//   F3  the poll / embed normalizers' load step was undoable
//   F4  inserts left the caret ON the new block (next key deleted it) or in the
//       last cell, ate the author's empty line, and a multi-image pick kept one
//   F5  typing on a node-selected image / card replaced it
//   F6  Enter in a cell turned the table into raw HTML; no way out of a table
//   F7  the gap cursor was a 20 px black dash
//   F8  click below the last block went into the code block / quote / image
//   F9  nothing above a table / card that opens the document
//   F10 `**看[文档](/x**)这里` — emphasis delimiters shifted into link syntax

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { RTE_BLOCK_IMAGE_CLASS } from '@/components/editor/flow-image';
import { beginInsertBatch, endInsertBatch, insertIntoBatch, typeAfterSelectedAtom } from '@/components/editor/flow-extension';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { settleEmphasisRun } from '@/components/editor/flow-markdown';
import { arrowOutOfTableTr, isGfmTable, paragraphBesideTableTr } from '@/components/markdown-table';
import { sanitizeSchema } from '@/lib/markdown';
import { extractMentionHandles } from '@/lib/mentions';
import { splitPollSegments } from '@/lib/polls-shared';
import { bodyFileKeys, splitEmbedSegments } from '@/lib/zones/shared';

/**
 * A real `paste` event through ProseMirror's own handler (jsdom has no
 * DataTransfer): text/plain goes through tiptap-markdown's clipboard parser
 * exactly like Ctrl+V in the browser. (EditorView#pasteText would paste as
 * PLAIN text — the Shift+paste path — and skip the markdown parse.)
 */
function paste(ed: Editor, data: { text?: string; html?: string }) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? (data.text ?? '') : type === 'text/html' ? (data.html ?? '') : ''),
      types: [...(data.text != null ? ['text/plain'] : []), ...(data.html != null ? ['text/html'] : [])],
      files: [],
    },
  });
  ed.view.dom.dispatchEvent(event);
}

/**
 * A real keydown through ProseMirror's handler chain. tiptap's
 * `keyboardShortcut` command is not used on purpose: it replays only the STEPS
 * of whatever the handler dispatched and drops its selection change, which is
 * half of what these tests check. `Mod` is Ctrl here (jsdom is not a Mac).
 */
function press(ed: Editor, key: string, mods: { shift?: boolean; mod?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, shiftKey: Boolean(mods.shift), ctrlKey: Boolean(mods.mod) });
  ed.view.dom.dispatchEvent(event);
  return event;
}

function makeEditor(content: string | JSONContent = '', opts: { onUpdate?: () => void; flow?: boolean } = {}) {
  return new Editor({
    extensions: buildRichTextExtensions({ embed: {}, upload: {}, flow: opts.flow }),
    content,
    ...(opts.onUpdate ? { onUpdate: opts.onUpdate } : {}),
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const md = (ed: Editor): string => ed.storage.markdown.getMarkdown();
const tops = (ed: Editor) => {
  const out: string[] = [];
  ed.state.doc.forEach((n) => out.push(n.type.name));
  return out;
};
const posOf = (ed: Editor, type: string, nth = 0): number => {
  let hit = -1;
  let seen = 0;
  ed.state.doc.descendants((n, pos) => {
    if (hit >= 0) return false;
    if (n.type.name === type) {
      if (seen === nth) hit = pos;
      seen += 1;
    }
    return true;
  });
  return hit;
};
const selectNode = (ed: Editor, pos: number) => ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
/** The selection is a collapsed text caret whose textblock is a top-level paragraph at `index`. */
const caretInTopParagraph = (ed: Editor, index: number) => {
  const sel = ed.state.selection;
  return sel instanceof TextSelection && sel.empty && sel.$head.depth === 1 && sel.$head.index(0) === index && sel.$head.parent.type.name === 'paragraph';
};
const insideTable = (ed: Editor) => {
  const $h = ed.state.selection.$head;
  for (let d = $h.depth; d > 0; d -= 1) if ($h.node(d).type.name === 'table') return true;
  return false;
};

const readerHtml = (markdown: string) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [rehypeRaw, [rehypeSanitize, sanitizeSchema]],
      children: markdown,
    } as unknown as Parameters<typeof ReactMarkdown>[0]),
  );

const P = (text?: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
const IMG = (src = '/a.jpg', alt = 'a'): JSONContent => ({ type: 'image', attrs: { src, alt } });
const cell = (type: 'tableHeader' | 'tableCell', text: string): JSONContent => ({ type, content: [P(text)] });
const TABLE: JSONContent = {
  type: 'table',
  content: [
    { type: 'tableRow', content: [cell('tableHeader', 'a'), cell('tableHeader', 'b')] },
    { type: 'tableRow', content: [cell('tableCell', '1'), cell('tableCell', '2')] },
  ],
};
const POLL_ID = 'clxyz12345abcde';
const FILE_KEY = 'file/abcdefghij.pdf';
const TABLE_MD = '| a | b |\n| --- | --- |\n| 1 | 2 |';
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

// ─────────────────────────────────────────────────────────────────────────────
describe('F1 — a block image ends its block', () => {
  const followers: Record<string, { node: JSONContent; reader: RegExp; startsWith: string }> = {
    paragraph: { node: P('after'), reader: /<p>after<\/p>/, startsWith: 'after' },
    heading: { node: { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] }, reader: /<h2>H<\/h2>/, startsWith: '## H' },
    list: {
      node: { type: 'bulletList', content: [{ type: 'listItem', content: [P('item')] }] },
      reader: /<ul>\s*<li>item<\/li>\s*<\/ul>/,
      startsWith: '- item',
    },
    codeBlock: { node: { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] }, reader: /<pre><code>x = 1\s*<\/code><\/pre>/, startsWith: '```' },
    blockquote: { node: { type: 'blockquote', content: [P('q')] }, reader: /<blockquote>\s*<p>q<\/p>\s*<\/blockquote>/, startsWith: '> q' },
    table: { node: TABLE, reader: /<table>/, startsWith: '| a | b |' },
    embed: { node: { type: 'contentEmbed', attrs: { kind: 'file', ref: FILE_KEY } }, reader: /./, startsWith: `[embed:file:${FILE_KEY}]` },
    poll: { node: { type: 'pollEmbed', attrs: { pollId: POLL_ID } }, reader: /./, startsWith: `[poll:${POLL_ID}]` },
  };

  for (const [name, f] of Object.entries(followers)) {
    it(`image then ${name}: own line, stable round trip, reader keeps the block`, async () => {
      const ed = makeEditor(doc(P('intro'), IMG(), f.node));
      const out = md(ed);
      // The image is alone on its line and the follower starts a new block.
      expect(out).toContain(`![a](/a.jpg)\n\n${f.startsWith}`);
      ed.destroy();

      // Re-open + save: byte-identical (nothing escaped into literal text).
      const again = makeEditor(out);
      await tick();
      expect(md(again)).toBe(out);
      again.destroy();

      if (name === 'embed') {
        expect(splitEmbedSegments(out).some((s) => s.type === 'embed')).toBe(true);
        expect(bodyFileKeys(out)).toEqual([FILE_KEY]);
      } else if (name === 'poll') {
        expect(splitPollSegments(out).some((s) => s.type === 'poll')).toBe(true);
      } else {
        const html = readerHtml(out);
        expect(html).toMatch(f.reader);
        // The image is not sharing a paragraph with literal follower text.
        expect(html).toMatch(/<p><img[^>]*><\/p>/);
      }
    });
  }

  it('a resized image (<img width>) ends its block too', () => {
    const ed = makeEditor(doc(P('intro'), { type: 'image', attrs: { src: '/a.jpg', alt: '', width: 320 } }, followers.heading.node));
    const out = md(ed);
    expect(out).toContain('<img src="/a.jpg" alt="" width="320">\n\n## H');
    expect(readerHtml(out)).toMatch(/<h2>H<\/h2>/);
    ed.destroy();
  });

  it('image + embed + image + poll keeps every token on its own line', () => {
    const ed = makeEditor(
      doc(P('intro'), IMG(), { type: 'contentEmbed', attrs: { kind: 'file', ref: FILE_KEY } }, IMG('/b.jpg', 'b'), { type: 'pollEmbed', attrs: { pollId: POLL_ID } }),
    );
    const out = md(ed);
    expect(out).toBe(`intro\n\n![a](/a.jpg)\n\n[embed:file:${FILE_KEY}]\n\n![b](/b.jpg)\n\n[poll:${POLL_ID}]`);
    expect(bodyFileKeys(out)).toEqual([FILE_KEY]);
    expect(splitPollSegments(out).filter((s) => s.type === 'poll')).toHaveLength(1);
    ed.destroy();
  });

  it('stickers stay inline (no block break inside the sentence)', () => {
    const ed = makeEditor('before after');
    ed.commands.setTextSelection(8);
    ed.commands.insertContent({ type: 'stickerImage', attrs: { src: '/api/uploads/stickers/q.webp', alt: 'sticker' } });
    const out = md(ed);
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toBe('before ![sticker](/api/uploads/stickers/q.webp)after');
    ed.destroy();
  });

  it('the block image node view is a block box that carries the hit-box class; stickers do not', () => {
    const ed = makeEditor(doc(P('a'), IMG(), P('b')));
    ed.commands.setTextSelection(2);
    ed.commands.insertContent({ type: 'stickerImage', attrs: { src: '/api/uploads/stickers/q.webp', alt: 's' } });
    const imageDom = ed.view.nodeDOM(posOf(ed, 'image')) as HTMLElement;
    const stickerDom = ed.view.nodeDOM(posOf(ed, 'stickerImage')) as HTMLElement;
    expect(imageDom.classList.contains(RTE_BLOCK_IMAGE_CLASS)).toBe(true);
    expect(stickerDom.classList.contains(RTE_BLOCK_IMAGE_CLASS)).toBe(false);
    expect(stickerDom.classList.contains('rte-sticker')).toBe(true);
    ed.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F2 — the document always ends in a paragraph, invisibly', () => {
  const bodies: Record<string, string> = {
    table: `intro\n\n${TABLE_MD}`,
    image: 'intro\n\n![pic](/labs/toronto.jpg)',
    embed: `intro\n\n[embed:file:${FILE_KEY}]`,
    poll: `intro\n\n[poll:${POLL_ID}]`,
    codeBlock: 'intro\n\n```js\nconst x = 1;\n```',
    blockquote: 'intro\n\n> quoted',
    list: 'intro\n\n- one\n- two',
    horizontalRule: 'intro\n\n---',
    heading: 'intro\n\n## Title',
    paragraph: 'just text',
  };

  for (const [name, body] of Object.entries(bodies)) {
    it(`${name}: trailing paragraph on load, 0 updates, no undo, markdown unchanged`, async () => {
      let updates = 0;
      const ed = makeEditor(body, { onUpdate: () => (updates += 1) });
      await tick();
      const reference = makeEditor(body, { flow: false });
      await tick();

      expect(ed.state.doc.lastChild?.type.name).toBe('paragraph');
      expect(updates).toBe(0);
      expect(ed.can().undo()).toBe(false);
      expect(md(ed)).toBe(md(reference));

      ed.commands.focus('end');
      expect(updates).toBe(0);
      expect(ed.can().undo()).toBe(false);
      expect(caretInTopParagraph(ed, ed.state.doc.childCount - 1)).toBe(true);

      ed.commands.setContent(body, false);
      await tick();
      expect(updates).toBe(0);
      expect(ed.state.doc.lastChild?.type.name).toBe('paragraph');
      expect(md(ed)).toBe(md(reference));

      ed.destroy();
      reference.destroy();
    });
  }

  it('an undo that removes the last paragraph gets a new one back', async () => {
    const ed = makeEditor('');
    await tick();
    ed.commands.focus('end');
    ed.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    expect(ed.state.doc.lastChild?.type.name).toBe('paragraph');
    ed.commands.undo();
    expect(ed.state.doc.lastChild?.type.name).toBe('paragraph');
    ed.commands.redo();
    expect(tops(ed)).toContain('table');
    expect(ed.state.doc.lastChild?.type.name).toBe('paragraph');
    ed.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F3 — poll / embed normalizers load outside history', () => {
  it('Undo on a pristine body with cards is disabled and does not turn cards into tokens', async () => {
    const ed = makeEditor(`[poll:${POLL_ID}]\n\n[embed:file:${FILE_KEY}]\n\ntail`);
    await tick();
    expect(tops(ed)).toEqual(['pollEmbed', 'contentEmbed', 'paragraph']);
    expect(ed.can().undo()).toBe(false);
    ed.commands.undo();
    expect(tops(ed)).toEqual(['pollEmbed', 'contentEmbed', 'paragraph']);
    ed.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F4 — inserts leave a text caret after the block', () => {
  const img = (ed: Editor, n: number) => ed.schema.nodes.image.create({ src: `/${n}.png`, alt: `${n}` });
  const srcs = (ed: Editor) => {
    const out: string[] = [];
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'image') out.push(String(n.attrs.src));
      return true;
    });
    return out;
  };

  it('three images uploaded at once into an EMPTY doc all survive, in order', async () => {
    const ed = makeEditor('');
    await tick();
    ed.commands.focus('end');
    const batch = beginInsertBatch(ed.view);
    for (const n of [1, 2, 3]) insertIntoBatch(ed.view, batch, img(ed, n));
    endInsertBatch(ed.view, batch);
    expect(tops(ed)).toEqual(['image', 'image', 'image', 'paragraph']);
    expect(srcs(ed)).toEqual(['/1.png', '/2.png', '/3.png']);
    expect(caretInTopParagraph(ed, 3)).toBe(true);
    expect(md(ed)).toBe('![1](/1.png)\n\n![2](/2.png)\n\n![3](/3.png)');
    ed.destroy();
  });

  it('three images at the END of text all survive, in order, caret below them', async () => {
    const ed = makeEditor('hello');
    await tick();
    ed.commands.focus('end');
    const batch = beginInsertBatch(ed.view);
    for (const n of [1, 2, 3]) insertIntoBatch(ed.view, batch, img(ed, n));
    expect(tops(ed)).toEqual(['paragraph', 'image', 'image', 'image', 'paragraph']);
    expect(srcs(ed)).toEqual(['/1.png', '/2.png', '/3.png']);
    expect(caretInTopParagraph(ed, 4)).toBe(true);
    ed.commands.insertContent('more');
    expect(md(ed)).toBe('hello\n\n![1](/1.png)\n\n![2](/2.png)\n\n![3](/3.png)\n\nmore');
    ed.destroy();
  });

  it('the empty line the author made is kept (the image goes above it, the caret stays on it)', async () => {
    const ed = makeEditor('hello');
    await tick();
    ed.commands.focus('end');
    press(ed, 'Enter');
    expect(tops(ed)).toEqual(['paragraph', 'paragraph']);
    expect(caretInTopParagraph(ed, 1)).toBe(true);
    const batch = beginInsertBatch(ed.view);
    insertIntoBatch(ed.view, batch, img(ed, 1));
    expect(tops(ed)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(caretInTopParagraph(ed, 2)).toBe(true);
    ed.destroy();
  });

  it('mid-text: the paragraph splits and the caret starts the second half', async () => {
    const ed = makeEditor('hello world');
    await tick();
    ed.commands.setTextSelection(7); // after "hello "
    const batch = beginInsertBatch(ed.view);
    insertIntoBatch(ed.view, batch, img(ed, 1));
    expect(tops(ed)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(ed.state.selection.$head.parent.textContent).toBe('world');
    expect(ed.state.selection.$head.parentOffset).toBe(0);
    ed.destroy();
  });

  it('when the author moves on mid-batch, later images still land in order and the caret stays put', async () => {
    const ed = makeEditor('hello');
    await tick();
    ed.commands.focus('end');
    const batch = beginInsertBatch(ed.view);
    insertIntoBatch(ed.view, batch, img(ed, 1));
    ed.commands.insertContent('typing'); // the author keeps writing under image 1
    insertIntoBatch(ed.view, batch, img(ed, 2));
    endInsertBatch(ed.view, batch);
    expect(srcs(ed)).toEqual(['/1.png', '/2.png']);
    expect(tops(ed)).toEqual(['paragraph', 'image', 'image', 'paragraph']);
    expect(ed.state.selection.$head.parent.textContent).toBe('typing');
    expect(ed.state.selection.$head.parentOffset).toBe('typing'.length);
    ed.destroy();
  });

  it('an image inserted with the caret in a table cell lands after the table, which stays GFM', async () => {
    const ed = makeEditor(TABLE_MD);
    await tick();
    ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2);
    const batch = beginInsertBatch(ed.view);
    insertIntoBatch(ed.view, batch, img(ed, 1));
    const out = md(ed);
    expect(out).toBe(`${TABLE_MD}\n\n![1](/1.png)`);
    expect(tops(ed)).toEqual(['table', 'image', 'paragraph']);
    expect(caretInTopParagraph(ed, 2)).toBe(true);
    ed.destroy();
  });

  describe('the table button', () => {
    it('empty doc: table + paragraph after it, caret in the first cell', async () => {
      const ed = makeEditor('');
      await tick();
      ed.commands.focus('end');
      ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      expect(tops(ed)).toEqual(['table', 'paragraph']);
      expect(ed.state.selection.$head.node(-1).type.name).toBe('tableHeader');
      ed.destroy();
    });

    it('does not eat the empty line made with Enter', async () => {
      const ed = makeEditor('hello');
      await tick();
      ed.commands.focus('end');
      press(ed, 'Enter');
      ed.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
      expect(tops(ed)).toEqual(['paragraph', 'table', 'paragraph']);
      expect(insideTable(ed)).toBe(true);
      ed.destroy();
    });

    it('from a list or a quote it lands at the top level after that block', async () => {
      for (const body of ['- one\n- two', '> quoted']) {
        const ed = makeEditor(body);
        await tick();
        ed.commands.setTextSelection(4);
        ed.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
        expect(tops(ed).slice(1)).toEqual(['table', 'paragraph']);
        expect(md(ed)).toMatch(/\n\n\| {2}\| {2}\|\n\| --- \| --- \|/);
        ed.destroy();
      }
    });

    it('is refused inside a table (what disables the button there)', async () => {
      const ed = makeEditor(TABLE_MD);
      await tick();
      ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2);
      expect(ed.can().insertTable({ rows: 2, cols: 2, withHeaderRow: true })).toBe(false);
      ed.commands.setTextSelection(ed.state.doc.content.size - 1);
      expect(ed.can().insertTable({ rows: 2, cols: 2, withHeaderRow: true })).toBe(true);
      ed.destroy();
    });

    it('with an image selected the table goes after the image, never replacing it', async () => {
      const ed = makeEditor(doc(IMG()));
      await tick();
      selectNode(ed, 0);
      ed.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
      expect(tops(ed)).toEqual(['image', 'table', 'paragraph']);
      ed.destroy();
    });
  });

  describe('paste', () => {
    const TABLE_HTML = '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>';

    it('HTML ending in a table: caret on the line after the table, not in its last cell', async () => {
      const ed = makeEditor('');
      await tick();
      ed.commands.focus('end');
      paste(ed, { html: `<p>intro</p>${TABLE_HTML}`, text: 'intro' });
      expect(insideTable(ed)).toBe(false);
      expect(caretInTopParagraph(ed, 2)).toBe(true);
      ed.commands.insertContent('typed');
      expect(md(ed)).toBe(`intro\n\n${TABLE_MD}\n\ntyped`);
      ed.destroy();
    });

    it('markdown text ending in a table (tiptap-markdown clipboard path): same', async () => {
      const ed = makeEditor('');
      await tick();
      ed.commands.focus('end');
      paste(ed, { text: `First line\n\n${TABLE_MD}` });
      expect(insideTable(ed)).toBe(false);
      ed.commands.insertContent('cont');
      expect(md(ed)).toBe(`First line\n\n${TABLE_MD}\n\ncont`);
      ed.destroy();
    });

    for (const [name, html, type] of [
      ['image', '<p>text</p><img src="/api/uploads/images/x.png">', 'image'],
      ['horizontal rule', '<p>top</p><hr>', 'horizontalRule'],
    ] as const) {
      it(`HTML ending in an ${name}: no NodeSelection, typing keeps the ${name}`, async () => {
        const ed = makeEditor('');
        await tick();
        ed.commands.focus('end');
        paste(ed, { html });
        expect(ed.state.selection instanceof NodeSelection).toBe(false);
        expect(ed.state.selection.$head.parent.type.name).toBe('paragraph');
        ed.commands.insertContent('k1');
        expect(tops(ed)).toEqual(['paragraph', type, 'paragraph']);
        expect(ed.state.doc.lastChild?.textContent).toBe('k1');
        ed.destroy();
      });
    }

    for (const [name, text, type] of [
      ['embed token', `intro\n\n[embed:file:${FILE_KEY}]`, 'contentEmbed'],
      ['poll token', `intro\n\n[poll:${POLL_ID}]`, 'pollEmbed'],
    ] as const) {
      it(`markdown ending in an ${name}: the card materializes and the caret is below it`, async () => {
        const ed = makeEditor('');
        await tick();
        ed.commands.focus('end');
        paste(ed, { text });
        expect(tops(ed)).toEqual(['paragraph', type, 'paragraph']);
        expect(ed.state.selection instanceof NodeSelection).toBe(false);
        expect(caretInTopParagraph(ed, 2)).toBe(true);
        ed.destroy();
      });
    }

    it('a pasted fenced block: caret after the code block', async () => {
      const ed = makeEditor('');
      await tick();
      ed.commands.focus('end');
      paste(ed, { text: '```js\nconst x = 1;\n```' });
      expect(ed.state.selection.$head.parent.type.name).toBe('paragraph');
      ed.commands.insertContent('after');
      expect(md(ed)).toBe('```js\nconst x = 1;\n```\n\nafter');
      ed.destroy();
    });

    it('text pasted INTO an existing cell / code block keeps the caret there', async () => {
      const ed = makeEditor(TABLE_MD);
      await tick();
      ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2);
      paste(ed, { text: 'x' });
      expect(insideTable(ed)).toBe(true);
      ed.destroy();

      const code = makeEditor('```\nconst a = 1;\n```');
      await tick();
      code.commands.setTextSelection(3);
      paste(code, { text: 'more' });
      expect(code.state.selection.$head.parent.type.name).toBe('codeBlock');
      code.destroy();
    });

    it('an external drop of an image slice leaves a text caret after it; a MOVED card stays selected', async () => {
      const ed = makeEditor(doc(P('a'), P('b')));
      await tick();
      const image = ed.schema.nodes.image.create({ src: '/d.png', alt: 'd' });
      const dropAt = 3; // end of "a"'s paragraph boundary
      const tr = ed.state.tr.replaceRangeWith(dropAt, dropAt, image);
      tr.setSelection(NodeSelection.create(tr.doc, dropAt));
      ed.view.someProp('handleDrop', (f) => f(ed.view, new Event('drop') as DragEvent, ed.state.doc.slice(0, 0), false));
      ed.view.dispatch(tr.setMeta('uiEvent', 'drop'));
      expect(ed.state.selection instanceof NodeSelection).toBe(false);
      expect(ed.state.selection.$head.parent.type.name).toBe('paragraph');

      const moved = makeEditor(doc(P('a'), IMG(), P('b')));
      await tick();
      const mtr = moved.state.tr;
      const imgPos = posOf(moved, 'image');
      const node = moved.state.doc.nodeAt(imgPos)!;
      mtr.delete(imgPos, imgPos + node.nodeSize);
      mtr.insert(0, node);
      mtr.setSelection(NodeSelection.create(mtr.doc, 0));
      moved.view.someProp('handleDrop', (f) => f(moved.view, new Event('drop') as DragEvent, moved.state.doc.slice(0, 0), true));
      moved.view.dispatch(mtr.setMeta('uiEvent', 'drop'));
      expect(moved.state.selection instanceof NodeSelection).toBe(true);
      ed.destroy();
      moved.destroy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F5 — typing on a node-selected block atom opens a line after it', () => {
  const atoms: Record<string, JSONContent> = {
    image: IMG(),
    embed: { type: 'contentEmbed', attrs: { kind: 'file', ref: FILE_KEY } },
    poll: { type: 'pollEmbed', attrs: { pollId: POLL_ID } },
    horizontalRule: { type: 'horizontalRule' },
  };

  for (const [name, atom] of Object.entries(atoms)) {
    it(`${name}: handleTextInput types into a new paragraph after it; the node survives`, async () => {
      const ed = makeEditor(doc(P('intro'), atom, P('after')));
      await tick();
      const pos = posOf(ed, atom.type as string);
      selectNode(ed, pos);
      const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, pos, pos + 1, 'x', () => ed.state.tr.insertText('x')));
      expect(handled).toBe(true);
      expect(tops(ed)).toEqual(['paragraph', atom.type, 'paragraph', 'paragraph']);
      expect(ed.state.doc.child(2).textContent).toBe('x');
      expect(ed.state.doc.child(3).textContent).toBe('after'); // not prepended to the next paragraph
      expect(caretInTopParagraph(ed, 2)).toBe(true);
      ed.destroy();
    });
  }

  it('reuses the EMPTY trailing paragraph instead of stacking another', async () => {
    const ed = makeEditor(doc(P('intro'), IMG()));
    await tick();
    selectNode(ed, posOf(ed, 'image'));
    ed.view.dispatch(typeAfterSelectedAtom(ed.state, 'x')!);
    expect(tops(ed)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(md(ed)).toBe('intro\n\n![a](/a.jpg)\n\nx');
    ed.destroy();
  });

  it('a real keypress, a beforeinput insertText and an IME compositionstart all keep the image', async () => {
    const ed = makeEditor(doc(P('intro'), IMG()));
    await tick();
    const pos = posOf(ed, 'image');

    selectNode(ed, pos);
    ed.view.dom.dispatchEvent(new KeyboardEvent('keypress', { charCode: 'k'.charCodeAt(0), bubbles: true, cancelable: true }));
    expect(tops(ed)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(ed.state.doc.lastChild?.textContent).toBe('k');

    selectNode(ed, pos);
    const input = new InputEvent('beforeinput', { inputType: 'insertText', data: 'y', bubbles: true, cancelable: true });
    ed.view.dom.dispatchEvent(input);
    expect(input.defaultPrevented).toBe(true);
    expect(tops(ed)).toEqual(['paragraph', 'image', 'paragraph', 'paragraph']);
    expect(ed.state.doc.child(2).textContent).toBe('y');

    selectNode(ed, pos);
    ed.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(ed.state.selection instanceof TextSelection).toBe(true);
    expect(ed.state.selection.$head.parent.type.name).toBe('paragraph');
    expect(ed.state.selection.$head.parent.content.size).toBe(0);
    expect(tops(ed)).toContain('image');
    ed.destroy();
  });

  it('Enter on a selected FIRST-block image opens the line after it, not before', async () => {
    const ed = makeEditor(doc(IMG(), P('after')));
    await tick();
    selectNode(ed, 0);
    press(ed, 'Enter');
    expect(tops(ed)).toEqual(['image', 'paragraph', 'paragraph']);
    expect(caretInTopParagraph(ed, 1)).toBe(true);
    ed.destroy();
  });

  it('Backspace / Delete still delete the selected node', async () => {
    for (const key of ['Backspace', 'Delete']) {
      const ed = makeEditor(doc(P('intro'), IMG(), P('after')));
      await tick();
      selectNode(ed, posOf(ed, 'image'));
      press(ed, key);
      expect(tops(ed)).not.toContain('image');
      ed.destroy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F6 — tables stay GFM and can be left', () => {
  const lastCellEnd = (ed: Editor) => {
    const pos = posOf(ed, 'tableCell', 1);
    return pos + ed.state.doc.nodeAt(pos)!.nodeSize - 2;
  };

  for (const key of ['Enter', 'Shift-Enter']) {
    it(`${key} in a cell inserts a hard break stored as <br>, and the table stays GFM`, async () => {
      const ed = makeEditor(`intro\n\n${TABLE_MD}`);
      await tick();
      ed.commands.setTextSelection(lastCellEnd(ed));
      press(ed, 'Enter', { shift: key === 'Shift-Enter' });
      ed.commands.insertContent('x');
      let table = ed.state.doc.child(1);
      expect(isGfmTable(table)).toBe(true);
      const out = md(ed);
      expect(out).toContain('| 1 | 2<br>x |');
      expect(out).not.toContain('\\\n');
      expect(out).not.toContain('<table');

      const again = makeEditor(out);
      await tick();
      table = again.state.doc.child(1);
      let hardBreaks = 0;
      table.descendants((n) => {
        if (n.type.name === 'hardBreak') hardBreaks += 1;
        return true;
      });
      expect(hardBreaks).toBe(1);
      expect(md(again)).toBe(out);
      ed.destroy();
      again.destroy();
    });
  }

  it('Mod-Enter anywhere in the table exits to the (reused) line after it', async () => {
    const ed = makeEditor(TABLE_MD);
    await tick();
    ed.commands.setTextSelection(posOf(ed, 'tableHeader') + 2);
    press(ed, 'Enter', { mod: true });
    expect(insideTable(ed)).toBe(false);
    expect(tops(ed)).toEqual(['table', 'paragraph']);
    expect(caretInTopParagraph(ed, 1)).toBe(true);
    ed.destroy();
  });

  it('ArrowDown on the last row lands after the table; on the first row it is prosemirror-tables’ key', async () => {
    const ed = makeEditor(TABLE_MD);
    await tick();
    ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2);
    const tr = arrowOutOfTableTr(ed.state, 'down');
    expect(tr).not.toBeNull();
    ed.view.dispatch(tr!);
    expect(caretInTopParagraph(ed, 1)).toBe(true);

    ed.commands.setTextSelection(posOf(ed, 'tableHeader') + 2);
    expect(arrowOutOfTableTr(ed.state, 'down')).toBeNull();
    ed.destroy();
  });

  it('the bound ArrowDown / ArrowRight keys win over the gap cursor', async () => {
    const ed = makeEditor(TABLE_MD);
    await tick();
    // jsdom has no layout; the "last visual line" question is answered yes.
    (ed.view as unknown as { endOfTextblock: () => boolean }).endOfTextblock = () => true;
    ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2);
    press(ed, 'ArrowDown');
    expect(caretInTopParagraph(ed, 1)).toBe(true);

    ed.commands.setTextSelection(lastCellEnd(ed));
    press(ed, 'ArrowRight');
    expect(caretInTopParagraph(ed, 1)).toBe(true);
    ed.destroy();
  });

  it('ArrowRight only leaves from the very end of the LAST cell', async () => {
    const ed = makeEditor(TABLE_MD);
    await tick();
    ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2); // end of "1": last row, not last cell
    expect(arrowOutOfTableTr(ed.state, 'right')).toBeNull();
    ed.commands.setTextSelection(lastCellEnd(ed) - 1); // before "2"
    expect(arrowOutOfTableTr(ed.state, 'right')).toBeNull();
    ed.commands.setTextSelection(lastCellEnd(ed));
    expect(arrowOutOfTableTr(ed.state, 'right')).not.toBeNull();
    ed.destroy();
  });

  it('a table followed directly by a card gets a new line between them', async () => {
    const ed = makeEditor(doc(TABLE, IMG(), P('end')));
    await tick();
    ed.commands.setTextSelection(lastCellEnd(ed));
    ed.view.dispatch(arrowOutOfTableTr(ed.state, 'down')!);
    expect(tops(ed)).toEqual(['table', 'paragraph', 'image', 'paragraph']);
    expect(caretInTopParagraph(ed, 1)).toBe(true);
    ed.destroy();
  });

  it('paragraph above / below the table (TableToolbar): created once, then reused', async () => {
    const ed = makeEditor(TABLE_MD);
    await tick();
    ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2);
    ed.view.dispatch(paragraphBesideTableTr(ed.state, 'before')!);
    expect(tops(ed)).toEqual(['paragraph', 'table', 'paragraph']);
    expect(caretInTopParagraph(ed, 0)).toBe(true);

    ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2);
    ed.view.dispatch(paragraphBesideTableTr(ed.state, 'before')!);
    expect(tops(ed)).toEqual(['paragraph', 'table', 'paragraph']); // the empty line above is reused

    ed.commands.setTextSelection(posOf(ed, 'tableCell') + 2);
    ed.view.dispatch(paragraphBesideTableTr(ed.state, 'after')!);
    expect(tops(ed)).toEqual(['paragraph', 'table', 'paragraph']); // the trailing paragraph is reused
    expect(caretInTopParagraph(ed, 2)).toBe(true);
    expect(paragraphBesideTableTr(ed.state, 'after')).toBeNull(); // not in a table any more
    ed.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F7 — the gap cursor is visible: tests/gap-cursor-css.test.ts. It computes the
// cascade over tiptap's injected sheet + every app stylesheet instead of
// regex-matching this file's neighbour, so it survives the rule moving and
// fails when a later rule overrides it.

// ─────────────────────────────────────────────────────────────────────────────
describe('F8 — click below the last block', () => {
  const clickBelow = (ed: Editor) => {
    const { doc: d } = ed.state;
    const lastDom = ed.view.nodeDOM(d.content.size - d.lastChild!.nodeSize) as HTMLElement;
    lastDom.getBoundingClientRect = () => ({ top: 80, bottom: 100, left: 0, right: 600, width: 600, height: 20, x: 0, y: 80, toJSON: () => ({}) }) as DOMRect;
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 300 });
    ed.view.dom.dispatchEvent(event);
    return event;
  };

  for (const [name, body] of [
    ['a code block', 'intro\n\n```\nconst x = 1;\n```'],
    ['a blockquote', 'intro\n\n> quoted'],
    ['a list', 'intro\n\n- item one'],
    ['an image', 'intro\n\n![pic](/labs/toronto.jpg)'],
  ] as const) {
    it(`a body ending in ${name}: the caret goes to the trailing paragraph`, async () => {
      const ed = makeEditor(body);
      await tick();
      ed.commands.setTextSelection(2);
      const event = clickBelow(ed);
      expect(event.defaultPrevented).toBe(true);
      expect(caretInTopParagraph(ed, ed.state.doc.childCount - 1)).toBe(true);
      ed.commands.insertContent('below');
      expect(md(ed).endsWith('\n\nbelow')).toBe(true);
      ed.destroy();
    });
  }

  it('a click beside a block (not below the last one) stays ProseMirror’s', async () => {
    const ed = makeEditor('intro\n\n> quoted');
    await tick();
    const { doc: d } = ed.state;
    const lastDom = ed.view.nodeDOM(d.content.size - d.lastChild!.nodeSize) as HTMLElement;
    lastDom.getBoundingClientRect = () => ({ top: 80, bottom: 100, left: 0, right: 600, width: 600, height: 20, x: 0, y: 80, toJSON: () => ({}) }) as DOMRect;
    // ProseMirror's own mousedown asks the (layout-less) document where the click is.
    (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 90 });
    ed.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    ed.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F9 — above a table / card that opens the document', () => {
  for (const [name, first] of [
    ['table', TABLE],
    ['embed', { type: 'contentEmbed', attrs: { kind: 'file', ref: FILE_KEY } }],
    ['image', IMG()],
  ] as const) {
    it(`${name} first: the gap cursor at 0 is valid and typing there creates a paragraph above`, async () => {
      const ed = makeEditor(doc(first as JSONContent, P('below')));
      await tick();
      const $0 = ed.state.doc.resolve(0);
      expect((GapCursor as unknown as { valid: (p: typeof $0) => boolean }).valid($0)).toBe(true);
      ed.view.dispatch(ed.state.tr.setSelection(new GapCursor($0)));
      const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, 0, 0, 'a', () => ed.state.tr.insertText('a')));
      expect(handled ?? false).toBe(false); // the flow extension leaves gap cursors to ProseMirror
      ed.view.dispatch(ed.state.tr.insertText('above'));
      expect(tops(ed)[0]).toBe('paragraph');
      expect(ed.state.doc.child(0).textContent).toBe('above');
      expect(tops(ed)[1]).toBe((first as JSONContent).type);
      ed.destroy();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F10 — emphasis delimiters never move into link / code / HTML syntax', () => {
  const t = (text: string, marks: JSONContent['marks'] = []): JSONContent => ({ type: 'text', text, marks });
  const B = { type: 'bold' };
  const I = { type: 'italic' };
  const L = (href: string) => ({ type: 'link', attrs: { href } });
  const serialize = (content: JSONContent[]) => {
    const ed = makeEditor(doc({ type: 'paragraph', content }));
    const out = md(ed);
    ed.destroy();
    return out;
  };
  const reopen = async (markdown: string) => {
    const ed = makeEditor(markdown);
    await tick();
    const json = ed.getJSON();
    const again = md(ed);
    ed.destroy();
    return { json, again };
  };
  const hrefs = (json: JSONContent) => {
    const out: string[] = [];
    const walk = (n: JSONContent) => {
      for (const m of n.marks ?? []) if (m.type === 'link') out.push(String(m.attrs?.href));
      (n.content ?? []).forEach(walk);
    };
    walk(json);
    return out;
  };
  const boldText = (json: JSONContent) => {
    let s = '';
    const walk = (n: JSONContent) => {
      if (n.type === 'text' && (n.marks ?? []).some((m) => m.type === 'bold')) s += n.text;
      (n.content ?? []).forEach(walk);
    };
    walk(json);
    return s;
  };

  it('a bold run ending at a link, CJK after: link href intact, bold kept, stable', async () => {
    const out = serialize([t('请'), t('看', [B]), t('文档', [L('/x'), B]), t('这里')]);
    expect(out).not.toContain('(/x**)');
    expect(out).toContain('[文档](/x)');
    const { json, again } = await reopen(out);
    expect(hrefs(json)).toEqual(['/x']);
    expect(boldText(json)).toBe('看文档');
    expect(again).toBe(out);
    expect(readerHtml(out)).toContain('<strong>看<a href="/x">文档</a></strong>这里');
  });

  it('an italic run ending at a link, CJK after: same', async () => {
    const out = serialize([t('请'), t('看', [I]), t('文档', [L('/x'), I]), t('这里')]);
    expect(out).not.toContain('(/x*)');
    const { json, again } = await reopen(out);
    expect(hrefs(json)).toEqual(['/x']);
    expect(again).toBe(out);
  });

  it('a bold @mention (bold run ending at the mention, CJK after) still notifies', async () => {
    const out = serialize([t('请'), t('联系', [B]), t('@王伟', [L('/users/z84412632'), B]), t('看一下')]);
    expect(extractMentionHandles(out)).toEqual(['z84412632']);
    const { json, again } = await reopen(out);
    expect(hrefs(json)).toEqual(['/users/z84412632']);
    expect(boldText(json)).toBe('联系@王伟');
    expect(extractMentionHandles(again)).toEqual(['z84412632']);
    expect(again).toBe(out);
  });

  it('a whole bold mention followed by CJK keeps its href', async () => {
    const out = serialize([t('hi '), t('@王伟', [L('/users/z84412632'), B]), t('看一下')]);
    const { json, again } = await reopen(out);
    expect(hrefs(json)).toEqual(['/users/z84412632']);
    expect(again).toBe(out);
  });

  it('a bold run ending in inline code, CJK after, never moves ** into the code span', async () => {
    const out = serialize([t('请'), t('看', [B]), t('x', [B, { type: 'code' }]), t('这里')]);
    expect(out).not.toMatch(/`x\*\*`/);
    const { json } = await reopen(out);
    const codes: string[] = [];
    const walk = (n: JSONContent) => {
      if (n.type === 'text' && (n.marks ?? []).some((m) => m.type === 'code')) codes.push(n.text ?? '');
      (n.content ?? []).forEach(walk);
    };
    walk(json);
    expect(codes).toEqual(['x']);
  });

  it('bold opening the second paragraph of a quote no longer eats the > markers', async () => {
    const ed = makeEditor('> a\n>\n> **b** c');
    await tick();
    const out = md(ed);
    expect(out).toBe('> a\n>\n> **b** c');
    ed.destroy();
  });

  it('a bold run at the very start of the document is settled too', async () => {
    const out = serialize([t('看(注)', [B]), t('这里')]);
    const { json, again } = await reopen(out);
    expect(boldText(json)).toBe('看(注)');
    expect(again).toBe(out);
  });

  it('everything tiptap-markdown already got right serializes byte-identically', async () => {
    for (const body of ['a **b [c](/x) d** e', '**a** *b*', '***ab***', '*a **b***', 'hello **world**', '1. a\n2. **b** c', '- a\n\n  **b** c', '这**是粗体**文字', '~~gone~~ here', '这***是粗斜体***文字']) {
      const ed = makeEditor(body);
      await tick();
      const reference = makeEditor(body, { flow: false });
      await tick();
      expect([body, md(ed)]).toEqual([body, md(reference)]);
      ed.destroy();
      reference.destroy();
    }
  });

  it('settleEmphasisRun refuses stale positions instead of rewriting foreign characters', () => {
    const scan = () => ({ can_open: false, can_close: false });
    expect(settleEmphasisRun('abc | def', '**', 2, 6, scan).text).toBe('abc | def');
  });

  // ED-2: markdown-it reads emoji as punctuation, so a run ending (or starting)
  // in one next to text is not flanking — and the one-code-unit shift used to
  // land BETWEEN the surrogate halves. A lone surrogate makes Prisma reject the
  // whole body (the save 500s), so every case asserts well-formed UTF-16 and a
  // lossless reopen.
  describe('emoji and other multi-unit characters at a run edge', () => {
    const S = { type: 'strike' };
    const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    /** [text, marks] for every text node of the first paragraph. */
    const runs = (json: JSONContent) =>
      (json.content?.[0]?.content ?? []).map((n) => [n.text, (n.marks ?? []).map((m) => m.type).sort().join('+')]);
    const merged = (content: JSONContent[]) => {
      // What the doc looks like after ProseMirror joins adjacent same-mark text.
      const ed = makeEditor(doc({ type: 'paragraph', content }));
      const r = runs(ed.getJSON());
      ed.destroy();
      return r;
    };
    const cases: [string, JSONContent[]][] = [
      ['bold ending in 😀, CJK after, mid-paragraph', [t('大家'), t('好的😀', [B]), t('然后')]],
      ['bold ending in 😀, CJK after, at offset 0', [t('好的😀', [B]), t('然后')]],
      ['bold ending in 🎉, Latin after', [t('Hi '), t('great 🎉', [B]), t('team')]],
      ['italic starting with 😀, text before', [t('看'), t('😀好的', [I]), t('。')]],
      ['italic starting with 😀, Latin before', [t('x'), t('😀y', [I])]],
      ['strike ending in 🔥, CJK after', [t('请'), t('完成🔥', [S]), t('这里')]],
      ['strike ending in 🔥 at offset 0', [t('完成🔥', [S]), t('这里')]],
      ['a bold run that is only an emoji', [t('a'), t('😀', [B]), t('b')]],
      ['skin-tone emoji 👍🏽 at the end', [t('好的👍🏽', [B]), t('然后')]],
      ['ZWJ family 👨‍👩‍👧 at the end', [t('全家👨‍👩‍👧', [B]), t('然后')]],
      ['keycap 1️⃣ at the end', [t('第1️⃣', [B]), t('名')]],
    ];
    for (const [name, content] of cases) {
      it(name, async () => {
        const out = serialize(content);
        expect(out).not.toMatch(LONE_SURROGATE);
        expect(out.isWellFormed()).toBe(true);
        const { json, again } = await reopen(out);
        expect(runs(json)).toEqual(merged(content));
        expect(again).toBe(out);
      });
    }

    it('the pure settle step never leaves a lone surrogate', () => {
      // A scanner that never lets the delimiter close: the loop walks as far as it may.
      const scan = () => ({ can_open: true, can_close: false });
      const { text } = settleEmphasisRun('**好的😀**然后', '**', 0, 6, scan);
      expect(text.isWellFormed()).toBe(true);
      expect(text).toBe('<strong>好的😀</strong>然后');
    });
  });

  // ED-6: the outer run of stacked emphasis walked ACROSS the inner run's
  // delimiter (`请~**~注意！~**~这里`) — both marks were lost on the next open.
  describe('stacked emphasis never splits another run’s delimiter', () => {
    const S = { type: 'strike' };
    const cases: [string, JSONContent[], string][] = [
      ['bold + strike ending in ！, CJK after', [t('请'), t('注意！', [B, S]), t('这里')], '注意！'],
      ['bold + strike, Latin, at offset 0', [t('Note!', [B, S]), t('here')], 'Note!'],
      ['italic + strike, CJK', [t('请'), t('注意', [I, S]), t('这里')], '注意'],
      ['bold partly overlapping bold + strike', [t('请'), t('注', [B]), t('意', [B, S]), t('这里')], '意'],
    ];
    for (const [name, content, struck] of cases) {
      it(name, async () => {
        const out = serialize(content);
        expect(out).not.toMatch(/~\*+~|\*~\*/);
        const { json, again } = await reopen(out);
        let strikeText = '';
        const walk = (n: JSONContent) => {
          if (n.type === 'text' && (n.marks ?? []).some((m) => m.type === 'strike')) strikeText += n.text;
          (n.content ?? []).forEach(walk);
        };
        walk(json);
        expect(strikeText).toBe(struck);
        expect(again).toBe(out);
        const html = readerHtml(out);
        expect(html).toContain('<del>');
        expect(html).not.toMatch(/~/);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F11 — the editor reads a body the way the reader does (components/editor/flow-parse.ts)
describe('F11 — parse agrees with the reader', () => {
  const open = async (markdown: string) => {
    const ed = makeEditor(markdown);
    await tick();
    return ed;
  };
  /** Types one character at the end, the way any real edit re-serializes the whole body. */
  const editAndSave = (ed: Editor) => {
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    ed.commands.insertContent('z');
    return md(ed);
  };

  // ED-10: tiptap-markdown's normalizeDOM stripped the "\n" of a soft break
  // that directly followed an inline element — the two words were glued.
  describe('a soft line break after a formatted run stays a space', () => {
    const cases: [string, string][] = [
      ['The **code**\nis already done', 'The **code** is already done'],
      ['every `id` and `name`\nattribute', 'every `id` and `name` attribute'],
      ['x **bold**\n**next** y', 'x **bold** **next** y'],
      ['a [link](/x)\nnext', 'a [link](/x) next'],
      ['中文**加粗**\n继续', '中文**加粗** 继续'],
      ['- item **b**\n  cont', '- item **b** cont'],
      ['> quote *i*\n> more', '> quote *i* more'],
      ['plain\ntext', 'plain text'],
    ];
    for (const [src, want] of cases) {
      it(JSON.stringify(src), async () => {
        const ed = await open(src);
        expect(md(ed)).toBe(want);
        ed.destroy();
      });
    }

    it('pasted as text (the markdown clipboard parser) too', async () => {
      const ed = await open('');
      paste(ed, { text: 'The **code**\nis done' });
      expect(md(ed)).toBe('The **code** is done');
      ed.destroy();
    });

    it('hard breaks, fences and tables are untouched', async () => {
      for (const body of ['a\\\nb', '```\nline1\nline2\n```', TABLE_MD]) {
        const ed = await open(body);
        expect(md(ed).trimEnd()).toBe(body);
        ed.destroy();
      }
    });
  });

  // ED-8: a token line right after text / a list / a quote / a table / another
  // token is a card in the reader (line splitters) but was a paragraph
  // continuation / table row in the editor — the next save escaped it.
  describe('an own-line token without blank lines around it is still a card', () => {
    const FILE = 'file/abcdefgh.pdf';
    const POLL_A = 'abcdefgh1234';
    const POLL_B = 'ijklmnop5678';
    const shapes: [string, string][] = [
      ['after text', `介绍一下：\n[embed:file:${FILE}]`],
      ['two polls on adjacent lines', `[poll:${POLL_A}]\n[poll:${POLL_B}]`],
      ['after a table', `${TABLE_MD}\n[poll:${POLL_A}]`],
      ['after a list item', `- item\n[embed:file:${FILE}]`],
      ['after a quote', `> quote\n[poll:${POLL_A}]`],
      ['before text', `[embed:file:${FILE}]\n后续文字`],
    ];
    const cards = (markdown: string) => ({
      polls: splitPollSegments(markdown).filter((s) => s.type === 'poll').length,
      embeds: splitEmbedSegments(markdown).filter((s) => s.type === 'embed').length,
    });
    for (const [name, src] of shapes) {
      it(name, async () => {
        const reader = cards(src);
        expect(reader.polls + reader.embeds).toBeGreaterThan(0);
        const ed = await open(src);
        const nodes = { polls: 0, embeds: 0 };
        ed.state.doc.forEach((n) => {
          if (n.type.name === 'pollEmbed') nodes.polls += 1;
          if (n.type.name === 'contentEmbed') nodes.embeds += 1;
        });
        expect(nodes).toEqual(reader);
        const saved = editAndSave(ed);
        expect(cards(saved)).toEqual(reader);
        expect(saved).not.toContain('\\[');
        if (src.includes(FILE)) expect(bodyFileKeys(saved)).toEqual([FILE]);
        ed.destroy();
      });
    }

    it('a token inside a fence stays code', async () => {
      const src = '```\n[poll:abcdefgh1234]\n```';
      const ed = await open(src);
      expect(tops(ed)).toEqual(['codeBlock', 'paragraph']);
      expect(md(ed)).toBe(src);
      ed.destroy();
    });
  });

  // ED-29: pasted web HTML wraps a picture in <p>; the block image closed the
  // paragraph and left an empty one above it. The source page's width was stored
  // as raw `<img width>` HTML.
  describe('pasted <p><img></p>', () => {
    it('lands as paragraph, image, paragraph — no empty line, no raw <img width>', async () => {
      const ed = await open('');
      paste(ed, { html: '<h2>Title</h2><p>before</p><p><img src="/x.png" alt="chart" width="400" style="float:right"></p><p>after</p>' });
      expect(tops(ed).slice(0, 4)).toEqual(['heading', 'paragraph', 'image', 'paragraph']);
      let empties = 0;
      ed.state.doc.forEach((n, _o, i) => {
        if (n.isTextblock && n.content.size === 0 && i < ed.state.doc.childCount - 1) empties += 1;
      });
      expect(empties).toBe(0);
      const out = md(ed);
      expect(out).toContain('![chart](/x.png)');
      expect(out).not.toContain('<img');
      ed.destroy();
    });

    it('an image in the middle of a paragraph splits it; a sticker stays inline', async () => {
      const ed = await open('');
      paste(ed, { html: '<p>left <img src="/y.png" alt="y"> right <img src="/api/uploads/stickers/s.png" alt="s"> end</p>' });
      const names = tops(ed);
      expect(names.slice(0, 3)).toEqual(['paragraph', 'image', 'paragraph']);
      expect(ed.state.doc.child(0).textContent.trim()).toBe('left');
      const tail = ed.state.doc.child(2);
      let sticker = false;
      tail.forEach((c) => {
        if (c.type.name === 'stickerImage') sticker = true;
      });
      expect(sticker).toBe(true);
      ed.destroy();
    });
  });
});
