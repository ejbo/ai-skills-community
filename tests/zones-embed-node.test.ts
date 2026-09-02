// @vitest-environment jsdom
// Headless smoke test of the 技术专区 in-editor embed node (the REAL extension,
// minus its React nodeview): own-line `[embed:<kind>:<ref>]` tokens
// materialize as `contentEmbed` nodes, serialize back to the own-line token,
// and picker insertion lifts to the document top level from a nested caret.
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { ContentEmbedBase, insertContentEmbed, parseInDocEmbedToken, removeContentEmbeds } from '@/components/zones/embeds/embed-node-extension';
import { EMBED_TOKEN_RE, splitEmbedSegments } from '@/lib/zones/shared';

function makeEditor(content: string) {
  return new Editor({
    extensions: [StarterKit, ContentEmbedBase, Markdown.configure({ html: true, transformPastedText: true, breaks: false })],
    content,
  });
}

const nodes = (ed: Editor) => {
  const out: { kind: string; ref: string }[] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'contentEmbed') out.push({ kind: String(n.attrs.kind), ref: String(n.attrs.ref) });
    return true;
  });
  return out;
};

const ownLine = (md: string) => md.split('\n').some((line) => EMBED_TOKEN_RE.test(line));

describe('parseInDocEmbedToken', () => {
  it('accepts every kind and validates the ref for its kind', () => {
    expect(parseInDocEmbedToken('[embed:library:my-doc_1]')).toEqual({ kind: 'library', ref: 'my-doc_1' });
    expect(parseInDocEmbedToken('[embed:link:https://example.com/a?b=1]')).toEqual({ kind: 'link', ref: 'https://example.com/a?b=1' });
    expect(parseInDocEmbedToken('[embed:skill:has space]')).toBeNull();
    expect(parseInDocEmbedToken('[embed:link:ftp://x]')).toBeNull();
    expect(parseInDocEmbedToken('[embed:unknown:abc]')).toBeNull();
    expect(parseInDocEmbedToken('see [embed:skill:abc] inline')).toBeNull();
  });

  it('file refs accept a storage key (attachment kinds only) as well as a row id', () => {
    expect(parseInDocEmbedToken('[embed:file:file/abc.pdf]')).toEqual({ kind: 'file', ref: 'file/abc.pdf' });
    expect(parseInDocEmbedToken('[embed:file:image/V1StGXR8_Z5jdHi6B-myT.png]')).toEqual({ kind: 'file', ref: 'image/V1StGXR8_Z5jdHi6B-myT.png' });
    expect(parseInDocEmbedToken('[embed:file:clxyz123]')).toEqual({ kind: 'file', ref: 'clxyz123' });
    expect(parseInDocEmbedToken('[embed:file:cover/x.jpg]')).toBeNull();
    expect(parseInDocEmbedToken('[embed:skill:file/x.pdf]')).toBeNull();
  });
});

describe('contentEmbed node', () => {
  it('loading markdown with an own-line token materializes the node (initial normalize) and round-trips', async () => {
    const ed = makeEditor('before\n\n[embed:skill:my-skill]\n\nafter');
    await new Promise((r) => setTimeout(r, 0));
    expect(nodes(ed)).toEqual([{ kind: 'skill', ref: 'my-skill' }]);
    const out = ed.storage.markdown.getMarkdown();
    expect(ownLine(out)).toBe(true);
    // The renderer's splitter sees exactly one embed segment.
    expect(splitEmbedSegments(out).filter((s) => s.type === 'embed')).toHaveLength(1);
    ed.destroy();
  });

  it('setContent (controlled sync) normalizes via appendTransaction', () => {
    const ed = makeEditor('plain');
    ed.commands.setContent('[embed:library:doc-slug]', false);
    expect(nodes(ed)).toEqual([{ kind: 'library', ref: 'doc-slug' }]);
    ed.destroy();
  });

  it('link refs keep their URL through the round trip', async () => {
    const ed = makeEditor('[embed:link:https://example.com/path?q=1]');
    await new Promise((r) => setTimeout(r, 0));
    expect(nodes(ed)).toEqual([{ kind: 'link', ref: 'https://example.com/path?q=1' }]);
    const out = ed.storage.markdown.getMarkdown();
    const seg = splitEmbedSegments(out).find((s) => s.type === 'embed');
    expect(seg && seg.type === 'embed' ? seg.ref : null).toBe('https://example.com/path?q=1');
    ed.destroy();
  });

  it('inline mentions and non-token text never become nodes', () => {
    const ed = makeEditor('see [embed:skill:abc] inline');
    expect(nodes(ed)).toEqual([]);
    ed.destroy();
  });

  it('insertion from a blockquote caret lands top-level and round-trips', () => {
    const ed = makeEditor('> quoted text');
    ed.commands.setTextSelection(5);
    insertContentEmbed(ed, 'event', 'evt123');
    expect(nodes(ed)).toEqual([{ kind: 'event', ref: 'evt123' }]);
    const out = ed.storage.markdown.getMarkdown();
    expect(ownLine(out)).toBe(true);
    expect(out).not.toMatch(/^>.*embed/m);
    ed.destroy();
  });

  it('insertion from a bullet list caret lands top-level', () => {
    const ed = makeEditor('- item one\n- item two');
    ed.commands.setTextSelection(6);
    insertContentEmbed(ed, 'post', 'clpost1');
    const out = ed.storage.markdown.getMarkdown();
    expect(ownLine(out)).toBe(true);
    expect(out).not.toMatch(/^[-*] .*embed/m);
    ed.destroy();
  });

  it('a key-form file token round-trips with the key intact (the upload plugin inserts keys)', async () => {
    const ed = makeEditor('[embed:file:file/abc.pdf]');
    await new Promise((r) => setTimeout(r, 0));
    expect(nodes(ed)).toEqual([{ kind: 'file', ref: 'file/abc.pdf' }]);
    const out = ed.storage.markdown.getMarkdown();
    expect(ownLine(out)).toBe(true);
    const seg = splitEmbedSegments(out).find((s) => s.type === 'embed');
    expect(seg && seg.type === 'embed' ? seg.ref : null).toBe('file/abc.pdf');
    ed.destroy();
  });

  it('a key-form file insert from a list caret lands top-level', () => {
    const ed = makeEditor('- item one\n- item two');
    ed.commands.setTextSelection(6);
    insertContentEmbed(ed, 'file', 'file/abc.pdf');
    expect(nodes(ed)).toEqual([{ kind: 'file', ref: 'file/abc.pdf' }]);
    const out = ed.storage.markdown.getMarkdown();
    expect(ownLine(out)).toBe(true);
    expect(out).not.toMatch(/^[-*] .*embed/m);
    ed.destroy();
  });
});

// The composer's attachment ledger removes a row's body card THROUGH the editor
// (a bodyMd rewrite would come back as a whole-document setContent and take the
// other files' in-flight upload placeholders with it — tests/zones-file-upload-plugin.test.ts).
describe('removeContentEmbeds', () => {
  it('deletes both ref forms of one attachment and leaves every other card standing', async () => {
    const ed = makeEditor('a\n\n[embed:file:file/abc.pdf]\n\nb\n\n[embed:file:cm123]\n\n[embed:skill:my-skill]\n\nc');
    await new Promise((r) => setTimeout(r, 0));
    expect(nodes(ed)).toHaveLength(3);
    expect(removeContentEmbeds(ed, 'file', ['file/abc.pdf', 'cm123'])).toBe(2);
    expect(nodes(ed)).toEqual([{ kind: 'skill', ref: 'my-skill' }]);
    const out = ed.storage.markdown.getMarkdown();
    expect(out).not.toContain('[embed:file:');
    expect(out).toContain('[embed:skill:my-skill]');
    expect(out).toContain('a');
    expect(out).toContain('c');
    ed.destroy();
  });

  it('only touches the given kind, ignores unknown refs and reports how many it removed', async () => {
    // Same ref string under two kinds — a `file` removal must not take the library card.
    const ed = makeEditor('[embed:file:cm123]\n\n[embed:library:cm123]');
    await new Promise((r) => setTimeout(r, 0));
    expect(removeContentEmbeds(ed, 'file', ['nope'])).toBe(0);
    expect(removeContentEmbeds(ed, 'file', [])).toBe(0);
    expect(nodes(ed)).toHaveLength(2);
    expect(removeContentEmbeds(ed, 'file', ['cm123'])).toBe(1);
    expect(nodes(ed)).toEqual([{ kind: 'library', ref: 'cm123' }]);
    ed.destroy();
  });

  it('removes every occurrence of a repeated ref in one transaction (undoable as one step)', async () => {
    const ed = makeEditor('[embed:file:file/abc.pdf]\n\nmiddle\n\n[embed:file:file/abc.pdf]');
    await new Promise((r) => setTimeout(r, 0));
    expect(removeContentEmbeds(ed, 'file', ['file/abc.pdf'])).toBe(2);
    expect(nodes(ed)).toEqual([]);
    expect(ed.storage.markdown.getMarkdown()).toContain('middle');
    ed.commands.undo();
    expect(nodes(ed)).toHaveLength(2);
    ed.destroy();
  });
});
