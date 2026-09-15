// @vitest-environment jsdom
// Headless smoke test of the two riskiest editor embed mechanisms, on the REAL
// extension list: buildRichTextExtensions (components/editor/rich-text-extensions.ts)
// is what components/RichTextEditor.tsx registers, minus the React node views.
// This file used to hand-copy that list and its image serializer, which is how
// the missing closeBlock went unnoticed — never copy it back.
// Guards against tiptap upgrades silently breaking:
// 1) inline sticker node round-trips markdown and wins parse priority
// 2) a block image ends its block (whatever follows is not glued onto its line)
// 3) poll token insertion lifts to top level from inside a blockquote
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';

function makeEditor(content: string) {
  return new Editor({ extensions: buildRichTextExtensions(), content });
}

describe('sticker inline node', () => {
  it('markdown sticker parses to the stickerImage node and round-trips as ![…]', () => {
    const md = 'hello ![sticker](/api/uploads/stickers/abc123.gif) world';
    const ed = makeEditor(md);
    const types: string[] = [];
    ed.state.doc.descendants((n) => { types.push(n.type.name); return true; });
    expect(types).toContain('stickerImage');
    // Known tradeoff: tiptap-markdown lifts <img> out of <p> at the md→HTML
    // stage, so on RELOAD the sticker sits in its own paragraph (readers still
    // see it inline — react-markdown keeps it inside the <p>). What matters is
    // the node type (small render, no resize handle) + the ![…] serialization.
    const out = ed.storage.markdown.getMarkdown();
    expect(out).toContain('![sticker](/api/uploads/stickers/abc123.gif)');
    expect(out).not.toContain('<img');
    ed.destroy();
  });

  it('regular images still parse to the block image node', () => {
    const ed = makeEditor('![pic](/api/uploads/images/xyz.png)');
    const types: string[] = [];
    ed.state.doc.descendants((n) => { types.push(n.type.name); return true; });
    expect(types).toContain('image');
    expect(types).not.toContain('stickerImage');
    ed.destroy();
  });

  it('insertContent as stickerImage lands inline at the cursor and serializes', () => {
    const ed = makeEditor('before after');
    ed.commands.setTextSelection(8); // between the words
    ed.chain().insertContent({ type: 'stickerImage', attrs: { src: '/api/uploads/stickers/q.webp', alt: 'sticker' } }).run();
    const out = ed.storage.markdown.getMarkdown();
    expect(out.split('\n')).toHaveLength(1); // still ONE paragraph
    expect(out).toContain('![sticker](/api/uploads/stickers/q.webp)');
    ed.destroy();
  });

  it('a block image ends its block; a sticker next to it does not', () => {
    const ed = makeEditor('');
    ed.commands.setContent(
      {
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: '/api/uploads/images/a.png', alt: 'a' } },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'hi ' },
              { type: 'stickerImage', attrs: { src: '/api/uploads/stickers/s.gif', alt: 'sticker' } },
              { type: 'text', text: ' there' },
            ],
          },
        ],
      },
      false,
    );
    expect(ed.storage.markdown.getMarkdown()).toBe('![a](/api/uploads/images/a.png)\n\n## H\n\nhi ![sticker](/api/uploads/stickers/s.gif) there');
    ed.destroy();
  });

  it('setImage still targets the block image node (commands not hijacked)', () => {
    const ed = makeEditor('');
    ed.chain().setImage({ src: '/api/uploads/images/n.png', alt: 'n' } as any).run();
    const types: string[] = [];
    ed.state.doc.descendants((n) => { types.push(n.type.name); return true; });
    expect(types).toContain('image');
    expect(types).not.toContain('stickerImage');
    ed.destroy();
  });
});

describe('poll embed node (the REAL extension, minus its React nodeview)', () => {
  const id = 'clxyz12345abcde';
  const OWN_LINE = /^ {0,3}\\?\[poll:([a-z0-9]{8,40})\\?\][ \t]*$/m;

  function makePollEditor(content: string) {
    return new Editor({ extensions: buildRichTextExtensions(), content });
  }
  const nodeIds = (ed: Editor) => {
    const ids: string[] = [];
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'pollEmbed') ids.push(String(n.attrs.pollId));
      return true;
    });
    return ids;
  };
  const insertEmbed = (ed: Editor, pollId: string) => {
    const { $to } = ed.state.selection;
    const pos = $to.depth === 0 ? $to.pos : $to.after(1);
    ed.chain().insertContentAt(pos, [
      { type: 'pollEmbed', attrs: { pollId } },
      { type: 'paragraph' },
    ]).run();
  };

  it('loading markdown with an own-line token materializes the node (initial normalize)', async () => {
    const ed = makePollEditor(`before\n\n[poll:${id}]\n\nafter`);
    await new Promise((r) => setTimeout(r, 0)); // initial normalize is a microtask
    expect(nodeIds(ed)).toEqual([id]);
    // and it serializes back to the own-line token
    const out = ed.storage.markdown.getMarkdown();
    expect(OWN_LINE.test(out)).toBe(true);
    ed.destroy();
  });

  it('setContent (controlled sync) also normalizes via appendTransaction', () => {
    const ed = makePollEditor('plain');
    ed.commands.setContent(`[poll:${id}]`, false);
    expect(nodeIds(ed)).toEqual([id]);
    ed.destroy();
  });

  it('inline mentions and non-token text never become nodes', () => {
    const ed = makePollEditor(`see [poll:${id}] inline`);
    expect(nodeIds(ed)).toEqual([]);
    ed.destroy();
  });

  it('insertion from a blockquote caret lands top-level and round-trips', () => {
    const ed = makePollEditor('> quoted text');
    ed.commands.setTextSelection(5); // inside the blockquote
    insertEmbed(ed, id);
    expect(nodeIds(ed)).toEqual([id]);
    const out = ed.storage.markdown.getMarkdown();
    expect(OWN_LINE.test(out)).toBe(true);
    expect(out).not.toMatch(/^>.*poll/m); // not nested in the quote
    ed.destroy();
  });

  it('insertion from a bullet list caret lands top-level', () => {
    const ed = makePollEditor('- item one\n- item two');
    ed.commands.setTextSelection(6);
    insertEmbed(ed, id);
    const out = ed.storage.markdown.getMarkdown();
    expect(OWN_LINE.test(out)).toBe(true);
    expect(out).not.toMatch(/^[-*] .*poll/m);
    ed.destroy();
  });
});
