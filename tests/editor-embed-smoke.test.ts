// @vitest-environment jsdom
// Headless smoke test of the two riskiest editor embed mechanisms. The node
// definitions REPLICATE components/RichTextEditor.tsx (nodeview omitted — it
// needs a live editor view); if you change StickerImageNode / the poll
// insertion there, mirror it here. Guards against tiptap upgrades silently
// breaking:
// 1) inline sticker node round-trips markdown and wins parse priority
// 2) poll token insertion lifts to top level from inside a blockquote
import { describe, expect, it } from 'vitest';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';

const STICKER_URL_PREFIX = '/api/uploads/stickers/';

const BaseImage = Image.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const { src, alt, title } = node.attrs;
          state.write(
            '![' + state.esc(alt || '') + '](' + String(src ?? '').replace(/[()]/g, '\\$&') +
            (title ? ' "' + String(title).replace(/"/g, '\\"') + '"' : '') + ')',
          );
        },
      },
    };
  },
});

const StickerImageNode = BaseImage.extend({
  name: 'stickerImage',
  draggable: false,
  inline() { return true; },
  group() { return 'inline'; },
  addCommands() { return {}; },
  parseHTML() {
    return [{ tag: `img[src^="${STICKER_URL_PREFIX}"]`, priority: 100 }];
  },
});

function makeEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      BaseImage,
      StickerImageNode,
      Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
    ],
    content,
  });
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

describe('poll token top-level insertion', () => {
  const insert = (ed: Editor, id: string) => {
    const { $to } = ed.state.selection;
    const pos = $to.depth === 0 ? $to.pos : $to.after(1);
    ed.chain().insertContentAt(pos, [
      { type: 'paragraph', content: [{ type: 'text', text: `[poll:${id}]` }] },
      { type: 'paragraph' },
    ]).run();
  };
  const OWN_LINE = /^ {0,3}\\?\[poll:([a-z0-9]{8,40})\\?\][ \t]*$/m;

  it('from inside a blockquote the token lands top-level and own-line', () => {
    const ed = makeEditor('> quoted text');
    ed.commands.setTextSelection(5); // inside the blockquote
    insert(ed, 'clxyz12345abcde');
    const out = ed.storage.markdown.getMarkdown();
    expect(OWN_LINE.test(out)).toBe(true);
    expect(out).not.toMatch(/^>.*poll/m); // not nested in the quote
    ed.destroy();
  });

  it('from a plain paragraph too', () => {
    const ed = makeEditor('hello');
    ed.commands.setTextSelection(3);
    insert(ed, 'clxyz12345abcde');
    expect(OWN_LINE.test(ed.storage.markdown.getMarkdown())).toBe(true);
    ed.destroy();
  });

  it('from inside a bullet list', () => {
    const ed = makeEditor('- item one\n- item two');
    ed.commands.setTextSelection(6);
    insert(ed, 'clxyz12345abcde');
    const out = ed.storage.markdown.getMarkdown();
    expect(OWN_LINE.test(out)).toBe(true);
    expect(out).not.toMatch(/^[-*] .*poll/m);
    ed.destroy();
  });
});
