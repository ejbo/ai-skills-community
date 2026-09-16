import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { sanitizeSchema } from '@/lib/markdown';
import {
  RICH_BG_COLORS,
  RICH_FONT_FAMILIES,
  RICH_FONT_FAMILY_KEYS,
  RICH_FONT_SIZES,
  RICH_FONT_SIZES_PX,
  RICH_LINE_HEIGHTS,
  RICH_TEXT_COLORS,
} from '@/lib/rich-marks';

// The SAME plugin chain as components/MarkdownRenderer.tsx (sanitize last) —
// the schema is only meaningful in the order it actually runs.
function render(md: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [rehypeRaw, [rehypeHighlight, { ignoreMissing: true, detect: false }], [rehypeSanitize, sanitizeSchema]],
      children: md,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  );
}

describe('sanitizeSchema — shape', () => {
  it('does not whitelist <script> (XSS trust boundary intact)', () => {
    expect(sanitizeSchema.tagNames).not.toContain('script');
  });

  it('still allows GFM table + code tags from the default schema', () => {
    expect(sanitizeSchema.tagNames).toContain('table');
    expect(sanitizeSchema.tagNames).toContain('code');
  });

  it('keeps img + link attributes so rich-text editor output survives', () => {
    expect(sanitizeSchema.attributes?.img).toEqual(expect.arrayContaining(['src', 'alt', 'title']));
    expect(sanitizeSchema.attributes?.a).toEqual(expect.arrayContaining(['href', 'target', 'rel']));
    expect(sanitizeSchema.tagNames).toContain('img');
    expect(sanitizeSchema.tagNames).toContain('a');
  });

  it('never allows <mark>, <font>, <u> or <style>', () => {
    for (const tag of ['mark', 'font', 'u', 'style']) expect(sanitizeSchema.tagNames).not.toContain(tag);
  });

  it('names className at most ONCE per element (sanitize takes the first definition)', () => {
    for (const [tag, defs] of Object.entries(sanitizeSchema.attributes ?? {})) {
      const names = (defs as Array<string | unknown[]>).map((d) => (Array.isArray(d) ? d[0] : d));
      expect([tag, names.filter((n) => n === 'className').length <= 1]).toEqual([tag, true]);
    }
    // `pre` has no class allowance at all.
    expect(sanitizeSchema.attributes?.pre).toBeUndefined();
  });
});

describe('sanitizeSchema — rendered through the real pipeline', () => {
  it('keeps every listed 富文本 value on span', () => {
    for (const v of RICH_TEXT_COLORS) expect(render(`a <span data-color="${v}">x</span>`)).toContain(`<span data-color="${v}">x</span>`);
    for (const v of RICH_BG_COLORS) expect(render(`a <span data-bg="${v}">x</span>`)).toContain(`<span data-bg="${v}">x</span>`);
    for (const v of RICH_FONT_SIZES) expect(render(`a <span data-size="${v}">x</span>`)).toContain(`<span data-size="${v}">x</span>`);
    for (const v of RICH_FONT_FAMILIES) expect(render(`a <span data-font="${v}">x</span>`)).toContain(`<span data-font="${v}">x</span>`);
  });

  it('v3: strict hex colours (RegExp entry), px sizes, every font key, div[data-lh] and sup/sub', () => {
    expect(render('a <span data-color="#1f6feb">x</span>')).toContain('<span data-color="#1f6feb">x</span>');
    expect(render('a <span data-bg="#000000">x</span>')).toContain('<span data-bg="#000000">x</span>');
    for (const bad of ['#1F6FEB', '#abc', '#1f6feb80', '1f6feb', '#1f6feb;color:red']) {
      expect([bad, render(`a <span data-color="${bad}">x</span>`)]).toEqual([bad, '<p>a <span>x</span></p>']);
    }
    for (const n of RICH_FONT_SIZES_PX) expect(render(`<span data-size="${n}">x</span>`)).toContain(`<span data-size="${n}">x</span>`);
    expect(render('<span data-size="24px">x</span>')).toContain('<span>x</span>');
    for (const k of RICH_FONT_FAMILY_KEYS) expect(render(`<span data-font="${k}">x</span>`)).toContain(`<span data-font="${k}">x</span>`);
    for (const v of RICH_LINE_HEIGHTS) {
      expect(render(`<div data-lh="${v}">\n\n**b**\n\n</div>`)).toMatch(new RegExp(`<div data-lh="${v.replace('.', '\\.')}">\\s*<p><strong>b</strong></p>\\s*</div>`));
    }
    expect(render('<div data-lh="1.3" class="fixed">\n\nx\n\n</div>')).toMatch(/<div>\s*<p>x<\/p>\s*<\/div>/);
    expect(render('x<sup>2</sup> H<sub>2</sub>O')).toContain('x<sup>2</sup> H<sub>2</sub>O');
    // The schema still never allows `style` — hex reaches CSS through the post-sanitize plugin only.
    expect(render('<span data-color="#ff0000" style="color:red">x</span>')).toContain('<span data-color="#ff0000">x</span>');
  });

  it('keeps the editor’s nested output, markdown inside the spans, and spans in GFM cells', () => {
    const html = render(
      'hello <span data-size="lg"><span data-font="kai"><span data-bg="yellow"><span data-color="blue">**world** [@王伟](/users/z1) `code`</span></span></span></span>\n\n| a | b |\n| --- | --- |\n| <span data-color="green">1</span> | 2 |',
    );
    expect(html).toContain(
      '<span data-size="lg"><span data-font="kai"><span data-bg="yellow"><span data-color="blue"><strong>world</strong> <a href="/users/z1">@王伟</a> <code>code</code></span></span></span></span>',
    );
    expect(html).toContain('<td><span data-color="green">1</span></td>');
  });

  it('drops bad values, unknown data-*, style and arbitrary classes — the text stays', () => {
    const html = render(
      '<span data-color="expression(alert(1))" data-evil="1" style="color:red" class="fixed inset-0 z-[100]">bad</span> <span data-size="huge" data-font="Comic Sans">big</span>',
    );
    // hast-util-sanitize empties a fully-rejected class list rather than removing it.
    expect(html).toMatch(/<span(?: class="")?>bad<\/span>/);
    expect(html).toContain('<span>big</span>');
    expect(html).not.toMatch(/data-evil|style=|fixed|inset-0|expression|huge|Comic/);
  });

  it('closes the full-page overlay hole on span AND pre', () => {
    const html = render(
      '<a href="https://evil.example"><span class="fixed inset-0 z-[100] block bg-white">会话已过期，点击重新登录</span></a>\n\n<pre class="fixed inset-0 z-[100]">x</pre>',
    );
    expect(html).not.toMatch(/class="[^"]*(fixed|inset-0|z-\[100\]|bg-white)/);
    expect(html).toContain('会话已过期，点击重新登录');
  });

  it('drops <mark>, <font>, <u> and style tags (text kept, formatting gone)', () => {
    const html = render('<mark data-color="yellow">m</mark> <font color="red">f</font> <u>u</u>');
    expect(html).not.toMatch(/<mark|<font|<u>/);
    expect(html).toContain('m');
    expect(html).toContain('f');
    expect(html).toContain('u');
  });

  it('still strips javascript: URLs', () => {
    const html = render('<a href="javascript:alert(1)">x</a> [y](javascript:alert(2)) <img src="javascript:alert(3)">');
    expect(html).not.toContain('javascript:');
  });

  it('highlight.js token spans survive, including hljs 11 sub-scopes', () => {
    const html = render('```js\nclass Foo extends Bar {}\nfunction bar() { return this.x }\nconst s = "str";\n```');
    expect(html).toMatch(/<code class="hljs language-js">/);
    expect(html).toContain('<span class="hljs-keyword">class</span>');
    expect(html).toContain('<span class="hljs-string">&quot;str&quot;</span>');
    // `title.class` / `title.function` → `hljs-title class_` / `hljs-title function_`
    expect(html).toMatch(/<span class="hljs-title class_">Foo<\/span>/);
    expect(html).toMatch(/<span class="hljs-title function_">bar<\/span>/);
    // No class survives on the <pre>.
    expect(html).toMatch(/<pre><code/);
  });

  it('a class on inline code outside the allow list is dropped', () => {
    const html = render('<code class="hljs language-ts fixed inset-0">x</code>');
    expect(html).toContain('<code class="hljs language-ts">x</code>');
  });
});
