// @vitest-environment jsdom
//
// 富文本格式标记, headless, on the REAL stack — buildRichTextExtensions
// (components/editor/rich-text-extensions.ts), the list RichTextEditor registers:
// StarterKit (code + codeBlock off) + Link + GFM tables + the @人 suggestion +
// images + CodeBlock + FORMAT_MARK_EXTENSIONS + tiptap-markdown + the flow
// serializer. The flow serializer matters here: it rewrites how emphasis
// delimiters settle next to the spans these marks write.
// The stored markdown IS the contract (lib/rich-marks.ts), so every case pins
// the exact bytes and then proves a second (and third) open → save is
// byte-identical — an editor that re-writes a body differently on every save
// turns "open and close" into an edit.
//
// React node views are omitted (they need a live view); nothing else differs.
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import {
  INLINE_CODE_PRIORITY,
  RICH_MARK_PRIORITY,
  activeRichMarkValue,
} from '@/components/editor/format-marks';
import { extractMentionHandles } from '@/lib/mentions';
import { RICH_MARK_KINDS, RICH_MARK_NAME, RICH_SPAN_TAG_RE } from '@/lib/rich-marks';

function makeEditor(content = '') {
  return new Editor({ extensions: buildRichTextExtensions(), content });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const md = (ed: Editor): string => (ed.storage as any).markdown.getMarkdown();

/** Doc positions of `needle` inside one textblock (may span several text nodes). */
function rangeOf(ed: Editor, needle: string, nth = 0): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  let seen = 0;
  ed.state.doc.descendants((node, pos) => {
    if (found || !node.isTextblock) return !found;
    const at: number[] = [];
    let text = '';
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i += 1) at.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        at.push(pos + 1 + offset);
        text += '\uFFFC';
      }
    });
    let i = text.indexOf(needle);
    while (i >= 0) {
      if (seen === nth) {
        found = { from: at[i], to: at[i + needle.length - 1] + 1 };
        return false;
      }
      seen += 1;
      i = text.indexOf(needle, i + 1);
    }
    return false;
  });
  if (!found) throw new Error(`"${needle}" not found`);
  return found;
}

function select(ed: Editor, needle: string, nth = 0) {
  ed.commands.setTextSelection(rangeOf(ed, needle, nth));
}

/** Open the stored markdown again, twice: both saves must reproduce it exactly. */
function expectStable(stored: string) {
  const once = makeEditor(stored);
  const a = md(once);
  const b = md(makeEditor(a));
  once.destroy();
  expect(a).toBe(stored);
  expect(b).toBe(stored);
}

/** Text runs with their mark names, for asserting what the doc actually holds. */
function runs(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.isText) out.push(`${n.text}:${n.marks.map((m) => (m.attrs.value ? `${m.type.name}=${m.attrs.value}` : m.type.name)).join('+')}`);
  });
  return out;
}

describe('schema order (priority is the nesting contract)', () => {
  it('fontSize > fontFamily > textBg > textColor > link > bold > italic > strike > code', () => {
    const ed = makeEditor();
    expect(Object.keys(ed.schema.marks)).toEqual([
      'fontSize',
      'fontFamily',
      'textBg',
      'textColor',
      'link',
      'bold',
      'italic',
      'strike',
      'code',
    ]);
    expect(RICH_MARK_PRIORITY.color).toBeGreaterThan(1000); // above Link
    expect(INLINE_CODE_PRIORITY).toBeLessThan(100); // below bold/italic/strike
    ed.destroy();
  });
});

describe('format marks — stored shape and round trip', () => {
  it('colour inside a paragraph', () => {
    const ed = makeEditor('前文 重点 后文');
    select(ed, '重点');
    expect(ed.commands.setTextColor('red')).toBe(true);
    const stored = md(ed);
    expect(stored).toBe('前文 <span data-color="red">重点</span> 后文');
    expectStable(stored);
  });

  it('every kind stores exactly one data attribute on its own span', () => {
    const cases = [
      ['setTextBg', 'yellow', '<span data-bg="yellow">词</span>'],
      ['setFontSize', 'xl', '<span data-size="xl">词</span>'],
      ['setFontFamily', 'mono', '<span data-font="mono">词</span>'],
    ] as const;
    for (const [cmd, value, want] of cases) {
      const ed = makeEditor('一 词 二');
      select(ed, '词');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((ed.commands as any)[cmd](value)).toBe(true);
      expect(md(ed)).toBe(`一 ${want} 二`);
      expect(ed.getHTML()).toContain(want);
      ed.destroy();
    }
  });

  it('across a bold boundary', () => {
    const ed = makeEditor('这**是粗体**文字');
    select(ed, '粗体文');
    ed.commands.setTextColor('blue');
    const stored = md(ed);
    expect(stored).toBe('这**是**<span data-color="blue">**粗体**文</span>字');
    expectStable(stored);
  });

  it('one CJK character inside a bold run (the flanking case that corrupts below priority 101)', () => {
    const ed = makeEditor('这**是粗体**文字');
    select(ed, '体');
    ed.commands.setTextColor('red');
    const stored = md(ed);
    expect(stored).toBe('这**是粗**<span data-color="red">**体**</span>文字');
    expectStable(stored);
    const back = makeEditor(stored);
    expect(runs(back)).toEqual(['这:', '是粗:bold', '体:textColor=red+bold', '文字:']);
  });

  it('a coloured @mention keeps the link INSIDE the span, so extraction still finds the handle', () => {
    const ed = makeEditor('[@王伟](/users/z84412632) 你好');
    select(ed, '@王伟');
    ed.commands.setTextColor('red');
    const stored = md(ed);
    expect(stored).toBe('<span data-color="red">[@王伟](/users/z84412632)</span> 你好');
    expect(extractMentionHandles(stored)).toEqual(['z84412632']);
    expectStable(stored);
  });

  it('formatting PART of a mention formats the whole mention (never two broken chips)', () => {
    const ed = makeEditor('嗨 [@王伟](/users/z84412632) 你好');
    select(ed, '伟 你'); // starts inside the mention
    ed.commands.setTextBg('yellow');
    const stored = md(ed);
    expect(stored).toBe('嗨 <span data-bg="yellow">[@王伟](/users/z84412632) 你</span>好');
    expect(extractMentionHandles(stored)).toEqual(['z84412632']);
    expectStable(stored);
    // …and removing it from part of the mention removes it from all of it.
    select(ed, '王');
    ed.commands.unsetTextBg();
    expect(md(ed)).toBe('嗨 [@王伟](/users/z84412632)<span data-bg="yellow"> 你</span>好');
    ed.destroy();
  });

  it('an ordinary link partly coloured splits into two anchors — stable', () => {
    const ed = makeEditor('see [document](/x) now');
    select(ed, 'docu');
    ed.commands.setTextColor('green');
    const stored = md(ed);
    expect(stored).toBe('see <span data-color="green">[docu](/x)</span>[ment](/x) now');
    expectStable(stored);
  });

  it('inside a GFM table cell — the table stays a GFM table', () => {
    const ed = makeEditor('| a | b |\n| --- | --- |\n| 1 | 2 |');
    select(ed, '1');
    ed.commands.setTextColor('green');
    const stored = md(ed);
    expect(stored).toBe('| a | b |\n| --- | --- |\n| <span data-color="green">1</span> | 2 |\n');
    expect(stored).not.toContain('<table');
    expectStable(stored);
  });

  it('inside a raw-HTML table (merged cells) the span rides the HTML verbatim', () => {
    const html =
      '<table><tbody><tr><th colspan="2"><p>h</p></th></tr><tr><td><p><span data-color="green">x</span></p></td><td><p>y</p></td></tr></tbody></table>';
    const ed = makeEditor(html);
    const stored = md(ed);
    expect(stored).toContain('<span data-color="green">x</span>');
    expectStable(stored);
  });

  it('nested colour + background + size + font nest in the fixed order, stable', () => {
    const ed = makeEditor('hello world');
    select(ed, 'world');
    ed.chain().setTextColor('blue').setTextBg('yellow').setFontSize('lg').setFontFamily('kai').run();
    const stored = md(ed);
    expect(stored).toBe(
      'hello <span data-size="lg"><span data-font="kai"><span data-bg="yellow"><span data-color="blue">world</span></span></span></span>',
    );
    expectStable(stored);
    // The same four applied in the reverse order store the same bytes.
    const ed2 = makeEditor('hello world');
    select(ed2, 'world');
    ed2.chain().setFontFamily('kai').setFontSize('lg').setTextBg('yellow').setTextColor('blue').run();
    expect(md(ed2)).toBe(stored);
  });

  it('overlapping ranges of different kinds stay well-formed', () => {
    const ed = makeEditor('一二三四五');
    select(ed, '一二三');
    ed.commands.setTextColor('red');
    select(ed, '三四五');
    ed.commands.setTextBg('teal');
    const stored = md(ed);
    expect(stored).toBe(
      '<span data-color="red">一二</span><span data-bg="teal"><span data-color="red">三</span>四五</span>',
    );
    expectStable(stored);
  });

  it('a heading and a list item carry formatting', () => {
    const ed = makeEditor('## 前 红 后\n\n- 项 目');
    select(ed, '红');
    ed.commands.setTextColor('purple');
    select(ed, '目');
    ed.commands.setFontSize('sm');
    const stored = md(ed);
    expect(stored).toBe('## 前 <span data-color="purple">红</span> 后\n\n- 项 <span data-size="sm">目</span>');
    expectStable(stored);
  });

  it('stored spans match RICH_SPAN_TAG_RE (the plain-text helpers’ contract)', () => {
    const stored =
      '<span data-size="xl"><span data-font="serif"><span data-bg="pink"><span data-color="orange">x</span></span></span></span>';
    const ed = makeEditor(`a ${stored} b`);
    expect(md(ed).replace(RICH_SPAN_TAG_RE, '')).toBe('a x b');
    ed.destroy();
  });
});

describe('format marks — parsing is a closed door', () => {
  it('drops an invalid value, a style colour and an unknown data-* on parse (text kept)', () => {
    const ed = makeEditor(
      'a <span data-color="nope">x</span> <span style="color: rgb(225, 29, 72)">y</span> <span data-colour="red">z</span> <span data-size="24px">w</span>',
    );
    expect(md(ed)).toBe('a x y z w');
    ed.destroy();
  });

  it('pasted web/Word HTML with inline colours imports as plain text', () => {
    const ed = makeEditor('<p>起止</p>');
    ed.commands.setTextSelection(rangeOf(ed, '止').from);
    // The real clipboard path: ProseMirror parses text/html with the schema's
    // parse rules. jsdom has no ClipboardEvent; pasteHTML only needs the type.
    const g = globalThis as { ClipboardEvent?: unknown };
    if (typeof g.ClipboardEvent === 'undefined') {
      g.ClipboardEvent = class extends Event {
        clipboardData = null;
      };
    }
    ed.view.pasteHTML(
      '<meta charset="utf-8"><p><span style="color:#c00;background:yellow;font-size:24pt;font-family:SimSun">红字</span><font color="red">旧</font><mark>亮</mark></p>',
    );
    expect(md(ed)).toBe('起红字旧亮止');
    // …while our own stored shape, copied between two editors, keeps its format.
    ed.commands.setTextSelection(rangeOf(ed, '止').from);
    ed.view.pasteHTML('<p><span data-color="green">绿</span></p>');
    expect(md(ed)).toBe('起红字旧亮<span data-color="green">绿</span>止');
    ed.destroy();
  });

  it('a span carrying several formats yields every mark, re-stored as nested spans', () => {
    const ed = makeEditor('a <span data-color="red" data-bg="yellow" data-size="lg" data-font="mono">y</span> b');
    expect(runs(ed)).toEqual(['a :', 'y:fontSize=lg+fontFamily=mono+textBg=yellow+textColor=red', ' b:']);
    expect(md(ed)).toBe(
      'a <span data-size="lg"><span data-font="mono"><span data-bg="yellow"><span data-color="red">y</span></span></span></span> b',
    );
    ed.destroy();
  });

  it('the commands refuse values outside the closed set', () => {
    const ed = makeEditor('一 词 二');
    select(ed, '词');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = ed.commands as any;
    expect(c.setTextColor('#ff0000')).toBe(false);
    expect(c.setTextBg('rgb(0,0,0)')).toBe(false);
    expect(c.setFontSize('24px')).toBe(false);
    expect(c.setFontFamily('Comic Sans MS')).toBe(false);
    expect(md(ed)).toBe('一 词 二');
    ed.destroy();
  });

  it('a raw setMark / JSON insert with an invalid value is stripped by the guard (never a bare span)', () => {
    const ed = makeEditor('一 词 二');
    select(ed, '词');
    ed.commands.setMark('textColor', { value: 'javascript:alert(1)' });
    expect(runs(ed)).toEqual(['一 词 二:']);
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, {
      type: 'text',
      text: '尾',
      marks: [{ type: 'fontSize', attrs: { value: '99px' } }],
    });
    expect(runs(ed)).toEqual(['一 词 二尾:']);
    expect(md(ed)).toBe('一 词 二尾');
    expect(ed.getHTML()).not.toMatch(/<span/);
    // The strip is not an undo step of its own.
    ed.commands.undo();
    expect(md(ed)).toBe('一 词 二');
    ed.destroy();
  });

  it('JSON content with an invalid mark is cleaned at creation without emitting an update', async () => {
    let updates = 0;
    const ed = new Editor({
      extensions: buildRichTextExtensions(),
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textBg', attrs: { value: 'nope' } }] }] }],
      },
      onUpdate: () => {
        updates += 1;
      },
    });
    // tiptap emits `create` (and so runs extension onCreate) on the next macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs(ed)).toEqual(['x:']);
    expect(updates).toBe(0);
    expect(ed.can().undo()).toBe(false);
    ed.destroy();
  });

  it('a pristine markdown body opens with no update and nothing to undo', async () => {
    let updates = 0;
    const ed = new Editor({
      extensions: buildRichTextExtensions(),
      content: 'a <span data-color="red">x</span> `c`',
      onUpdate: () => {
        updates += 1;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0)); // past tiptap's async `create`
    expect(updates).toBe(0);
    expect(ed.can().undo()).toBe(false);
    ed.destroy();
  });
});

describe('format marks — caret behaviour and helpers', () => {
  it('an empty selection sets the mark for the NEXT typed text', () => {
    const ed = makeEditor('开头');
    ed.commands.focus('end');
    ed.commands.setTextColor('teal');
    expect(activeRichMarkValue(ed, 'color')).toBe('teal');
    ed.commands.insertContent('新字');
    expect(md(ed)).toBe('开头<span data-color="teal">新字</span>');
    ed.destroy();
  });

  it('typing at the end of a coloured run continues the colour; unset on a caret stops it', () => {
    const ed = makeEditor('<p><span data-color="red">红</span></p>');
    ed.commands.focus('end');
    ed.commands.insertContent('继续');
    expect(md(ed)).toBe('<span data-color="red">红继续</span>');
    ed.commands.unsetTextColor();
    ed.commands.insertContent('黑');
    expect(md(ed)).toBe('<span data-color="red">红继续</span>黑');
    ed.destroy();
  });

  it('activeRichMarkValue reads each kind at the selection', () => {
    const ed = makeEditor('<p><span data-size="xl"><span data-font="serif"><span data-bg="gray"><span data-color="pink">字</span></span></span></span></p>');
    select(ed, '字');
    expect(RICH_MARK_KINDS.map((k) => activeRichMarkValue(ed, k))).toEqual(['pink', 'gray', 'xl', 'serif']);
    expect(RICH_MARK_KINDS.map((k) => ed.isActive(RICH_MARK_NAME[k]))).toEqual([true, true, true, true]);
    ed.destroy();
  });

  it('clearRichFormatting drops the four formats + bold/italic/strike/code and keeps links', () => {
    const ed = makeEditor(
      'a <span data-color="red">**粗** *斜* ~~删~~ `码` [@王伟](/users/z84412632)</span> <span data-bg="yellow">[链接](/x)</span> b',
    );
    ed.commands.selectAll();
    expect(ed.commands.clearRichFormatting()).toBe(true);
    const stored = md(ed);
    expect(stored).toBe('a 粗 斜 删 码 [@王伟](/users/z84412632) [链接](/x) b');
    expect(extractMentionHandles(stored)).toEqual(['z84412632']);
    ed.destroy();
  });

  it('clearRichFormatting on a caret clears the stored formats for the next text', () => {
    const ed = makeEditor('<p><strong><span data-color="red">红粗</span></strong></p>');
    ed.commands.focus('end');
    ed.commands.clearRichFormatting();
    ed.commands.insertContent('素');
    expect(md(ed)).toBe('<span data-color="red">**红粗**</span>素');
    ed.destroy();
  });
});

describe('InlineCode — coexists with formatting, never corrupts', () => {
  it('colour on code stores the span OUTSIDE the backticks, in either order', () => {
    for (const apply of [
      (ed: Editor) => ed.chain().setTextColor('red').toggleCode().run(),
      (ed: Editor) => ed.chain().toggleCode().setTextColor('red').run(),
    ]) {
      const ed = makeEditor('call foo() now');
      select(ed, 'foo()');
      expect(apply(ed)).toBe(true);
      const stored = md(ed);
      expect(stored).toBe('call <span data-color="red">`foo()`</span> now');
      expectStable(stored);
      ed.destroy();
    }
  });

  it('size + background on code between CJK text, and colour across a code edge', () => {
    const ed = makeEditor('<p>调用<code>foo()</code>名</p>');
    select(ed, 'foo()');
    ed.chain().setFontSize('xl').setTextBg('pink').run();
    const stored = md(ed);
    expect(stored).toBe('调用<span data-size="xl"><span data-bg="pink">`foo()`</span></span>名');
    expectStable(stored);

    const ed2 = makeEditor('<p>调用<code>foo()</code>名</p>');
    select(ed2, '用foo');
    ed2.commands.setTextColor('red');
    const stored2 = md(ed2);
    expect(stored2).toBe('调<span data-color="red">用`foo`</span>`()`名');
    expectStable(stored2);
  });

  it('link + code stores `[`code`](href)`', () => {
    const ed = makeEditor('see [docs link](/x) now');
    select(ed, 'docs link');
    expect(ed.commands.toggleCode()).toBe(true);
    const stored = md(ed);
    expect(stored).toBe('see [`docs link`](/x) now');
    expectStable(stored);
  });

  it('code content is never escaped and never holds markup', () => {
    const ed = makeEditor('x');
    ed.commands.setContent('<p>a <code>&lt;span data-color="red"&gt;**x**&lt;/span&gt;</code> b</p>');
    const stored = md(ed);
    expect(stored).toBe('a `<span data-color="red">**x**</span>` b');
    expectStable(stored);
  });

  it('applying code to bold text removes the bold (bold beside a backtick corrupts CJK code)', () => {
    const ed = makeEditor('<p>调用<strong>foo()</strong>名</p>');
    select(ed, 'foo()');
    expect(ed.commands.toggleCode()).toBe(true);
    expect(runs(ed)).toEqual(['调用:', 'foo():code', '名:']);
    const stored = md(ed);
    expect(stored).toBe('调用`foo()`名');
    expectStable(stored);
  });

  it('bold / italic / strike cannot be added to code', () => {
    const ed = makeEditor('<p>调用<code>foo()</code>名</p>');
    select(ed, 'foo()');
    expect(ed.can().toggleBold()).toBe(false);
    expect(ed.can().toggleItalic()).toBe(false);
    expect(ed.can().toggleStrike()).toBe(false);
    expect(ed.commands.toggleBold()).toBe(false);
    expect(md(ed)).toBe('调用`foo()`名');
    // …while the four formats can.
    expect(ed.can().setTextColor('red')).toBe(true);
    expect(ed.can().setFontFamily('serif')).toBe(true);
    ed.destroy();
  });

  it('code partly overlapping a bold run keeps the bold on the rest, stable in CJK', () => {
    const ed = makeEditor('调用**函数foo()函数**名');
    select(ed, 'foo()');
    ed.commands.toggleCode();
    const stored = md(ed);
    expect(stored).toBe('调用**函数**`foo()`**函数**名');
    expectStable(stored);
  });

  it('refuses to add code over an @mention (it would stop notifying)', () => {
    const ed = makeEditor('见 [@王伟](/users/z84412632) 吧');
    select(ed, '@王伟');
    expect(ed.can().toggleCode()).toBe(false);
    expect(ed.commands.toggleCode()).toBe(false);
    expect(ed.commands.setCode()).toBe(false);
    expect(extractMentionHandles(md(ed))).toEqual(['z84412632']);
    ed.destroy();
  });

  it('toggles off, and Mod-e / the backtick input rule still work', () => {
    const ed = makeEditor('call foo() now');
    select(ed, 'foo()');
    ed.commands.toggleCode();
    expect(md(ed)).toBe('call `foo()` now');
    ed.commands.toggleCode();
    expect(md(ed)).toBe('call foo() now');

    // Mod-e is bound on the extension itself.
    const code = ed.extensionManager.extensions.find((e) => e.name === 'code');
    expect(code).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shortcuts = (code!.config as any).addKeyboardShortcuts.call({ editor: ed });
    expect(Object.keys(shortcuts)).toEqual(['Mod-e']);
    select(ed, 'now');
    expect(shortcuts['Mod-e']()).toBe(true);
    expect(md(ed)).toBe('call foo() `now`');
    ed.destroy();

    // Typed backticks become code (the input rule replicated from extension-code).
    const typed = makeEditor('');
    typed.commands.focus('end');
    for (const ch of 'use `bar` ') {
      const { from, to } = typed.state.selection;
      const insert = () => typed.state.tr.insertText(ch, from, to);
      const handled = typed.view.someProp('handleTextInput', (f) => f(typed.view, from, to, ch, insert));
      if (!handled) typed.view.dispatch(insert());
    }
    expect(md(typed)).toBe('use `bar` ');
    expect(runs(typed)).toEqual(['use :', 'bar:code', ' :']);
    typed.destroy();
  });

  // ED-12: Enter at the end of a code chip carried the mark into the new
  // paragraph (and every Enter after it). Driven through the REAL handler chain:
  // tiptap's `keyboardShortcut` command replays only the steps and drops the
  // stored marks, so it would pass without the fix.
  describe('Enter ends the code run', () => {
    const key = (ed: Editor, k: string, shift = false) =>
      ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: k, shiftKey: shift })));
    const type = (ed: Editor, text: string) => {
      for (const ch of text) {
        const { from, to } = ed.state.selection;
        const insert = () => ed.state.tr.insertText(ch, from, to);
        const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, insert));
        if (!handled) ed.view.dispatch(insert());
      }
    };
    const chipAtEnd = (content: string) => {
      const ed = makeEditor(content);
      select(ed, 'npm');
      ed.commands.toggleCode();
      ed.commands.setTextSelection(rangeOf(ed, 'npm').to);
      type(ed, 'X'); // typing right after the chip still extends it (inclusive, on purpose)
      return ed;
    };

    it('paragraph Enter', () => {
      const ed = chipAtEnd('run the command npm');
      key(ed, 'Enter');
      type(ed, 'Next');
      key(ed, 'Enter');
      type(ed, 'third');
      expect(md(ed)).toBe('run the command `npmX`\n\nNext\n\nthird');
      ed.destroy();
    });

    it('list item Enter', () => {
      const ed = chipAtEnd('- run npm');
      key(ed, 'Enter');
      type(ed, 'Next');
      expect(md(ed)).toBe('- run `npmX`\n- Next');
      ed.destroy();
    });

    it('Shift-Enter', () => {
      const ed = chipAtEnd('run npm');
      key(ed, 'Enter', true);
      type(ed, 'Next');
      expect(md(ed)).toBe('run `npmX`\\\nNext');
      ed.destroy();
    });

    it('bold still carries across Enter', () => {
      const ed = makeEditor('a bold');
      select(ed, 'bold');
      ed.commands.toggleBold();
      ed.commands.setTextSelection(ed.state.doc.content.size - 1);
      key(ed, 'Enter');
      type(ed, 'next');
      expect(md(ed)).toBe('a **bold**\n\n**next**');
      ed.destroy();
    });
  });
});

// ─── the toolbar menu, mounted for real (react-dom in jsdom) ────────────────
// The menu only calls the commands above, but the wiring is what an author
// touches: the popover must portal out, keep the editor selection on
// mousedown, report the active format and close the way the brief says.
describe('TextStyleMenu', async () => {
  const { createElement } = await import('react');
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { NextIntlClientProvider } = await import('next-intl');
  const { TextStyleMenu } = await import('@/components/editor/TextStyleMenu');

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // prosemirror-view measures the caret when focus() scrolls it into view.
  const proto = Range.prototype as unknown as Record<string, unknown>;
  proto.getClientRects ??= () => [];
  proto.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });

  function mount(content: string, variant: 'full' | 'compact') {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editorEl = document.createElement('div');
    document.body.appendChild(editorEl);
    const ed = new Editor({
      element: editorEl,
      extensions: buildRichTextExtensions(),
      content,
    });
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(
          NextIntlClientProvider,
          // Keys render as themselves: the test must not depend on the lead's message merge.
          {
            locale: 'zh-CN',
            messages: {},
            onError: () => {},
            getMessageFallback: ({ key }: { key: string }) => key,
            children: createElement(TextStyleMenu, { editor: ed, variant }),
          },
        ),
      );
    });
    const trigger = host.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement;
    const cleanup = () => {
      act(() => root.unmount());
      ed.destroy();
      host.remove();
      editorEl.remove();
    };
    return { ed, host, trigger, cleanup };
  }

  const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
  /** Group 0 = 文字颜色, 1 = 背景色, 2 = 字号, 3 = 字体 — colour names repeat across 0 and 1. */
  const group = (i: number) => dialog()!.querySelectorAll('[role="group"]')[i] as HTMLElement;
  const swatch = (i: number, label: string) => group(i).querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  const byText = (root: HTMLElement, text: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement;
  const click = (el: HTMLElement, detail = 1) =>
    act(() => {
      el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
    });

  it('full: portals a dialog with colour, background, size, font and 清除格式', () => {
    const { trigger, host, cleanup } = mount('<p>前文 重点 后文</p>', 'full');
    expect(trigger.getAttribute('aria-label')).toBe('rte_text_style');
    click(trigger);
    const d = dialog();
    expect(d).not.toBeNull();
    expect(host.contains(d)).toBe(false); // portaled out of the (overflow-hidden) editor root
    const groups = d!.querySelectorAll('[role="group"]');
    expect(groups.length).toBe(4);
    expect(groups[0].querySelectorAll('button').length).toBe(10); // 默认 + 9
    expect(groups[1].querySelectorAll('button').length).toBe(10); // 无 + 9
    expect(groups[2].querySelectorAll('button').length).toBe(4); // 默认/小/大/特大
    expect(groups[3].querySelectorAll('button').length).toBe(4); // 默认/宋体/楷体/等宽
    expect(d!.textContent).toContain('rte_clear_format');
    cleanup();
  });

  it('compact: colour + background + 清除格式 only', () => {
    const { trigger, cleanup } = mount('<p>x</p>', 'compact');
    click(trigger);
    expect(dialog()!.querySelectorAll('[role="group"]').length).toBe(2);
    expect(dialog()!.textContent).toContain('rte_clear_format');
    cleanup();
  });

  it('a swatch keeps the editor selection (mousedown cancelled) and colours exactly the selection', () => {
    const { ed, trigger, cleanup } = mount('<p>前文 重点 后文</p>', 'full');
    select(ed, '重点');
    click(trigger);
    const red = swatch(0, 'rte_color_red');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    red.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    click(red);
    expect(md(ed)).toBe('前文 <span data-color="red">重点</span> 后文');
    // Mouse pick keeps the panel open, marks the swatch and paints the trigger bar.
    expect(dialog()).not.toBeNull();
    expect(swatch(0, 'rte_color_red').getAttribute('aria-pressed')).toBe('true');
    expect(swatch(0, 'rte_color_default').getAttribute('aria-pressed')).toBe('false');
    expect(trigger.querySelector('span[aria-hidden]')).not.toBeNull();
    // Background, then size and font through the labelled buttons.
    click(swatch(1, 'rte_color_yellow'));
    click(byText(group(2), 'rte_size_xl'));
    click(byText(group(3), 'rte_font_kai'));
    expect(md(ed)).toBe(
      '前文 <span data-size="xl"><span data-font="kai"><span data-bg="yellow"><span data-color="red">重点</span></span></span></span> 后文',
    );
    // 清除格式 removes all of it.
    click(byText(dialog()!, 'rte_clear_format'));
    expect(md(ed)).toBe('前文 重点 后文');
    cleanup();
  });

  it('an empty selection formats the next typed text', () => {
    const { ed, trigger, cleanup } = mount('<p>开头</p>', 'compact');
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    click(trigger);
    click(swatch(0, 'rte_color_blue'));
    act(() => {
      ed.commands.insertContent('新');
    });
    expect(md(ed)).toBe('开头<span data-color="blue">新</span>');
    cleanup();
  });

  it('touch and keyboard picks close the panel; Esc and an outside press close it', () => {
    const { ed, trigger, cleanup } = mount('<p>前文 重点 后文</p>', 'compact');
    select(ed, '重点');
    click(trigger);
    const green = swatch(0, 'rte_color_green');
    act(() => {
      green.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      green.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(md(ed)).toBe('前文 <span data-color="green">重点</span> 后文');
    expect(dialog()).toBeNull();

    click(trigger);
    expect(dialog()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialog()).toBeNull();

    click(trigger);
    act(() => {
      document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(dialog()).toBeNull();

    // Keyboard (click with detail 0) applies and closes.
    click(trigger, 0);
    click(swatch(1, 'rte_color_pink'), 0);
    expect(md(ed)).toBe('前文 <span data-bg="pink"><span data-color="green">重点</span></span> 后文');
    expect(dialog()).toBeNull();
    cleanup();
  });
});
