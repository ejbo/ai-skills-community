// @vitest-environment jsdom
//
// 富文本 contract v3 (2026-09-15): hex colours, px 字号, CJK + Latin 字体, 上标/下标,
// 行高 runs — headless on the REAL stack (buildRichTextExtensions, the list every
// RichTextEditor registers, flow serializer included) and through the REAL
// reader (MarkdownRenderer: rehype-raw → highlight → sanitize → code lines →
// rehypeRichStyle). The stored markdown is the contract, so every editor case
// pins the exact bytes and then proves two more open → save cycles reproduce
// them. Pure tables and the CSS file are pinned at the top.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { Editor } from '@tiptap/core';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { activeRichValue, hexStyleFor, stripEditorHexStyle } from '@/components/editor/format-marks';
import { SCRIPT_MARK_PRIORITY } from '@/components/editor/script-marks';
import { activeLineHeight, lineHeightCoversContainer, lineHeightOf } from '@/components/editor/line-height';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { rehypeRichStyle, richStyleFor } from '@/lib/markdown-rich-style';
import { extractMentionHandles } from '@/lib/mentions';
import { extractHeadings } from '@/lib/zones/shared';
import { htmlMarkupIn, markdownToPlainText, richTextLength, stripRichFormatting } from '@/lib/markdown-text';
import {
  RICH_BG_COLORS,
  RICH_CJK_FONT_FAMILIES,
  RICH_FONT_FAMILIES,
  RICH_FONT_FAMILY_KEYS,
  RICH_FONT_FAMILY_STACKS,
  RICH_FONT_SIZES,
  RICH_FONT_SIZES_PX,
  RICH_LATIN_FONT_FAMILIES,
  RICH_LINE_HEIGHTS,
  RICH_LINE_HEIGHT_TAG_RE,
  RICH_SPAN_TAG_RE,
  RICH_TEXT_COLORS,
  isHexColor,
  isRichMarkValue,
  normalizeHexColor,
  normalizeLineHeight,
  normalizeRichMarkValue,
} from '@/lib/rich-marks';

const CSS = readFileSync(join(__dirname, '..', 'app', 'rich-text.css'), 'utf8');
const ROOT_LAYOUT = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');

// ─── helpers ─────────────────────────────────────────────────────────────────

type Opts = { onUpdate?: () => void };
const makeEditor = (content = '', opts: Opts = {}) =>
  new Editor({ extensions: buildRichTextExtensions({ embed: {}, codeHighlight: false }), content, ...(opts.onUpdate ? { onUpdate: opts.onUpdate } : {}) });

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
        text += '￼';
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
const select = (ed: Editor, needle: string, nth = 0) => ed.commands.setTextSelection(rangeOf(ed, needle, nth));
const caret = (ed: Editor, needle: string) => ed.commands.setTextSelection(rangeOf(ed, needle).from);

/** Open the stored markdown twice more: both saves must reproduce it exactly. */
function expectStable(stored: string) {
  const once = makeEditor(stored);
  const a = md(once);
  const twice = makeEditor(a);
  const b = md(twice);
  once.destroy();
  twice.destroy();
  expect(a).toBe(stored);
  expect(b).toBe(stored);
}

/** expectStable for bodies with `[poll:]` / `[embed:]` tokens: their normalizers run a microtask after creation. */
async function expectStableAfterNormalize(stored: string) {
  const once = makeEditor(stored);
  await tick();
  const a = md(once);
  const twice = makeEditor(a);
  await tick();
  const b = md(twice);
  once.destroy();
  twice.destroy();
  expect(a).toBe(stored);
  expect(b).toBe(stored);
}

function runs(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.isText) out.push(`${n.text}:${n.marks.map((m) => (m.attrs.value ? `${m.type.name}=${m.attrs.value}` : m.type.name)).join('+')}`);
  });
  return out;
}

const press = (ed: Editor, key: string, mods: { mod?: boolean; shift?: boolean } = {}) =>
  ed.view.someProp('handleKeyDown', (f) =>
    f(ed.view, new KeyboardEvent('keydown', { key, ctrlKey: Boolean(mods.mod), shiftKey: Boolean(mods.shift), bubbles: true, cancelable: true })),
  );

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Top-level node names with their line height. */
const tops = (ed: Editor) => {
  const out: string[] = [];
  ed.state.doc.forEach((n) => out.push(`${n.type.name}${lineHeightOf(n) ? `@${lineHeightOf(n)}` : ''}`));
  return out;
};

/** Every node (any depth) that carries a line height attribute. */
const lhNodes = (ed: Editor) => {
  const out: string[] = [];
  ed.state.doc.descendants((n, pos) => {
    if (n.attrs.lineHeight != null) out.push(`${n.type.name}@${ed.state.doc.resolve(pos).depth}=${n.attrs.lineHeight}`);
    return !n.isTextblock;
  });
  return out;
};

function render(content: string, size: 'default' | 'compact' | 'article' = 'article'): string {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const html = renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'en',
      messages: {},
      onError: () => {},
      getMessageFallback: ({ key }: { key: string }) => key,
      children: createElement(MarkdownRenderer, { content, size }),
    }),
  );
  const seen = errors.mock.calls.map((c) => String(c[0]));
  errors.mockRestore();
  expect(seen).toEqual([]);
  return html;
}

const POLL_ID = 'clxyz12345abcde';
const FILE_KEY = 'file/abcdefghij.pdf';

// ─── 1. the contract tables ──────────────────────────────────────────────────

describe('lib/rich-marks v3 — values and validators', () => {
  it('legacy lists are unchanged (stored bodies depend on them)', () => {
    expect(RICH_TEXT_COLORS).toEqual(['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']);
    expect(RICH_BG_COLORS).toEqual(RICH_TEXT_COLORS);
    expect(RICH_FONT_SIZES).toEqual(['sm', 'lg', 'xl']);
    expect(RICH_FONT_FAMILIES).toEqual(['serif', 'kai', 'mono']);
    for (const legacy of RICH_FONT_FAMILIES) expect(RICH_FONT_FAMILY_KEYS).toContain(legacy);
  });

  it('the v3 sets are exactly the brief', () => {
    expect(RICH_FONT_SIZES_PX).toEqual([10, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72]);
    expect(RICH_LINE_HEIGHTS).toEqual(['1', '1.15', '1.5', '1.75', '2', '2.5', '3']);
    expect([...RICH_CJK_FONT_FAMILIES].sort()).toEqual(['fangsong', 'hei', 'kai', 'lishu', 'sans', 'serif']);
    expect([...RICH_LATIN_FONT_FAMILIES].sort()).toEqual(
      ['arial', 'comic', 'consolas', 'courier', 'garamond', 'georgia', 'helvetica', 'impact', 'mono', 'palatino', 'segoe', 'tahoma', 'times', 'trebuchet', 'verdana'].sort(),
    );
    expect(Object.keys(RICH_FONT_FAMILY_STACKS).sort()).toEqual([...RICH_FONT_FAMILY_KEYS].sort());
    for (const stack of Object.values(RICH_FONT_FAMILY_STACKS)) expect(stack).toMatch(/(?:sans-serif|serif|monospace|cursive)$/);
  });

  it('isHexColor accepts only the stored shape; normalizeHexColor normalises input', () => {
    expect(isHexColor('#aabbcc')).toBe(true);
    for (const bad of ['#AABBCC', '#abc', '#aabbccdd', 'aabbcc', 'red', ' #aabbcc', '#gggggg', null, 1]) expect(isHexColor(bad)).toBe(false);
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor(' #1F6FEB ')).toBe('#1f6feb');
    expect(normalizeHexColor('#000000')).toBe('#000000');
    for (const bad of ['#abcd', '#aabbccdd', '#ff000080', 'ff0000', 'white', 'transparent', 'rgb(0,0,0)', 'red', '', undefined]) {
      expect([bad, normalizeHexColor(bad)]).toEqual([bad, null]);
    }
  });

  it('isRichMarkValue / normalizeRichMarkValue per kind', () => {
    expect(isRichMarkValue('color', 'red')).toBe(true);
    expect(isRichMarkValue('color', '#ff0000')).toBe(true);
    expect(isRichMarkValue('bg', '#ff0000')).toBe(true);
    expect(isRichMarkValue('size', '#ff0000')).toBe(false);
    expect(isRichMarkValue('color', '#FF0000')).toBe(false);
    expect(isRichMarkValue('size', '24')).toBe(true);
    expect(isRichMarkValue('size', 'lg')).toBe(true);
    expect(isRichMarkValue('size', 24)).toBe(false); // stored values are strings
    expect(isRichMarkValue('size', '11')).toBe(false);
    expect(isRichMarkValue('font', 'georgia')).toBe(true);
    expect(isRichMarkValue('font', 'Georgia')).toBe(false);
    expect(normalizeRichMarkValue('color', '#F00')).toBe('#ff0000');
    expect(normalizeRichMarkValue('bg', 'yellow')).toBe('yellow');
    expect(normalizeRichMarkValue('size', 72)).toBe('72');
    expect(normalizeRichMarkValue('size', '24px')).toBeNull();
    expect(normalizeRichMarkValue('font', 'sans')).toBe('sans');
    expect(normalizeLineHeight(2)).toBe('2');
    expect(normalizeLineHeight(1.15)).toBe('1.15');
    expect(normalizeLineHeight('1.50')).toBeNull();
    expect(normalizeLineHeight(1.3)).toBeNull();
  });

  it('RICH_SPAN_TAG_RE matches every v3 value exactly, nothing looser', () => {
    const exact = new RegExp(`^(?:${RICH_SPAN_TAG_RE.source})$`);
    for (const tag of [
      '<span data-color="red">',
      '<span data-color="#1f6feb">',
      '<span data-bg="#000000">',
      '<span data-size="xl">',
      ...RICH_FONT_SIZES_PX.map((n) => `<span data-size="${n}">`),
      ...RICH_FONT_FAMILY_KEYS.map((k) => `<span data-font="${k}">`),
      '</span>',
    ]) expect([tag, exact.test(tag)]).toEqual([tag, true]);
    for (const tag of ['<span data-color="Red">', '<span data-color="#1F6FEB">', '<span data-color="#abc">', '<span data-size="24px">', '<span data-size="11">', '<span data-font="Arial">', '<span data-color="nope">', '<span class="x">']) {
      expect([tag, exact.test(tag)]).toEqual([tag, false]);
    }
    const lh = new RegExp(`^(?:${RICH_LINE_HEIGHT_TAG_RE.source})$`);
    for (const v of RICH_LINE_HEIGHTS) expect(lh.test(`<div data-lh="${v}">`)).toBe(true);
    expect(lh.test('</div>')).toBe(true);
    expect(lh.test('<div data-lh="1.3">')).toBe(false);
    expect(lh.test('<div align="center">')).toBe(false);
  });

  it('hexStyleFor builds the editor-only custom property from valid hex only', () => {
    expect(hexStyleFor('color', '#aabbcc')).toBe('--rt-c: #aabbcc');
    expect(hexStyleFor('bg', '#aabbcc')).toBe('--rt-bg: #aabbcc');
    expect(hexStyleFor('color', 'red')).toBeNull();
    expect(hexStyleFor('color', '#aabbcc;position:fixed')).toBeNull();
  });

  it('stripEditorHexStyle removes exactly that property from serialized editor HTML', () => {
    // Whatever spacing a DOM serializer chose (jsdom adds the `;`, Chrome may not).
    expect(stripEditorHexStyle('<span data-color="#1e88e5" style="--rt-c: #1e88e5;">x</span>')).toBe(
      '<span data-color="#1e88e5">x</span>',
    );
    expect(stripEditorHexStyle('<span data-bg="#ffff00" style="--rt-bg:#ffff00">x</span>')).toBe(
      '<span data-bg="#ffff00">x</span>',
    );
    // Not ours: a named colour never had one, and a foreign style stays for the sanitizer to drop.
    expect(stripEditorHexStyle('<span data-color="red">x</span>')).toBe('<span data-color="red">x</span>');
    const foreign = '<span style="position:fixed">x</span>';
    expect(stripEditorHexStyle(foreign)).toBe(foreign);
    expect(stripEditorHexStyle('<table style="min-width: 50px;"><td>x</td></table>')).toBe(
      '<table style="min-width: 50px;"><td>x</td></table>',
    );
  });
});

describe('app/rich-text.css — pinned to the tables', () => {
  it('is actually loaded: the root layout imports it', () => {
    // Every other case here is a substring check over the FILE. They would all
    // stay green if the stylesheet stopped being part of the bundle, and every
    // hex colour, px size, font and 行高 in a stored body would then paint as
    // nothing at all. This is the one assertion that the rules reach a page.
    expect(ROOT_LAYOUT).toMatch(/^import '\.\/rich-text\.css';$/m);
  });

  it('declares every font stack exactly as RICH_FONT_FAMILY_STACKS, and a rule per key', () => {
    for (const key of RICH_FONT_FAMILY_KEYS) {
      const m = new RegExp(`--rt-font-${key}:\\s*([^;]+);`).exec(CSS);
      expect([key, m?.[1].trim()]).toEqual([key, RICH_FONT_FAMILY_STACKS[key]]);
      expect(CSS).toContain(`span[data-font='${key}'] { font-family: var(--rt-font-${key}); }`);
    }
  });

  it('has a px rule for every size and a line-height rule for every factor', () => {
    for (const n of RICH_FONT_SIZES_PX) expect(CSS).toMatch(new RegExp(`span\\[data-size='${n}'\\] \\{ font-size: ${n}px;`));
    for (const v of RICH_LINE_HEIGHTS) {
      expect(CSS).toContain(`:is([data-lh='${v}'], [data-lh='${v}'] :is(p, li, h1, h2, h3, h4, h5, h6, blockquote)) { line-height: ${v}; }`);
    }
  });

  it('hex paint, the dark-ground switch in BOTH ground blocks, the clamp and auto contrast under @supports', () => {
    // (the swatch previews ride the same rules, so the selector list may carry more than one line)
    expect(CSS).toMatch(/span\[data-color\^='#'\][^{]*\{\n {2}color: var\(--rt-c\);/);
    expect(CSS).toMatch(/span\[data-bg\^='#'\][^{]*\{\n {2}background-color: var\(--rt-bg\);/);
    const light = CSS.slice(CSS.indexOf(':root,'), CSS.indexOf("[data-theme='dark'],"));
    const dark = CSS.slice(CSS.indexOf("[data-theme='dark'],"), CSS.indexOf('/* ── the four formats'));
    expect(light).toContain('--rt-ground-dark: 0;');
    expect(dark).toContain('--rt-ground-dark: 1;');
    const rcs = CSS.slice(CSS.indexOf('@supports (color: oklch(from red'));
    expect(rcs).toContain('max(l, calc(var(--rt-ground-dark) * 0.72))');
    expect(rcs).toContain('min(l, calc(1 - var(--rt-ground-dark) * 0.58))');
    expect(rcs).toMatch(/color: oklch\(\s*from var\(--rt-bg\) clamp\(0\.21,/);
  });

  it('clamps hex text on LIGHT grounds too, and exempts text sitting on a hex background', () => {
    // An author writing in the dark theme sees their pastel fine; every
    // light-theme / 护眼 reader got it at ~1.3 : 1 while only the dark ground
    // was clamped. Both tiers cap it now, and only text on a hex BACKGROUND
    // (the author's own ground) escapes the page's clamp.
    const rcs = CSS.slice(CSS.indexOf('@supports (color: oklch(from red'));
    expect(rcs).toContain('min(max(l, calc(var(--rt-ground-dark) * 0.72)), calc(1 - (1 - var(--rt-ground-dark)) * 0.42))');
    const mix = CSS.slice(CSS.indexOf('@supports (color: color-mix'), CSS.indexOf('@supports (color: oklch(from red'));
    expect(mix).toContain('calc(100% - (1 - var(--rt-ground-dark)) * 30%)');
    for (const block of [mix, rcs]) {
      expect(block).toContain(":is(.prose, .rte-content, .ProseMirror) span[data-bg^='#'] span[data-color^='#']");
    }
  });

  it('removes Typography’s blockquote quotation marks for prose and the editor', () => {
    expect(CSS).toContain(
      ':is(.prose, .rte-content, .ProseMirror) blockquote p:first-of-type::before,\n:is(.prose, .rte-content, .ProseMirror) blockquote p:last-of-type::after {\n  content: none;',
    );
  });
});

// ─── 2. editor: hex colours, px sizes, fonts ─────────────────────────────────

describe('hex colours in the editor', () => {
  it('on CJK text: normalised, stored as the data attribute only, stable; the editor DOM carries the property', () => {
    const ed = makeEditor('前文 重点 后文');
    select(ed, '重点');
    expect(ed.commands.setTextColor('#E0A')).toBe(true);
    const stored = md(ed);
    expect(stored).toBe('前文 <span data-color="#ee00aa">重点</span> 后文');
    expect(stored).not.toContain('style');
    expect(ed.getHTML()).toContain('<span data-color="#ee00aa" style="--rt-c: #ee00aa;">重点</span>');
    expectStable(stored);
    ed.destroy();
  });

  it('background + colour on one bold CJK character (the flanking case), stable', () => {
    const ed = makeEditor('这**是粗体**文字');
    select(ed, '体');
    ed.chain().setTextBg('#FFFF00').setTextColor('#000000').run();
    const stored = md(ed);
    expect(stored).toBe('这**是粗**<span data-bg="#ffff00"><span data-color="#000000">**体**</span></span>文字');
    expectStable(stored);
    const back = makeEditor(stored);
    expect(runs(back)).toEqual(['这:', '是粗:bold', '体:textBg=#ffff00+textColor=#000000+bold', '文字:']);
    back.destroy();
    ed.destroy();
  });

  it('on a link and on an @mention: the span stays outside, extraction still works', () => {
    const ed = makeEditor('见 [文档](/docs) 和 [@王伟](/users/z84412632) 吧');
    select(ed, '文档');
    ed.commands.setTextColor('#1f6feb');
    select(ed, '伟'); // inside the mention: widened to all of it
    ed.commands.setTextBg('#fff3b0');
    const stored = md(ed);
    expect(stored).toBe('见 <span data-color="#1f6feb">[文档](/docs)</span> 和 <span data-bg="#fff3b0">[@王伟](/users/z84412632)</span> 吧');
    expect(extractMentionHandles(stored)).toEqual(['z84412632']);
    expectStable(stored);
    ed.destroy();
  });

  it('in a GFM table cell the table stays GFM', () => {
    const ed = makeEditor('| a | b |\n| --- | --- |\n| 单元 | 2 |');
    select(ed, '单元');
    ed.commands.setTextColor('#15803d');
    const stored = md(ed);
    expect(stored).toBe('| a | b |\n| --- | --- |\n| <span data-color="#15803d">单元</span> | 2 |\n');
    expectStable(stored);
    ed.destroy();
  });

  it('in a table markdown cannot express (raw HTML) the STYLE never reaches the stored bytes', () => {
    // The raw path serializes through the schema's renderHTML, which paints hex
    // marks with the editor-only custom property. Stored, that span is no
    // longer the shape RICH_SPAN_TAG_RE knows: the plain-text helpers counted
    // it as visible text and stripRichFormatting left it in the SKILL.md / AI
    // body. Every non-GFM table takes this path.
    const ed = makeEditor('| a | b |\n| --- | --- |\n| 单元 | 2 |');
    const cell = rangeOf(ed, '单元');
    ed.commands.setTextSelection(cell);
    ed.commands.setTextColor('#1e88e5');
    ed.commands.setTextSelection(cell.to);
    ed.commands.splitBlock(); // two paragraphs in one cell ⇒ raw HTML
    ed.commands.insertContent('第二行');
    const stored = md(ed);
    expect(stored).toContain('<table');
    expect(stored).toContain('<span data-color="#1e88e5">单元</span>');
    expect(stored).not.toContain('--rt-c');
    expect(stored).not.toContain('style="--rt');
    expectStable(stored);
    // …so the helpers still recognise our spans inside it.
    expect(stripRichFormatting(stored)).not.toContain('data-color');
    expect(richTextLength(stored)).toBeLessThan(stored.length);
    ed.destroy();

    const bg = makeEditor('| a |\n| --- |\n| 高亮 |');
    const r = rangeOf(bg, '高亮');
    bg.commands.setTextSelection(r);
    bg.commands.setTextBg('#ffff00');
    bg.commands.setTextSelection(r.to);
    bg.commands.splitBlock();
    bg.commands.insertContent('x');
    expect(md(bg)).toContain('<span data-bg="#ffff00">高亮</span>');
    expect(md(bg)).not.toContain('--rt-bg');
    bg.destroy();
  });

  it('an @mention inside such a table is still extracted (it is stored as an anchor)', () => {
    const ed = makeEditor('| a |\n| --- |\n| [@王伟](/users/z84412632) |');
    expect(extractMentionHandles(md(ed))).toEqual(['z84412632']);
    ed.commands.setTextSelection(rangeOf(ed, '@王伟').to);
    ed.commands.splitBlock();
    ed.commands.insertContent('第二行');
    const stored = md(ed);
    expect(stored).toContain('href="/users/z84412632"');
    expect(extractMentionHandles(stored)).toEqual(['z84412632']);
    ed.destroy();
  });

  it('refuses alpha, CSS names and uppercase stored values; the guard strips a raw invalid setMark', () => {
    const ed = makeEditor('一 词 二');
    select(ed, '词');
    for (const bad of ['#ff000080', '#ffff', 'white', 'hsl(0 0% 0%)', 'ff0000']) expect([bad, ed.commands.setTextColor(bad)]).toEqual([bad, false]);
    ed.commands.setMark('textColor', { value: '#FF0000' });
    ed.commands.setMark('textBg', { value: '#ff0000;position:fixed' });
    expect(runs(ed)).toEqual(['一 词 二:']);
    ed.destroy();
    // API-written uppercase / short hex never becomes a mark (the reader would not paint it either).
    const parsed = makeEditor('a <span data-color="#FF0000">x</span> <span data-bg="#abc">y</span> <span style="color:#ff0000">z</span>');
    expect(md(parsed)).toBe('a x y z');
    parsed.destroy();
  });

  it('pasted HTML with style colours still imports as plain text, our hex spans keep theirs', () => {
    const g = globalThis as { ClipboardEvent?: unknown };
    if (typeof g.ClipboardEvent === 'undefined') g.ClipboardEvent = class extends Event { clipboardData = null; };
    const ed = makeEditor('<p>起止</p>');
    caret(ed, '止');
    ed.view.pasteHTML('<p><span style="color:#c00;background-color:#ff0;font-size:24px;font-family:Georgia">红字</span><sup style="color:red">1</sup></p>');
    expect(md(ed)).toBe('起红字<sup>1</sup>止');
    caret(ed, '止');
    ed.view.pasteHTML('<p><span data-color="#aa00ff" style="--rt-c: #aa00ff">紫</span></p>');
    expect(md(ed)).toBe('起红字<sup>1</sup><span data-color="#aa00ff">紫</span>止');
    ed.destroy();
  });

  it('activeRichValue: uniform, mixed, none, and the caret', () => {
    const ed = makeEditor('<p><span data-color="#aa00ff">紫紫</span><span data-color="red">红</span>黑</p>');
    select(ed, '紫紫');
    expect(activeRichValue(ed, 'color')).toBe('#aa00ff');
    select(ed, '紫红');
    expect(activeRichValue(ed, 'color')).toBeNull(); // mixed values
    select(ed, '红黑');
    expect(activeRichValue(ed, 'color')).toBeNull(); // partly unformatted
    select(ed, '黑');
    expect(activeRichValue(ed, 'color')).toBeNull(); // none
    expect(activeRichValue(ed, 'bg')).toBeNull();
    ed.commands.setTextSelection(rangeOf(ed, '紫紫').from + 1);
    expect(activeRichValue(ed, 'color')).toBe('#aa00ff');
    ed.commands.setTextColor('#00ff00'); // stored mark for the next text
    expect(activeRichValue(ed, 'color')).toBe('#00ff00');
    ed.destroy();
  });
});

describe('px sizes and every font key', () => {
  it('setFontSize takes a number or string from the px list; legacy keywords still work', () => {
    const ed = makeEditor('一 二 三');
    select(ed, '一');
    expect(ed.commands.setFontSize(24)).toBe(true);
    select(ed, '二');
    expect(ed.commands.setFontSize('72')).toBe(true);
    select(ed, '三');
    expect(ed.commands.setFontSize('sm')).toBe(true);
    const stored = md(ed);
    expect(stored).toBe('<span data-size="24">一</span> <span data-size="72">二</span> <span data-size="sm">三</span>');
    expectStable(stored);
    select(ed, '一');
    expect(activeRichValue(ed, 'size')).toBe('24');
    ed.destroy();
  });

  it('every px value and every font key round-trips, nested in the fixed order', () => {
    for (const n of RICH_FONT_SIZES_PX) expectStable(`字 <span data-size="${n}">号</span>`);
    for (const key of RICH_FONT_FAMILY_KEYS) {
      const ed = makeEditor('Hello 世界');
      select(ed, 'Hello 世界');
      expect([key, ed.commands.setFontFamily(key)]).toEqual([key, true]);
      const stored = md(ed);
      expect(stored).toBe(`<span data-font="${key}">Hello 世界</span>`);
      expectStable(stored);
      ed.destroy();
    }
    const ed = makeEditor('mix');
    select(ed, 'mix');
    ed.chain().setTextColor('#123456').setFontFamily('georgia').setTextBg('#fedcba').setFontSize(32).run();
    const stored = md(ed);
    expect(stored).toBe('<span data-size="32"><span data-font="georgia"><span data-bg="#fedcba"><span data-color="#123456">mix</span></span></span></span>');
    expectStable(stored);
    ed.destroy();
  });
});

// ─── 3. superscript / subscript ──────────────────────────────────────────────

describe('superscript / subscript', () => {
  it('schema rank: both outermost, above the format marks', () => {
    const ed = makeEditor();
    expect(Object.keys(ed.schema.marks).slice(0, 3)).toEqual(['superscript', 'subscript', 'fontSize']);
    expect(SCRIPT_MARK_PRIORITY).toBeGreaterThan(1004);
    ed.destroy();
  });

  it('stored as <sup>/<sub>, parsed back, stable', () => {
    const ed = makeEditor('E = mc2 and H2O');
    select(ed, '2');
    expect(ed.commands.toggleSuperscript()).toBe(true);
    select(ed, '2', 1);
    expect(ed.commands.toggleSubscript()).toBe(true);
    const stored = md(ed);
    expect(stored).toBe('E = mc<sup>2</sup> and H<sub>2</sub>O');
    expectStable(stored);
    ed.destroy();
  });

  it('are mutually exclusive: 下标 on 上标 text replaces it (and can() agrees); toggling twice removes', () => {
    const ed = makeEditor('x<sup>2</sup>');
    select(ed, '2');
    expect(ed.isActive('superscript')).toBe(true);
    expect(ed.can().toggleSubscript()).toBe(true);
    expect(ed.commands.toggleSubscript()).toBe(true);
    expect(runs(ed)).toEqual(['x:', '2:subscript']);
    expect(ed.commands.toggleSuperscript()).toBe(true);
    expect(runs(ed)).toEqual(['x:', '2:superscript']);
    expect(ed.commands.toggleSuperscript()).toBe(true);
    expect(md(ed)).toBe('x2');
    // A parsed <sup><sub> keeps one mark, never both.
    const nested = makeEditor('a<sup><sub>b</sub></sup>');
    expect(runs(nested).filter((r) => r.startsWith('b:'))).toHaveLength(1);
    expect(runs(nested)[1]).not.toMatch(/superscript\+subscript|subscript\+superscript/);
    nested.destroy();
    ed.destroy();
  });

  it('a caret sets the stored mark for the next text; a code block refuses it', () => {
    const ed = makeEditor('x');
    ed.commands.focus('end');
    ed.commands.toggleSuperscript();
    ed.commands.insertContent('n');
    ed.commands.toggleSuperscript();
    ed.commands.insertContent(' y');
    expect(md(ed)).toBe('x<sup>n</sup> y');
    ed.destroy();
    const code = makeEditor('```\nabc\n```');
    code.commands.setTextSelection(2);
    expect(code.can().toggleSuperscript()).toBe(false);
    code.destroy();
  });

  it('Mod-. and Mod-, through the real keydown chain', () => {
    const ed = makeEditor('a b');
    select(ed, 'a');
    expect(press(ed, '.', { mod: true })).toBe(true);
    select(ed, 'b');
    expect(press(ed, ',', { mod: true })).toBe(true);
    expect(md(ed)).toBe('<sup>a</sup> <sub>b</sub>');
    ed.destroy();
  });

  it('with bold / italic in CJK, a link, a colour and a mention — stable, mention still extracts', () => {
    const cases: Array<[string, (ed: Editor) => void, string]> = [
      ['这**是粗体**文字', (ed) => { select(ed, '体'); ed.commands.toggleSuperscript(); }, '这**是粗**<sup>**体**</sup>文字'],
      ['这*是斜体*文字', (ed) => { select(ed, '斜体文'); ed.commands.toggleSubscript(); }, '这*是*<sub>*斜体*文</sub>字'],
      ['see [docs](/x) now', (ed) => { select(ed, 'docs'); ed.commands.toggleSuperscript(); }, 'see <sup>[docs](/x)</sup> now'],
      ['注1 结束', (ed) => { select(ed, '1'); ed.chain().setTextColor('#ff0000').toggleSuperscript().run(); }, '注<sup><span data-color="#ff0000">1</span></sup> 结束'],
      ['嗨 [@王伟](/users/z84412632) 你好', (ed) => { select(ed, '王'); ed.commands.toggleSuperscript(); }, '嗨 <sup>[@王伟](/users/z84412632)</sup> 你好'],
    ];
    for (const [src, apply, want] of cases) {
      const ed = makeEditor(src);
      apply(ed);
      const stored = md(ed);
      expect([src, stored]).toEqual([src, want]);
      expectStable(stored);
      ed.destroy();
    }
    expect(extractMentionHandles('嗨 <sup>[@王伟](/users/z84412632)</sup> 你好')).toEqual(['z84412632']);
  });

  it('in a GFM table cell', () => {
    const ed = makeEditor('| a | b |\n| --- | --- |\n| x2 | 2 |');
    select(ed, '2');
    ed.commands.toggleSuperscript();
    const stored = md(ed);
    expect(stored).toBe('| a | b |\n| --- | --- |\n| x<sup>2</sup> | 2 |\n');
    expectStable(stored);
    ed.destroy();
  });

  it('INLINE CODE coexists: code stays innermost inside the tag, in either order', () => {
    for (const apply of [
      (ed: Editor) => ed.chain().toggleCode().toggleSuperscript().run(),
      (ed: Editor) => ed.chain().toggleSuperscript().toggleCode().run(),
    ]) {
      const ed = makeEditor('公式 x^2 结束');
      select(ed, 'x^2');
      expect(apply(ed)).toBe(true);
      const stored = md(ed);
      expect(stored).toBe('公式 <sup>`x^2`</sup> 结束');
      expectStable(stored);
      expect(runs(makeEditor(stored))).toEqual(['公式 :', 'x^2:superscript+code', ' 结束:']);
      ed.destroy();
    }
  });

  it('清除格式 removes sup/sub with the other formatting, keeps links', () => {
    const ed = makeEditor('a<sup>[b](/x)</sup><sub><span data-color="#ff0000">c</span></sub>');
    ed.commands.selectAll();
    ed.commands.clearRichFormatting();
    expect(md(ed)).toBe('a[b](/x)c');
    ed.destroy();
  });
});

// ─── 4. line height ──────────────────────────────────────────────────────────

describe('行高 — commands and storage', () => {
  it('a run of 3 paragraphs + a heading is ONE wrapper; parsed back onto the blocks; stable', () => {
    const ed = makeEditor('前言\n\n第一段\n\n第二段\n\n## 小标题\n\n第三段\n\n结尾');
    ed.commands.setTextSelection({ from: rangeOf(ed, '第一段').from, to: rangeOf(ed, '第三段').to });
    expect(ed.commands.setLineHeight(2)).toBe(true);
    const stored = md(ed);
    expect(stored).toBe('前言\n\n<div data-lh="2">\n\n第一段\n\n第二段\n\n## 小标题\n\n第三段\n\n</div>\n\n结尾');
    expectStable(stored);
    const back = makeEditor(stored);
    expect(tops(back)).toEqual(['paragraph', 'paragraph@2', 'paragraph@2', 'heading@2', 'paragraph@2', 'paragraph']);
    expect(back.getHTML()).toContain('<h2 data-lh="2">小标题</h2>');
    back.destroy();
    ed.destroy();
  });

  it('mixed values: adjacent runs get their own wrappers; unset and activeLineHeight', () => {
    const ed = makeEditor('a\n\nb\n\nc');
    caret(ed, 'a');
    ed.commands.setLineHeight('1.5');
    caret(ed, 'b');
    ed.commands.setLineHeight('1.5');
    caret(ed, 'c');
    ed.commands.setLineHeight(3);
    const stored = md(ed);
    expect(stored).toBe('<div data-lh="1.5">\n\na\n\nb\n\n</div>\n\n<div data-lh="3">\n\nc\n\n</div>');
    expectStable(stored);
    caret(ed, 'b');
    expect(activeLineHeight(ed)).toBe('1.5');
    ed.commands.setTextSelection({ from: rangeOf(ed, 'b').from, to: rangeOf(ed, 'c').to });
    expect(activeLineHeight(ed)).toBeNull(); // mixed
    expect(ed.commands.unsetLineHeight()).toBe(true);
    expect(md(ed)).toBe('<div data-lh="1.5">\n\na\n\n</div>\n\nb\n\nc');
    ed.commands.selectAll();
    expect(activeLineHeight(ed)).toBeNull();
    expect(ed.commands.setLineHeight('1.3')).toBe(false); // not in the list
    expect(ed.commands.setLineHeight('1.75')).toBe(true);
    expect(activeLineHeight(ed)).toBe('1.75');
    expect(md(ed)).toBe('<div data-lh="1.75">\n\na\n\nb\n\nc\n\n</div>');
    ed.destroy();
  });

  it('never swallows own-line embeds / polls, code blocks, tables, images or rules — they break the run', async () => {
    const body = [
      'p1',
      `[embed:file:${FILE_KEY}]`,
      'p2',
      `[poll:${POLL_ID}]`,
      'p3',
      '```js\nconst a = 1\n```',
      'p4',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      'p5',
      '![pic](/api/uploads/images/a.png)',
      'p6',
      '---',
      'p7',
    ].join('\n\n');
    const ed = makeEditor(body);
    await tick(); // the poll / embed normalizers turn the tokens into card nodes
    expect(tops(ed).filter((t) => /Embed/.test(t))).toEqual(['contentEmbed', 'pollEmbed']);
    ed.commands.selectAll();
    expect(ed.commands.setLineHeight(2)).toBe(true);
    const stored = md(ed);
    const wrap = (t: string) => `<div data-lh="2">\n\n${t}\n\n</div>`;
    expect(stored).toBe(
      [
        wrap('p1'),
        `[embed:file:${FILE_KEY}]`,
        wrap('p2'),
        `[poll:${POLL_ID}]`,
        wrap('p3'),
        '```js\nconst a = 1\n```',
        wrap('p4'),
        '| a | b |\n| --- | --- |\n| 1 | 2 |', // the GFM serializer ends its own line; one blank line follows
        wrap('p5'),
        '![pic](/api/uploads/images/a.png)',
        wrap('p6'),
        '---',
        wrap('p7'),
      ].join('\n\n'),
    );
    // The card tokens are still own-line top-level lines the reader splits on.
    expect(stored.split('\n')).toContain(`[poll:${POLL_ID}]`);
    expect(stored.split('\n')).toContain(`[embed:file:${FILE_KEY}]`);
    await expectStableAfterNormalize(stored);
    ed.destroy();
  });

  it('lists and quotes carry it on the TOP-LEVEL node only; nested children never do', () => {
    const ed = makeEditor('- 一\n  - 嵌套\n- 二\n\n> 引用第一段\n>\n> 引用第二段\n\n1. 有序');
    ed.commands.selectAll();
    ed.commands.setLineHeight('2.5');
    expect(tops(ed)).toEqual(['bulletList@2.5', 'blockquote@2.5', 'orderedList@2.5', 'paragraph@2.5']);
    expect(lhNodes(ed)).toEqual(['bulletList@0=2.5', 'blockquote@0=2.5', 'orderedList@0=2.5', 'paragraph@0=2.5']);
    const stored = md(ed);
    expect(stored).toBe('<div data-lh="2.5">\n\n- 一\n  - 嵌套\n- 二\n\n> 引用第一段\n>\n> 引用第二段\n\n1. 有序\n\n</div>');
    expectStable(stored);
    const back = makeEditor(stored);
    expect(lhNodes(back)).toEqual(['bulletList@0=2.5', 'blockquote@0=2.5', 'orderedList@0=2.5']);
    back.destroy();
    // A caret deep inside a nested item targets the top-level list.
    const nested = makeEditor('- 一\n  - 嵌套');
    caret(nested, '嵌套');
    nested.commands.setLineHeight(2);
    expect(lhNodes(nested)).toEqual(['bulletList@0=2']);
    nested.destroy();
    ed.destroy();
  });

  it('a list right after a same-kind list in another run stays a separate list', () => {
    // Two bullet lists back to back, only the second spaced (built as JSON: markdown would merge them).
    const ed = makeEditor();
    ed.commands.setContent({
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] },
        { type: 'bulletList', attrs: { lineHeight: '2' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
      ],
    });
    const stored = md(ed);
    expect(stored).toBe('- a\n\n<div data-lh="2">\n\n- b\n\n</div>');
    const back = makeEditor(stored);
    expect(tops(back).slice(0, 2)).toEqual(['bulletList', 'bulletList@2']);
    back.destroy();
    ed.destroy();
  });

  it('disabled inside tables and code blocks; a selection spanning a table sets only the eligible blocks', () => {
    const ed = makeEditor('前\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```\n\n后');
    caret(ed, '1');
    expect(ed.can().setLineHeight(2)).toBe(false);
    expect(ed.commands.setLineHeight(2)).toBe(false);
    expect(ed.can().unsetLineHeight()).toBe(false);
    caret(ed, 'code');
    expect(ed.can().setLineHeight(2)).toBe(false);
    ed.commands.setTextSelection({ from: rangeOf(ed, '前').from, to: rangeOf(ed, '后').to });
    expect(ed.commands.setLineHeight(2)).toBe(true);
    expect(lhNodes(ed)).toEqual(['paragraph@0=2', 'paragraph@0=2']);
    ed.destroy();
  });

  it('Enter continues the line height (keepOnSplit); an interior empty paragraph does not split the run', () => {
    const ed = makeEditor('<div data-lh="2">\n\n第一段\n\n</div>');
    ed.commands.setTextSelection(rangeOf(ed, '第一段').to);
    press(ed, 'Enter');
    press(ed, 'Enter'); // an empty paragraph in between
    ed.commands.insertContent('第二段');
    expect(tops(ed).slice(0, 3)).toEqual(['paragraph@2', 'paragraph@2', 'paragraph@2']);
    const stored = md(ed);
    expect(stored).toBe('<div data-lh="2">\n\n第一段\n\n第二段\n\n</div>');
    expectStable(stored);
    ed.destroy();
  });

  it('the guard strips a line height that lands below the top level (paste into a list item, wrap in a list)', () => {
    const g = globalThis as { ClipboardEvent?: unknown };
    if (typeof g.ClipboardEvent === 'undefined') g.ClipboardEvent = class extends Event { clipboardData = null; };
    const ed = makeEditor('- 项目');
    ed.commands.setTextSelection(rangeOf(ed, '项目').to);
    ed.view.pasteHTML('<p data-lh="2">贴入</p><p data-lh="3">第二</p>');
    expect(lhNodes(ed)).toEqual([]);
    ed.destroy();

    const wrap = makeEditor('<div data-lh="2">\n\n段落\n\n</div>');
    caret(wrap, '段落');
    wrap.commands.toggleBulletList();
    expect(lhNodes(wrap)).toEqual([]);
    expect(md(wrap)).toBe('- 段落');
    // Undo brings the spaced paragraph back in ONE step: the strip is grouped with the wrap.
    wrap.commands.undo();
    expect(md(wrap)).toBe('<div data-lh="2">\n\n段落\n\n</div>');
    wrap.destroy();
  });

  it('parse is a closed door: invalid values, foreign divs and nested wrapper content get nothing', () => {
    const ed = makeEditor('<div data-lh="1.3">\n\na\n\n</div>\n\n<div align="center">\n\nb\n\n</div>\n\n<div data-lh="2">\n\n- c\n\n> d\n\n</div>');
    expect(lhNodes(ed)).toEqual(['bulletList@0=2', 'blockquote@0=2']);
    expect(md(ed)).toBe('a\n\nb\n\n<div data-lh="2">\n\n- c\n\n> d\n\n</div>');
    ed.destroy();
  });

  it('清除格式 resets the line height of a SELECTION; a caret only clears the marks it would type with', () => {
    const ed = makeEditor('<div data-lh="2">\n\n<span data-color="red">a</span>\n\nb\n\n</div>');
    // A caret clears nothing visible (nothing is selected), so it must not
    // re-space the paragraph either — that was the one thing the author saw.
    caret(ed, 'b');
    ed.commands.clearRichFormatting();
    expect(md(ed)).toBe('<div data-lh="2">\n\n<span data-color="red">a</span>\n\nb\n\n</div>');
    caret(ed, 'a');
    ed.commands.setTextColor('#1e88e5'); // stored mark for the next character
    ed.commands.clearRichFormatting();
    expect(ed.state.storedMarks ?? []).toEqual([]);
    expect(md(ed)).toBe('<div data-lh="2">\n\n<span data-color="red">a</span>\n\nb\n\n</div>');
    ed.commands.selectAll();
    ed.commands.clearRichFormatting();
    expect(md(ed)).toBe('a\n\nb');
    ed.destroy();
  });

  it('a stored body reads 行高 exactly where the READER paints it (the wrapper div, never a block’s own attribute)', () => {
    // The reader's sanitize schema allows data-lh on `div` alone, so these
    // API-written bodies show default spacing — and opening one in the editor
    // must not invent a run the first save would make real.
    for (const body of ['<p data-lh="3">hello</p>', '<h2 data-lh="3">hello</h2>', '<blockquote data-lh="3">hello</blockquote>']) {
      expect(render(body)).not.toContain('data-lh');
      const ed = makeEditor(body);
      expect(lhNodes(ed)).toEqual([]);
      expect(md(ed)).not.toContain('data-lh');
      ed.destroy();
    }
    // A conflict resolves the reader's way: the wrapper wins, the inner value is not stored.
    const conflict = makeEditor('<div data-lh="2">\n\n<p data-lh="3">冲突</p>\n\n</div>');
    expect(md(conflict)).toBe('<div data-lh="2">\n\n冲突\n\n</div>');
    conflict.destroy();
    // Clipboard HTML is the OTHER shape and is untouched by this: the editor
    // puts the value on the block itself, and pasting one into a top-level
    // position keeps it.
    const g = globalThis as { ClipboardEvent?: unknown };
    if (typeof g.ClipboardEvent === 'undefined') g.ClipboardEvent = class extends Event { clipboardData = null; };
    const paste = makeEditor('x');
    paste.commands.selectAll();
    paste.view.pasteHTML('<p data-lh="2">贴入</p>');
    expect(md(paste)).toBe('<div data-lh="2">\n\n贴入\n\n</div>');
    paste.destroy();
  });

  it('a wrapper written WITHOUT blank lines (an API body) keeps its line height through the first save', () => {
    // markdown-it leaves the whole thing as one raw HTML block, so the reader
    // paints the div's spacing on its text; the editor used to drop it.
    const ed = makeEditor('<div data-lh="2">正文 **粗**</div>');
    expect(tops(ed)).toEqual(['paragraph@2']);
    const stored = md(ed);
    expect(stored).toBe('<div data-lh="2">\n\n正文 \\*\\*粗\\*\\*\n\n</div>');
    expectStable(stored);
    ed.destroy();

    const multi = makeEditor('<div data-lh="2">\n## 标题\n正文\n</div>');
    // The `##` was never a heading for the reader either (it is inside the HTML block).
    expect(md(multi)).toBe('<div data-lh="2">\n\n\\## 标题 正文\n\n</div>');
    multi.destroy();

    // A wrapper whose content is already blocks is unchanged, and a foreign
    // div still contributes nothing.
    expectStable('<div data-lh="2">\n\n段落\n\n</div>');
    const foreign = makeEditor('<div align="center">直接文本</div>');
    expect(lhNodes(foreign)).toEqual([]);
    foreign.destroy();
  });

  it('lineHeightCoversContainer tells the menu when one caret re-spaces a whole list or quote', () => {
    const ed = makeEditor('- 一\n- 二\n\n段落\n\n> 引用');
    caret(ed, '二');
    expect(lineHeightCoversContainer(ed.state.doc, ed.state.selection)).toBe(true);
    caret(ed, '段落');
    expect(lineHeightCoversContainer(ed.state.doc, ed.state.selection)).toBe(false);
    caret(ed, '引用');
    expect(lineHeightCoversContainer(ed.state.doc, ed.state.selection)).toBe(true);
    ed.commands.selectAll();
    expect(lineHeightCoversContainer(ed.state.doc, ed.state.selection)).toBe(true);
    ed.destroy();
  });

  it('headings in a run still reach extractHeadings; a mention in a run still extracts', () => {
    const stored = '<div data-lh="1.5">\n\n## 背景\n\n问 [@王伟](/users/z84412632) 吧\n\n### 细节\n\n</div>\n\n## 结论';
    expectStable(stored);
    expect(extractHeadings(stored).map((h) => `${h.level}:${h.text}`)).toEqual(['2:背景', '3:细节', '2:结论']);
    expect(extractMentionHandles(stored)).toEqual(['z84412632']);
  });
});

// ─── 5. legacy bodies & pristine load ────────────────────────────────────────

describe('legacy and pristine', () => {
  it('v2 bodies (named colours, sm/lg/xl, serif/kai/mono) open and save byte-identically', () => {
    const legacy = [
      '前 <span data-color="red">红</span> <span data-bg="yellow">黄底</span> <span data-size="sm">小</span> <span data-size="lg">大</span> <span data-size="xl">特大</span>',
      '<span data-font="serif">宋</span> <span data-font="kai">楷</span> <span data-font="mono">等宽</span>',
      'hello <span data-size="lg"><span data-font="kai"><span data-bg="yellow"><span data-color="blue">**world**</span></span></span></span>',
      '| a | b |\n| --- | --- |\n| <span data-color="green">1</span> | 2 |',
      '> <span data-bg="pink">引用</span>\n\n- <span data-color="teal">项</span>',
    ].join('\n\n');
    expectStable(legacy);
  });

  it('a pristine v3 body opens with no update and nothing to undo', async () => {
    let updates = 0;
    const body =
      '<div data-lh="2">\n\n## 标题 <sup>1</sup>\n\n<span data-size="24"><span data-font="georgia"><span data-bg="#ffff00"><span data-color="#000000">正文</span></span></span></span> H<sub>2</sub>O\n\n- 项\n\n</div>\n\n[poll:' +
      POLL_ID +
      ']\n\n<div data-lh="1.15">\n\n> 引用\n\n</div>';
    const ed = makeEditor(body, { onUpdate: () => (updates += 1) });
    await tick();
    await tick();
    expect(updates).toBe(0);
    expect(ed.can().undo()).toBe(false);
    expect(md(ed)).toBe(body);
    ed.destroy();
  });

  it('the guard does not dispatch on a pristine body whose only line heights are top level', async () => {
    let updates = 0;
    const ed = new Editor({
      extensions: buildRichTextExtensions({ codeHighlight: false }),
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { lineHeight: '2' }, content: [{ type: 'text', text: 'ok' }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { lineHeight: '3' }, content: [{ type: 'text', text: 'nested' }] }] }] },
          { type: 'paragraph', attrs: { lineHeight: 'bogus' }, content: [{ type: 'text', text: 'bad' }] },
        ],
      },
      onUpdate: () => {
        updates += 1;
      },
    });
    await tick();
    // JSON content with a nested / invalid value is cleaned at creation, silently.
    expect(lhNodes(ed)).toEqual(['paragraph@0=2']);
    expect(updates).toBe(0);
    expect(ed.can().undo()).toBe(false);
    ed.destroy();
  });
});

// ─── 6. reader ───────────────────────────────────────────────────────────────

describe('reader — sanitize + rehypeRichStyle through MarkdownRenderer', () => {
  it('hex text / background become custom properties on the span; nothing else gets a style', () => {
    const html = render(
      'a <span data-color="#ff0000">红</span> <span data-bg="#ffff00">黄</span> <span data-bg="#000000"><span data-color="#ffffff">白</span></span> <span data-color="red">named</span>',
    );
    expect(html).toContain('<span data-color="#ff0000" style="--rt-c:#ff0000">红</span>');
    expect(html).toContain('<span data-bg="#ffff00" style="--rt-bg:#ffff00">黄</span>');
    expect(html).toContain('<span data-bg="#000000" style="--rt-bg:#000000"><span data-color="#ffffff" style="--rt-c:#ffffff">白</span></span>');
    expect(html).toContain('<span data-color="red">named</span>');
  });

  it('a smuggled style, uppercase / short / alpha hex and CSS injection in the value are all dropped', () => {
    const html = render(
      '<span data-color="#ff0000" style="position:fixed;inset:0">x</span> <span data-color="#FF0000">u</span> <span data-bg="#abc">s</span> <span data-color="#ff000080">a</span> <span data-color="#ff0000;position:fixed">i</span> <span style="--rt-c:#ff0000">p</span>',
    );
    expect(html).toContain('<span data-color="#ff0000" style="--rt-c:#ff0000">x</span>');
    expect(html).toContain('<span>u</span>');
    expect(html).toContain('<span>s</span>');
    expect(html).toContain('<span>a</span>');
    expect(html).toContain('<span>i</span>');
    expect(html).toContain('<span>p</span>');
    expect(html).not.toMatch(/position|inset|#FF0000|#abc"|ff000080/);
  });

  it('px sizes, every font key, sup/sub and a blockquote render', () => {
    const fonts = RICH_FONT_FAMILY_KEYS.map((k) => `<span data-font="${k}">${k}</span>`).join(' ');
    const html = render(`<span data-size="24">big</span> <span data-size="72">huge</span> ${fonts} x<sup>2</sup> H<sub>2</sub>O\n\n> 引用`);
    expect(html).toContain('<span data-size="24">big</span>');
    expect(html).toContain('<span data-size="72">huge</span>');
    for (const k of RICH_FONT_FAMILY_KEYS) expect(html).toContain(`<span data-font="${k}">${k}</span>`);
    expect(html).toContain('x<sup>2</sup> H<sub>2</sub>O');
    expect(html).toMatch(/<blockquote>\s*<p>引用<\/p>\s*<\/blockquote>/);
  });

  it('a 行高 run keeps the markdown INSIDE the div (heading, bold, mention, list); invalid values are dropped', () => {
    const html = render(
      '前言\n\n<div data-lh="2">\n\n## 标题\n\n**粗** 与 [@王伟](/users/z84412632)\n\n- 项\n\n</div>\n\n<div data-lh="1.3">\n\n后记\n\n</div>',
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const run = doc.querySelector('div[data-lh="2"]');
    expect(run).not.toBeNull();
    expect(run!.querySelector('h2')?.textContent).toBe('标题');
    expect(run!.querySelector('strong')?.textContent).toBe('粗');
    expect(run!.querySelector('a')?.getAttribute('href')).toBe('/users/z84412632');
    expect(run!.querySelector('ul li')?.textContent).toBe('项');
    expect(run!.textContent).not.toContain('前言');
    expect(html).not.toContain('data-lh="1.3"');
    expect(doc.body.textContent).toContain('后记');
  });

  it('a coloured span inside a raw HTML code block gets its property on every split line', () => {
    const html = render('<pre><code><span data-color="#22c55e">line one\nline two</span></code></pre>');
    const count = html.split('style="--rt-c:#22c55e"').length - 1;
    expect(count).toBe(2);
    expect(html).toContain('code-line');
  });

  it('a body nested deeper than the render stack allows falls back to its source instead of throwing', () => {
    // `'>'.repeat(1500)` is 1.5 kB — inside every body cap — and used to throw
    // `Maximum call stack size exceeded` while rendering, taking the whole page
    // down with it. Nothing is hidden: the text is still there.
    for (const deep of [
      `${'>'.repeat(1500)} 很深`,
      `${'<span data-color="#aabbcc">'.repeat(1200)}很深${'</span>'.repeat(1200)}`,
      `${'<b>'.repeat(2500)}很深`,
    ]) {
      const html = render(deep);
      expect(html).toContain('很深');
      expect(html).not.toContain('<blockquote>');
    }
    // A real document of the same shape still renders as a tree.
    expect(render('> > 引用')).toContain('<blockquote>');
    expect(render('<span data-color="#aabbcc">红</span>')).toContain('style="--rt-c:#aabbcc"');
  });

  it('richStyleFor / rehypeRichStyle in isolation', () => {
    expect(richStyleFor({ dataColor: '#aabbcc', dataBg: '#000000' })).toBe('--rt-c:#aabbcc;--rt-bg:#000000');
    expect(richStyleFor({ dataColor: 'red' })).toBeNull();
    expect(richStyleFor({ dataColor: '#aabbcc;color:red' })).toBeNull();
    expect(richStyleFor(undefined)).toBeNull();
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'span', properties: { dataColor: '#aabbcc', style: 'position:fixed' }, children: [] },
        { type: 'element', tagName: 'span', properties: { style: 'position:fixed' }, children: [] },
        { type: 'element', tagName: 'div', properties: { dataColor: '#aabbcc' }, children: [] },
      ],
    };
    rehypeRichStyle()(tree);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [a, b, c] = tree.children as any[];
    expect(a.properties.style).toBe('--rt-c:#aabbcc');
    expect(b.properties.style).toBeUndefined();
    expect(c.properties.style).toBeUndefined(); // only spans
  });
});

// ─── 7. plain text & limits ──────────────────────────────────────────────────

describe('plain-text helpers — hex spans and the 行高 wrapper', () => {
  const unwrapped = '前言\n\n## 标题\n\n正文 [@王伟](/users/z84412632)\n\n结尾';
  const wrapped = '前言\n\n<div data-lh="2">\n\n## 标题\n\n正文 [@王伟](/users/z84412632)\n\n</div>\n\n结尾';

  it('a wrapper does not change the visible length, and strips back to the exact unwrapped markdown', () => {
    expect(richTextLength(wrapped)).toBe(unwrapped.length);
    expect(stripRichFormatting(wrapped)).toBe(unwrapped);
    const atEdges = '<div data-lh="1.5">\n\na\n\n</div>\n\n<div data-lh="3">\n\nb\n\n</div>';
    expect(stripRichFormatting(atEdges)).toBe('a\n\nb');
    expect(richTextLength(atEdges)).toBe('a\n\nb'.length);
    expect(richTextLength('<div data-lh="2">\n\n</div>')).toBe(0);
    expect(markdownToPlainText(wrapped)).toBe('前言 标题 正文 @王伟 结尾');
  });

  it('hex / px / font spans are discounted and stripped; sup/sub are text-bearing HTML and stay', () => {
    const body = '<span data-color="#1f6feb"><span data-size="24">蓝</span></span> <span data-font="georgia">G</span> x<sup>2</sup>';
    expect(stripRichFormatting(body)).toBe('蓝 G x<sup>2</sup>');
    expect(richTextLength(body)).toBe('蓝 G x<sup>2</sup>'.length);
    expect(markdownToPlainText(body)).toBe('蓝 G x2');
    expect(htmlMarkupIn(body)).toEqual({ formatting: true, other: true });
    expect(htmlMarkupIn(wrapped)).toEqual({ formatting: true, other: false });
    expect(htmlMarkupIn('<span data-color="#1F6FEB">x</span>')).toEqual({ formatting: false, other: true });
  });

  it('a foreign div is not ours: its text and tags count, strip leaves it', () => {
    const foreign = '<div align="center">\n\nx\n\n</div>';
    expect(richTextLength(foreign)).toBe(foreign.length);
    expect(stripRichFormatting(foreign)).toBe(foreign);
  });

  it('the editor’s saved bytes satisfy the helpers end to end', () => {
    const ed = makeEditor(unwrapped);
    ed.commands.setTextSelection({ from: rangeOf(ed, '标题').from, to: rangeOf(ed, '正文').to });
    ed.commands.setLineHeight(2);
    select(ed, '结尾');
    ed.commands.setTextColor('#ABCDEF');
    const stored = md(ed);
    expect(stored).toBe('前言\n\n<div data-lh="2">\n\n## 标题\n\n正文 [@王伟](/users/z84412632)\n\n</div>\n\n<span data-color="#abcdef">结尾</span>');
    expect(stripRichFormatting(stored)).toBe(unwrapped);
    expect(richTextLength(stored)).toBe(unwrapped.length);
    ed.destroy();
  });
});
