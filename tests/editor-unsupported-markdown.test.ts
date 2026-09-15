// @vitest-environment jsdom
//
// ED-20: README-derived bodies (Skill.descriptionMd) carry constructs the
// editor's schema cannot hold. The scan runs on the editor's OWN markdown-it
// instance, so it reads a body exactly the way the editor is about to — and
// every construct it reports is one an open → edit → save really loses.
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { unsupportedMarkdownConstructs, type MarkdownParserLike } from '@/components/editor/unsupported-markdown';

const ed = new Editor({ extensions: buildRichTextExtensions({ codeHighlight: false }), content: '' });
const md = (ed.storage as unknown as { markdown: { parser: { md: MarkdownParserLike } } }).markdown.parser.md;
const scan = (src: string) => unsupportedMarkdownConstructs(md, src);
/** Open, touch, save — what happens to a body the scan passed as supported. */
const saved = (src: string) => {
  const e = new Editor({ extensions: buildRichTextExtensions({ codeHighlight: false }), content: src });
  const out = (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
  e.destroy();
  return out;
};

describe('unsupportedMarkdownConstructs', () => {
  it('reports each README construct the schema drops', () => {
    expect(scan('[![build](/badge.svg)](https://ci.example.com)')).toEqual(['linked_image']);
    expect(scan('- ![a](/x.png)\n- b')).toEqual(['image_in_list']);
    expect(scan('- [ ] todo\n- [x] done')).toEqual(['task_list']);
    expect(scan('text[^1]\n\n[^1]: note')).toEqual(['footnote']);
    expect(scan('<details><summary>S</summary>\n\nbody\n\n</details>')).toEqual(['html']);
    expect(scan('H<sub>2</sub>O and <kbd>Ctrl</kbd>')).toEqual(['html']);
    expect(scan('<!-- hidden -->\n\ntext')).toEqual(['html']);
    expect(scan('[![a](/a.png)](/x)\n\n- [ ] t\n\n<sup>1</sup>')).toEqual(['linked_image', 'task_list', 'html']);
  });

  it('stays quiet on everything the editor keeps (and the proof: it round-trips)', () => {
    const kept = [
      'plain **bold** `code` [link](/x)',
      'a <span data-color="red">red</span> word',
      '<strong>好的😀</strong>然后',
      '| a | b |\n| --- | --- |\n| 1<br>x | 2 |',
      '![pic](/api/uploads/images/a.png)',
      '<img src="/api/uploads/images/a.png" alt="a" width="120">',
      '- item\n- [link](/x) text',
      '```html\n<details>in code</details>\n```',
      'inline `<kbd>` code',
    ];
    for (const src of kept) {
      expect([src, scan(src)]).toEqual([src, []]);
      expect(saved(src).trimEnd()).toBe(src);
    }
    expect(scan('')).toEqual([]);
  });

  it('a foreign span (not one of the four formats) is foreign', () => {
    expect(scan('<span class="x">y</span>')).toEqual(['html']);
    expect(saved('<span class="x">y</span>')).toBe('y');
  });
});
