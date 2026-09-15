// @vitest-environment jsdom
// 代码块 (Aceternity-style frame) — pins the three halves that must agree:
//   1. lib/markdown-code-lines.ts: the line splitter (shared by the reader's
//      rehype plugin and CodeBlock's hljs HTML) and the fence meta contract;
//   2. MarkdownRenderer: every <pre> is framed, lines are numbered AFTER
//      sanitize, and sanitize still strips what it always stripped;
//   3. the editor node (components/editor/code-block-extension.ts): what it
//      writes into a fence is exactly what the reader and the editor read back.
// jsdom for the whole file because the editor needs a DOM; the renderer half is
// a plain server render and does not depend on it.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
  buildFenceInfo,
  codeFenceFor,
  codeLanguageLabel,
  formatHighlightRanges,
  hljsHtmlToLineNodes,
  hljsHtmlToRanges,
  parseCodeMeta,
  renderCodeLinesHtml,
  splitCodeLines,
  type LineNode,
} from '@/lib/markdown-code-lines';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { changeTouchesCode, codeHighlightKey } from '@/components/editor/code-block-extension';
import { CodeBlockWithView } from '@/components/editor/CodeBlockView';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor, type Editor as ReactEditor } from '@tiptap/react';

// ---------------------------------------------------------------------------
// 1. splitter
// ---------------------------------------------------------------------------

const txt = (value: string): LineNode<string> => ({ type: 'text', value });
const el = (name: string, ...children: LineNode<string>[]): LineNode<string> => ({ type: 'element', el: name, children });

/** Render a line back to a compact string: `name(…)` for elements. */
function show(nodes: LineNode<string>[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : `${n.el}(${show(n.children)})`)).join('');
}

describe('splitCodeLines', () => {
  it('re-opens the whole ancestor chain when a newline sits inside nested spans', () => {
    const { lines, endsWithNewline } = splitCodeLines([
      txt('x = '),
      el('meta', el('string', txt('"""a\nb')), txt('\nc')),
      txt(' end\n'),
    ]);
    expect(lines.map(show)).toEqual(['x = meta(string("""a))', 'meta(string(b))', 'meta(c) end']);
    expect(endsWithNewline).toBe(true);
  });

  it('drops the final empty line only (a fence always ends in a newline)', () => {
    expect(splitCodeLines([txt('a\n')]).lines.map(show)).toEqual(['a']);
    expect(splitCodeLines([txt('a\n\n')]).lines.map(show)).toEqual(['a', '']);
    expect(splitCodeLines([txt('a')])).toEqual({ lines: [[txt('a')]], endsWithNewline: false });
    // Empty code still renders one (empty) line rather than none.
    expect(splitCodeLines([txt('')]).lines).toEqual([[]]);
    expect(splitCodeLines([txt('\n')])).toEqual({ lines: [[]], endsWithNewline: true });
  });

  it('treats CRLF — even split across two tokens — and a lone CR as one break', () => {
    expect(splitCodeLines([txt('a\r\nb\r\n')]).lines.map(show)).toEqual(['a', 'b']);
    expect(splitCodeLines([el('k', txt('a\r')), txt('\nb')]).lines.map(show)).toEqual(['k(a)', 'b']);
    expect(splitCodeLines([txt('a\rb')]).lines.map(show)).toEqual(['a', 'b']);
  });

  it('prunes element clones that received no text', () => {
    const { lines } = splitCodeLines([el('s', txt('\nx'))]);
    expect(lines.map(show)).toEqual(['', 's(x)']);
  });
});

describe('hljs HTML → numbered lines', () => {
  const html = '<span class="hljs-string">&quot;&quot;&quot;doc\nstring&quot;&quot;&quot;</span>\nx = <span class="hljs-number">1</span>\n';

  it('keeps a multi-line token coloured on every line and the text byte-identical', () => {
    const out = renderCodeLinesHtml(html, [2]);
    expect(out.lineCount).toBe(3);
    expect(out.html).toBe(
      '<span class="code-line" data-line="1"><span class="hljs-string">&quot;&quot;&quot;doc</span>\n</span>' +
        '<span class="code-line" data-line="2" data-highlighted=""><span class="hljs-string">string&quot;&quot;&quot;</span>\n</span>' +
        '<span class="code-line" data-line="3">x = <span class="hljs-number">1</span>\n</span>',
    );
    const text = (s: string) => s.replace(/<[^>]+>/g, '');
    expect(text(out.html)).toBe(text(html));
  });

  it('tolerates a stray closing tag and unclosed spans', () => {
    expect(show(hljsHtmlToLineNodes('a</span><span class="x">b'))).toBe('a<span class="x">(b)');
  });

  it('turns hljs HTML into ranges over the unescaped source (innermost class wins)', () => {
    const ranges = hljsHtmlToRanges('<span class="hljs-meta">@<span class="hljs-string">&quot;x&quot;</span></span> &lt;y');
    expect(ranges).toEqual([
      { from: 0, to: 1, className: 'hljs-meta' },
      { from: 1, to: 4, className: 'hljs-string' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// fence meta
// ---------------------------------------------------------------------------

describe('parseCodeMeta', () => {
  it('reads title / filename / bare file names', () => {
    expect(parseCodeMeta('title="main.py"').filename).toBe('main.py');
    expect(parseCodeMeta("title='src/app.ts' {2}").filename).toBe('src/app.ts');
    expect(parseCodeMeta('filename=config.yaml').filename).toBe('config.yaml');
    expect(parseCodeMeta('main.py').filename).toBe('main.py');
    expect(parseCodeMeta('title="my file.txt"').filename).toBe('my file.txt');
  });

  it('reads highlight ranges, sorted and de-duplicated', () => {
    expect(parseCodeMeta('{1,3-5}').highlight).toEqual([1, 3, 4, 5]);
    expect(parseCodeMeta('title="a.js" {5, 2-3,2}').highlight).toEqual([2, 3, 5]);
  });

  it('ignores junk and caps what it allocates', () => {
    expect(parseCodeMeta('showLineNumbers 1.5 {0,a,4-2,-1,7}')).toEqual({ filename: null, highlight: [7] });
    expect(parseCodeMeta(`title="${'x'.repeat(121)}"`).filename).toBeNull();
    expect(parseCodeMeta('title="a\u0007b"').filename).toBeNull();
    expect(parseCodeMeta('{1-100000}').highlight).toHaveLength(1000);
    expect(parseCodeMeta('{1-999999}').highlight).toEqual([]);
    expect(parseCodeMeta(null)).toEqual({ filename: null, highlight: [] });
  });

  it('formats ranges and fence info the way it reads them', () => {
    expect(formatHighlightRanges([5, 1, 3, 4])).toBe('1,3-5');
    expect(buildFenceInfo({ language: 'py', filename: 'main.py', highlight: '3,1-2' })).toBe('py title="main.py" {1-3}');
    expect(buildFenceInfo({ language: null, filename: 'notes.txt' })).toBe('text title="notes.txt"');
    expect(buildFenceInfo({ language: 'js', filename: 'a`b".js' })).toBe('js title="ab.js"');
    expect(buildFenceInfo({})).toBe('');
    expect(codeFenceFor('no ticks')).toBe('```');
    expect(codeFenceFor('a ```` b ` c')).toBe('`````');
  });

  it('labels languages', () => {
    expect(codeLanguageLabel('py')).toBe('Python');
    expect(codeLanguageLabel('typescript')).toBe('TypeScript');
    expect(codeLanguageLabel('text')).toBeNull();
    expect(codeLanguageLabel('zig')).toBe('zig');
    expect(codeLanguageLabel('<script>')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. MarkdownRenderer
// ---------------------------------------------------------------------------

const MESSAGES = {
  ui: {
    code_copy: 'Copy code',
    code_copied: 'Copied',
    code_copy_failed: 'Copy failed',
    code_plain_text: 'Plain text',
    code_language: 'Code language',
    code_filename_label: 'File name',
    code_filename_placeholder: 'File name (optional)',
  },
};

function render(content: string, size: 'default' | 'compact' | 'article' = 'article'): string {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const html = renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale: 'en', messages: MESSAGES, children: createElement(MarkdownRenderer, { content, size }) }),
  );
  const seen = errors.mock.calls.map((c) => String(c[0]));
  errors.mockRestore();
  expect(seen).toEqual([]);
  return html;
}

function preText(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return doc.querySelector('pre')?.textContent ?? '';
}

describe('MarkdownRenderer code frames', () => {
  const md = 'Intro\n\n```py title="main.py" {2}\nimport os\n"""doc\nstring"""\n```\n';

  it('renders the frame hooks: header filename, copy button, numbered + highlighted lines', () => {
    const html = render(md);
    expect(html).toContain('data-code-frame=""');
    expect(html).toContain('not-prose');
    expect(html).toContain('>main.py</span>');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('<span class="code-line" data-line="1">');
    expect(html).toContain('<span class="code-line" data-line="2" data-highlighted="">');
    expect(html).not.toContain('data-line="4"');
    // Highlighting survived sanitize, and the multi-line string is coloured on both lines.
    expect(html).toContain('<span class="hljs-keyword">import</span>');
    expect(html.match(/class="hljs-string"/g)?.length).toBe(2);
    // The code text (what copy and a selection see) is exactly the source.
    expect(preText(html)).toBe('import os\n"""doc\nstring"""\n');
    expect(html).toContain('--code-gutter:2ch');
  });

  it('falls back to the language label, reads bare filenames, and frames fences inside lists', () => {
    expect(render('```ts\nconst a = 1;\n```')).toContain('>TypeScript</span>');
    expect(render('```py app.py\nx\n```')).toContain('>app.py</span>');
    const nested = render('- item\n\n  ```js title="nested.js"\n  a()\n  ```\n\n> ```sh {1}\n> ls\n> ```\n', 'compact');
    expect(nested).toContain('>nested.js</span>');
    expect(nested).toContain('data-highlighted=""');
  });

  it('frames raw-HTML <pre> too, without trusting its attributes', () => {
    const html = render('<pre data-filename="evil.sh" data-highlight="1" class="fixed inset-0">line1\nline2</pre>');
    expect(html).toContain('data-code-frame=""');
    expect(html).toContain('data-line="2"');
    expect(html).not.toContain('evil.sh');
    expect(html).not.toContain('data-highlighted');
    expect(html).not.toContain('inset-0');
  });

  it('still sanitizes: scripts and event handlers are stripped around and inside code', () => {
    const html = render(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n```html\n<script>alert(3)</script>\n```\n\n<pre><code onclick="alert(4)">x</code></pre>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/onerror|onclick/);
    // The fenced one is CODE — shown as escaped, highlighted text, not executed markup.
    expect(html).toContain('&lt;<span class="hljs-name">script</span>&gt;</span>alert(3)');
  });

  it('leaves inline code as the prose chip (no frame)', () => {
    const html = render('call `foo()` now');
    expect(html).toContain('<code>foo()</code>');
    expect(html).not.toContain('data-code-frame');
  });
});

// ---------------------------------------------------------------------------
// 3. editor node: markdown round trip + keys + colouring
// ---------------------------------------------------------------------------

function makeEditor(content: string, highlight = false) {
  return new Editor({
    // The REAL list RichTextEditor registers (components/editor/rich-text-extensions.ts),
    // so the fence contract is pinned together with the flow serializer and marks.
    extensions: buildRichTextExtensions({ codeHighlight: highlight }),
    content,
  });
}

function codeNode(ed: Editor) {
  let found: { attrs: Record<string, unknown>; text: string; pos: number } | null = null;
  ed.state.doc.descendants((n, pos) => {
    if (!found && n.type.name === 'codeBlock') found = { attrs: n.attrs, text: n.textContent, pos };
    return !found;
  });
  if (!found) throw new Error('no codeBlock');
  return found as { attrs: Record<string, unknown>; text: string; pos: number };
}

const md = (ed: Editor): string => ed.storage.markdown.getMarkdown();

describe('editor codeBlock ↔ markdown', () => {
  it('round-trips language, filename and highlight ranges', () => {
    const src = 'before\n\n```py title="main.py" {1,3-4}\nimport os\n\nx = 1\ny = 2\n```\n\nafter';
    const ed = makeEditor(src);
    expect(codeNode(ed).attrs).toMatchObject({ language: 'py', filename: 'main.py', highlight: '1,3-4' });
    expect(codeNode(ed).text).toBe('import os\n\nx = 1\ny = 2');
    expect(md(ed)).toBe(src);
    const again = makeEditor(md(ed));
    expect(md(again)).toBe(src);
    ed.destroy();
    again.destroy();
  });

  it('keeps a bare filename verbatim until it is edited, and keeps a filename without a language', () => {
    const ed = makeEditor('```py app.py\nprint(1)\n```');
    expect(codeNode(ed).attrs).toMatchObject({ language: 'py', filename: 'app.py' });
    // The stored info string still says exactly what the node holds (ED-19).
    expect(md(ed)).toBe('```py app.py\nprint(1)\n```');
    // Once the author changes an attribute, the info string is rebuilt from them.
    ed.commands.command(({ tr }) => {
      tr.setNodeMarkup(codeNode(ed).pos, undefined, { ...codeNode(ed).attrs, filename: 'main.py' });
      return true;
    });
    expect(md(ed)).toBe('```py title="main.py"\nprint(1)\n```');
    ed.commands.setContent('```\nplain\n```');
    expect(codeNode(ed).attrs).toMatchObject({ language: null, filename: null });
    expect(md(ed)).toBe('```\nplain\n```');
    ed.commands.command(({ tr }) => {
      tr.setNodeMarkup(codeNode(ed).pos, undefined, { language: null, filename: 'notes.txt', highlight: null });
      return true;
    });
    expect(md(ed)).toBe('```text title="notes.txt"\nplain\n```');
    ed.destroy();
  });

  it('uses a longer fence when the code itself contains backtick runs', () => {
    const code = 'Use:\n```js\nrun()\n```\nand ```` too';
    const ed = makeEditor('');
    ed.commands.setContent({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'markdown', filename: 'README.md' }, content: [{ type: 'text', text: code }] }],
    });
    const out = md(ed);
    expect(out.startsWith('`````markdown title="README.md"\n')).toBe(true);
    const back = makeEditor(out);
    expect(codeNode(back).text).toBe(code);
    expect(codeNode(back).attrs).toMatchObject({ language: 'markdown', filename: 'README.md' });
    expect(md(back)).toBe(out);
    // And the reader parses the same fence into one block with the same text.
    expect(preText(render(out))).toBe(`${code}\n`);
    ed.destroy();
    back.destroy();
  });

  it('Tab indents, Shift-Tab outdents, and both stay inside the block', () => {
    const ed = makeEditor('```js\na\nb\nc\n```');
    const { pos } = codeNode(ed);
    // caret at start of "a"
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos + 1)));
    ed.commands.keyboardShortcut('Tab');
    expect(codeNode(ed).text).toBe('  a\nb\nc');
    // select from inside "a" to inside "b": both lines indent
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos + 4, pos + 6)));
    ed.commands.keyboardShortcut('Tab');
    expect(codeNode(ed).text).toBe('    a\n  b\nc');
    ed.commands.keyboardShortcut('Shift-Tab');
    expect(codeNode(ed).text).toBe('  a\nb\nc');
    ed.destroy();
  });

  // ED-19: info strings the node cannot model were rebuilt from the parsed parts
  // and erased on the next save.
  it('an info string the node cannot model round-trips verbatim; an edit rebuilds it', () => {
    for (const info of ['js{1,3}', 'jsx:title=src/App.js', '{r}', 'js=5', '{1,3}', 'title="x.txt"', "py title='a\"b.py'", 'ts twoslash', 'py main.py {2}']) {
      const src = `\`\`\`${info}\nconst a = 1;\n\`\`\``;
      const ed = makeEditor(src);
      expect([info, md(ed)]).toEqual([info, src]);
      const again = makeEditor(md(ed));
      expect([info, md(again)]).toEqual([info, src]);
      ed.destroy();
      again.destroy();
    }
    const ed = makeEditor('```js{1,3}\nx\n```');
    ed.commands.command(({ tr }) => {
      tr.setNodeMarkup(codeNode(ed).pos, undefined, { ...codeNode(ed).attrs, language: 'python' });
      return true;
    });
    expect(md(ed)).toBe('```python\nx\n```');
    ed.destroy();
  });

  // ED-20: the parse drops one trailing newline and `ensureNewLine` added none
  // back — one blank line at the end of the code was lost on every save.
  it('trailing blank lines in code survive repeated saves; an empty block stays empty', () => {
    for (const src of ['```\na\n\n\n```', '```py\nx = 1\n\n```', '- item\n\n  ```js\n  a\n\n  ```', '> ```\n> a\n>\n> ```', '```\n```']) {
      const first = makeEditor(src);
      const code = codeNode(first).text;
      let body = md(first);
      first.destroy();
      for (let i = 0; i < 3; i++) {
        const ed = makeEditor(body);
        expect([src, codeNode(ed).text]).toEqual([src, code]);
        const next = md(ed);
        // Byte-identical from the first save on (inside a list / quote the blank
        // line is written with the item's indent / `> ` — same code, same reader output).
        expect([src, next]).toEqual([src, body]);
        body = next;
        ed.destroy();
      }
      if (src.startsWith('`')) expect([src, body]).toEqual([src, src]);
    }
  });

  // ED-26: Enter started every new line at column 0.
  describe('Enter keeps the indentation', () => {
    const press = (ed: Editor, key: string, shift = false) =>
      ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true })));
    const type = (ed: Editor, text: string) => ed.view.dispatch(ed.state.tr.insertText(text));
    const caretAtEnd = (ed: Editor) => {
      const at = codeNode(ed);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at.pos + 1 + at.text.length)));
    };

    it('Python: Enter, Tab (4 spaces), Enter keeps the level', () => {
      const ed = makeEditor('```python\ndef quantize(model):\n```');
      caretAtEnd(ed);
      press(ed, 'Enter');
      press(ed, 'Tab');
      type(ed, 'for m in model.modules():');
      press(ed, 'Enter');
      type(ed, 'x');
      expect(codeNode(ed).text).toBe('def quantize(model):\n    for m in model.modules():\n    x');
      ed.destroy();
    });

    it('other languages indent by two spaces; Shift-Tab removes one step', () => {
      const ed = makeEditor('```js\nif (a) {\n```');
      caretAtEnd(ed);
      press(ed, 'Enter');
      press(ed, 'Tab');
      type(ed, 'b();');
      expect(codeNode(ed).text).toBe('if (a) {\n  b();');
      press(ed, 'Tab', true);
      expect(codeNode(ed).text).toBe('if (a) {\nb();');
      ed.destroy();
    });

    it('Enter inside the indentation does not double it', () => {
      const ed = makeEditor('```js\n    x\n```');
      const at = codeNode(ed);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at.pos + 1 + 2)));
      press(ed, 'Enter');
      expect(codeNode(ed).text).toBe('  \n    x');
      ed.destroy();
    });

    it('triple Enter still exits from an indented line, leaving no blank tail', () => {
      const ed = makeEditor('```py\nif a:\n    b\n```');
      caretAtEnd(ed);
      press(ed, 'Enter');
      expect(codeNode(ed).text).toBe('if a:\n    b\n    ');
      press(ed, 'Enter');
      expect(codeNode(ed).text).toBe('if a:\n    b\n\n    ');
      press(ed, 'Enter');
      expect(ed.state.selection.$from.parent.type.name).toBe('paragraph');
      expect(codeNode(ed).text).toBe('if a:\n    b');
      ed.destroy();
    });
  });

  // ED-34: every keystroke anywhere walked the whole doc (hljs not loaded) or,
  // once loaded, rebuilt and re-dispatched after every pause.
  it('changeTouchesCode sees only edits that involve a code block', () => {
    const ed = makeEditor('intro\n\n```js\nconst a = 1;\n```\n\nafter');
    const snap = () => ed.state.doc;
    const touched = (edit: () => void) => {
      const before = snap();
      edit();
      return changeTouchesCode(before, snap(), 'codeBlock');
    };
    expect(touched(() => ed.commands.insertContentAt(2, 'x'))).toBe(false); // in "intro"
    expect(touched(() => ed.commands.insertContentAt(ed.state.doc.content.size - 2, 'y'))).toBe(false); // in "after"
    expect(touched(() => ed.view.dispatch(ed.state.tr.insertText('z', codeNode(ed).pos + 3)))).toBe(true); // in the code
    expect(
      touched(() =>
        ed.commands.command(({ tr }) => {
          tr.setNodeMarkup(codeNode(ed).pos, undefined, { ...codeNode(ed).attrs, language: 'ts' });
          return true;
        }),
      ),
    ).toBe(true);
    expect(touched(() => ed.commands.deleteRange({ from: codeNode(ed).pos, to: codeNode(ed).pos + ed.state.doc.nodeAt(codeNode(ed).pos)!.nodeSize }))).toBe(true);
    expect(touched(() => ed.commands.insertContentAt(0, { type: 'codeBlock', attrs: { language: 'py' }, content: [{ type: 'text', text: 'x' }] }))).toBe(true);
    ed.destroy();
  });

  it('once highlight.js is loaded, a pause after typing OUTSIDE code dispatches nothing', async () => {
    const ed = makeEditor('intro\n\n```js\nconst a = "s";\n```\n\nafter', true);
    for (let i = 0; i < 100 && (codeHighlightKey.getState(ed.state)?.find() ?? []).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 30));
    }
    expect((codeHighlightKey.getState(ed.state)?.find() ?? []).length).toBeGreaterThan(0);
    let metas = 0;
    ed.on('transaction', ({ transaction }) => {
      if (transaction.getMeta(codeHighlightKey)) metas += 1;
    });
    ed.commands.insertContentAt(2, 'typing');
    await new Promise((r) => setTimeout(r, 400));
    expect(metas).toBe(0);
    // A NEW token (the number) — plain text would only shift ranges the mapping already moved.
    ed.view.dispatch(ed.state.tr.insertText(' let b = 42;', codeNode(ed).pos + 1 + codeNode(ed).text.length));
    await new Promise((r) => setTimeout(r, 400));
    expect(metas).toBeGreaterThan(0);
    ed.destroy();
  });

  it('keeps upstream exits: ArrowDown at the end and triple Enter leave the block', () => {
    // Straight through handleKeyDown: the keyboardShortcut command replays only
    // the captured STEPS, so a selection move would be lost in the test.
    const press = (ed: Editor, key: string) =>
      ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    const ed = makeEditor('```js\nx\n```');
    const { pos } = codeNode(ed);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos + 2)));
    press(ed, 'ArrowDown');
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph');

    const ed2 = makeEditor('');
    ed2.commands.setContent({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'x\n\n' }] }] });
    const at = codeNode(ed2);
    ed2.view.dispatch(ed2.state.tr.setSelection(TextSelection.create(ed2.state.doc, at.pos + 1 + at.text.length)));
    press(ed2, 'Enter');
    expect(ed2.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(codeNode(ed2).text).toBe('x');
    ed.destroy();
    ed2.destroy();
  });

  it('colours tokens with decorations once highlight.js has loaded, without touching the document', async () => {
    const ed = makeEditor('```js\nconst a = "s";\n```', true);
    const updates = vi.fn();
    ed.on('update', updates);
    const before = md(ed);
    let classes: string[] = [];
    for (let i = 0; i < 100 && classes.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 30));
      classes = (codeHighlightKey.getState(ed.state)?.find() ?? []).map((d) => String((d as unknown as { type: { attrs: { class: string } } }).type.attrs.class));
    }
    expect(classes).toContain('hljs-keyword');
    expect(classes).toContain('hljs-string');
    expect(updates).not.toHaveBeenCalled();
    expect(md(ed)).toBe(before);
    expect(ed.view.dom.querySelector('.hljs-keyword')?.textContent).toBe('const');
    ed.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. the React node view (what the integrator registers)
// ---------------------------------------------------------------------------

describe('CodeBlockWithView', () => {
  it('mounts the frame around editable code and writes header edits back to markdown', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    let editor: ReactEditor | null = null;
    function Harness() {
      const ed = useEditor({
        extensions: buildRichTextExtensions({ codeHighlight: false, views: { codeBlock: CodeBlockWithView } }),
        content: '```py title="main.py"\na = 1\nb = 2\n```',
      });
      editor = ed;
      return createElement(EditorContent, { editor: ed });
    }
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(NextIntlClientProvider, { locale: 'en', messages: MESSAGES, children: createElement(Harness) }));
    });
    for (let i = 0; i < 20 && !host.querySelector('.code-frame [data-node-view-content]'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    const frame = host.querySelector('.code-frame') as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.className).toContain('not-prose');
    const select = frame.querySelector('select') as HTMLSelectElement;
    const input = frame.querySelector('input') as HTMLInputElement;
    // `py` is not a picker value, so it is kept as an extra, labelled option.
    expect(select.value).toBe('py');
    expect(select.selectedOptions[0].textContent).toBe('Python');
    expect(input.value).toBe('main.py');
    expect(frame.querySelector('.code-frame-gutter')?.textContent).toBe('1\n2');
    // The editable text lives inside the frame's <pre><code>.
    expect(frame.querySelector('pre code [data-node-view-content-react]')?.textContent).toBe('a = 1\nb = 2');

    await act(async () => {
      select.value = 'rust';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(input, 'lib`"\u0007.rs');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const out = (editor as unknown as Editor).storage.markdown.getMarkdown();
    expect(out).toBe('```rust title="lib.rs"\na = 1\nb = 2\n```');
    expect(input.value).toBe('lib.rs');

    await act(async () => root.unmount());
    host.remove();
  });
});
