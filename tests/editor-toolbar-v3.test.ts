// @vitest-environment jsdom
//
// 编辑器 v3 toolbar — mounted for real: components/RichTextEditor.tsx on the
// shipped extension stack (buildRichTextExtensions), react-dom in jsdom, the
// zh-CN messages. Every case drives the controls the way an author does —
// mousedown / click on the real buttons, Enter in the real form fields, Esc on
// window — and then reads the STORED markdown, which is the contract
// (lib/rich-marks.ts).
//
// Labels: the suite finds controls by their stable `data-rte-control` ids and
// resolves any text it compares through `L()`, which THROWS on a key that is
// not in messages/zh-CN.json. It used to fall back to `ui.<key>` — byte-identical
// to next-intl's own missing-message fallback, so a deleted key matched itself
// and every assertion stayed green. The mount also collects MISSING_MESSAGE and
// `afterEach` fails on one, which is what covers the keys only a rendered panel
// asks for (rte_color_auto, rte_link_remove, …) — tests/rte-stack.test.ts only
// sees the strings painted at mount.
//
// Covered: the control inventory of both variants (and the host-gated
// 附件 / 插入引用), 字体 / 字号 / 行高 menus, both colour split buttons with the
// theme grid, legacy named values, 自定义 hex and 最近使用, 格式刷 one-shot /
// sticky / keyboard / one undo step, 插入/编辑链接 insert / edit / retext /
// remove / refuse + the caret bubble (and a mention's 打开-only bubble), @提及
// opening the suggestion, 上标 / 下标, 清除格式, and the toolbar's
// no-recompute-on-meta-transactions rule.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { FORMAT_PAINTER_ARMED_CLASS, MULTI_CLICK_MS, formatPainterState } from '@/components/editor/format-painter';
import {
  LEGACY_COLOR_SWATCH,
  RECENT_COLORS_MAX,
  STANDARD_COLORS,
  THEME_GRID,
  darken,
  lighten,
  parseRecentColors,
  readRecentColors,
  rememberColor,
  swatchValueFor,
  withRecentColor,
} from '@/components/editor/toolbar/palette';
import { TABLE_STRIP_ARM_MS } from '@/components/editor/toolbar/TableToolbar';
import { linkAtSelection, normalizeLinkHref } from '@/components/editor/toolbar/link-edit';
import { mentionTriggerText } from '@/components/editor/toolbar/mention-trigger';
import { MentionSuggestionPluginKey } from '@/components/mention/mention-suggestion';
import { RICH_CJK_FONT_FAMILIES, RICH_FONT_SIZES_PX, RICH_LATIN_FONT_FAMILIES, RICH_LINE_HEIGHTS, isHexColor } from '@/lib/rich-marks';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => '/zones/x/posts/new',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/Toaster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/Toaster')>()),
  pushToast: () => {},
}));

const messages = JSON.parse(readFileSync(resolve(__dirname, '../messages/zh-CN.json'), 'utf8')) as Record<string, Record<string, string>>;
/** The zh-CN text of a `ui` key. Missing = a bug in the message files, not a fallback. */
const L = (key: string) => {
  const value = messages.ui[key];
  if (value === undefined) throw new Error(`missing ui.${key} in messages/zh-CN.json`);
  return value;
};

// ─── pure halves ─────────────────────────────────────────────────────────────

describe('palette data', () => {
  it('theme grid is 10 hues × 6 rows of stored-form hex; the standard row is Word’s ten', () => {
    expect(THEME_GRID).toHaveLength(6);
    for (const row of THEME_GRID) {
      expect(row).toHaveLength(10);
      for (const s of row) expect([s.hex, isHexColor(s.hex)]).toEqual([s.hex, true]);
    }
    expect(THEME_GRID[0].map((s) => s.hex)).toEqual(['#ffffff', '#000000', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#d81b60']);
    // Rows 1–3 lighten 80/60/40 %, rows 4–5 darken 25/50 % (Word); white only darkens, black only lightens.
    expect(THEME_GRID[1][2]).toMatchObject({ hex: lighten('#e53935', 0.8), shade: { dir: 'lighter', percent: 80 } });
    expect(THEME_GRID[5][2]).toMatchObject({ hex: darken('#e53935', 0.5), shade: { dir: 'darker', percent: 50 } });
    expect(THEME_GRID[5][0].hex).toBe('#808080');
    expect(THEME_GRID[1][1].hex).toBe('#808080');
    expect(STANDARD_COLORS.map((s) => s.hex)).toEqual(['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0']);
  });

  it('a legacy named value marks its swatch; hex is itself; anything else marks nothing', () => {
    expect(swatchValueFor('red')).toBe(LEGACY_COLOR_SWATCH.red);
    expect(THEME_GRID[0].some((s) => s.hex === LEGACY_COLOR_SWATCH.blue)).toBe(true);
    expect(swatchValueFor('#1f6feb')).toBe('#1f6feb');
    expect(swatchValueFor('Red')).toBeNull();
    expect(swatchValueFor(null)).toBeNull();
  });

  it('最近使用: newest first, deduped, capped at ten; bad storage reads as empty', () => {
    let list: `#${string}`[] = [];
    for (let i = 0; i < 12; i += 1) list = withRecentColor(list, `#0000${i.toString(16).padStart(2, '0')}` as `#${string}`);
    expect(list).toHaveLength(RECENT_COLORS_MAX);
    expect(list[0]).toBe('#00000b');
    expect(withRecentColor(list, '#000005')[0]).toBe('#000005');
    expect(withRecentColor(list, '#000005')).toHaveLength(RECENT_COLORS_MAX);
    expect(parseRecentColors('not json')).toEqual([]);
    expect(parseRecentColors('{"a":1}')).toEqual([]);
    expect(parseRecentColors('["#ABCDEF","#abcdef","red","#abcdef"]')).toEqual(['#abcdef']);
  });

  it('localStorage that throws never breaks a pick', () => {
    const desc = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    try {
      expect(readRecentColors('color')).toEqual([]);
      // Nothing is remembered, nothing throws: the list is just this pick.
      expect(rememberColor('color', '#123456')).toEqual(['#123456']);
      expect(readRecentColors('color')).toEqual([]);
    } finally {
      Object.defineProperty(window, 'localStorage', desc);
    }
  });
});

describe('link href normalisation', () => {
  it('accepts http(s), bare hosts, ONE-slash site paths, mailto: and #anchors; refuses everything else', () => {
    expect(normalizeLinkHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeLinkHref('  example.com/docs ')).toBe('https://example.com/docs');
    expect(normalizeLinkHref('localhost:3000/x')).toBe('https://localhost:3000/x');
    expect(normalizeLinkHref('/zones/edge-inference')).toBe('/zones/edge-inference');
    // The editor MAKES both of these itself (autolinked address, TOC anchor), so
    // the dialog has to be able to edit them — it used to refuse its own links.
    expect(normalizeLinkHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(normalizeLinkHref('MAILTO:Ada@Example.com?subject=hi')).toBe('mailto:Ada@Example.com?subject=hi');
    expect(normalizeLinkHref('#section')).toBe('#section');
    expect(normalizeLinkHref('#引言')).toBe('#引言');
    expect(normalizeLinkHref('#%E5%BC%95%E8%A8%80')).toBe('#%E5%BC%95%E8%A8%80');
    for (const bad of ['javascript:alert(1)', 'mailto:nobody', 'mailto:a@b', '#', '#a"b', '//evil.example', '/\\evil.example', '/a\tb', 'hello', 'ftp://x.y', '', '   ']) {
      expect([bad, normalizeLinkHref(bad)]).toEqual([bad, null]);
    }
  });

  it('@提及 inserts a space only where the suggestion plugin would refuse a glued @', () => {
    expect(mentionTriggerText('')).toBe('@');
    expect(mentionTriggerText('你')).toBe('@');
    expect(mentionTriggerText(' ')).toBe('@');
    expect(mentionTriggerText('o')).toBe(' @');
    expect(mentionTriggerText('7')).toBe(' @');
  });
});

// ─── mounted ────────────────────────────────────────────────────────────────

describe('RichTextEditor v3 toolbar, mounted', async () => {
  const { RichTextEditor } = await import('@/components/RichTextEditor');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  beforeAll(() => {
    const proto = Range.prototype as unknown as Record<string, unknown>;
    proto.getClientRects ??= () => [];
    proto.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView ??= () => {};
    // ProseMirror's own mousedown handler asks for the element under the pointer.
    (document as unknown as Record<string, unknown>).elementFromPoint ??= () => null;
    // jsdom has no media queries; the palette asks for `(pointer: coarse)`.
    (window as unknown as Record<string, unknown>).matchMedia ??= (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  });

  let mounted: { root: Root; host: HTMLElement } | null = null;
  // Strings only a rendered panel / dialog / bubble asks for (rte_color_auto,
  // rte_link_edit_short, rte_link_remove, rte_link_unlink, rte_size_lg …) are
  // missing from no other suite's view: this one opens them.
  const missing: string[] = [];
  afterEach(() => {
    if (mounted) {
      const m = mounted;
      act(() => m.root.unmount());
      m.host.remove();
      mounted = null;
    }
    const seen = missing.splice(0, missing.length);
    expect(seen).toEqual([]);
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  type MountProps = {
    value: string;
    variant?: 'full' | 'compact';
    embedPicker?: Record<string, unknown>;
    hostClass?: string;
    chrome?: 'boxed' | 'document';
    /** Do not feed onChange back as `value` — what a host with a DEBOUNCED emit looks like (long bodies). */
    frozen?: boolean;
  };
  function mount(props: MountProps) {
    const host = document.createElement('div');
    if (props.hostClass) host.className = props.hostClass;
    document.body.appendChild(host);
    const root = createRoot(host);
    const editorRef: { current: Editor | null } = { current: null };
    const emitted: string[] = [];
    function Harness() {
      const [value, setValue] = useState(props.value);
      return createElement(RichTextEditor, {
        value,
        onChange: (md: string) => {
          emitted.push(md);
          if (!props.frozen) setValue(md);
        },
        variant: props.variant ?? 'full',
        editorRef: editorRef as never,
        embedPicker: props.embedPicker as never,
        chrome: props.chrome,
      });
    }
    act(() => {
      root.render(
        createElement(NextIntlClientProvider, {
          locale: 'zh-CN',
          messages,
          onError: (e: { code?: string; message: string }) => {
            if (e.code === 'MISSING_MESSAGE') missing.push(e.message);
          },
          getMessageFallback: ({ namespace, key }: { namespace?: string; key: string }) => (namespace ? `${namespace}.${key}` : key),
          children: createElement(Harness),
        }),
      );
    });
    mounted = { root, host };
    const editor = editorRef.current as Editor | null;
    if (!editor) throw new Error('editor not created');
    // jsdom does not focus a bare contenteditable; ProseMirror's focus checks need a real activeElement.
    editor.view.dom.tabIndex = 0;
    const control = (id: string) => host.querySelector(`[data-rte-control="${id}"]`) as HTMLButtonElement | null;
    return { host, editor, control, md: () => editor.storage.markdown.getMarkdown() as string };
  }

  /** Doc range of `needle` inside one textblock. */
  function rangeOf(ed: Editor, needle: string): { from: number; to: number } {
    let found: { from: number; to: number } | null = null;
    ed.state.doc.descendants((node, pos) => {
      if (found || !node.isTextblock) return !found;
      let text = '';
      const at: number[] = [];
      node.forEach((child, offset) => {
        if (child.isText) {
          for (let i = 0; i < child.text!.length; i += 1) at.push(pos + 1 + offset + i);
          text += child.text;
        } else {
          at.push(pos + 1 + offset);
          text += '￼';
        }
      });
      const i = text.indexOf(needle);
      if (i >= 0) found = { from: at[i], to: at[i + needle.length - 1] + 1 };
      return false;
    });
    if (!found) throw new Error(`"${needle}" not found`);
    return found;
  }
  const select = (ed: Editor, needle: string) =>
    act(() => {
      const { from, to } = rangeOf(ed, needle);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
    });
  const caret = (ed: Editor, pos: number) =>
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    });

  /** A pointer click: pointerdown → mousedown (must be cancelled by the control) → click. */
  function click(el: Element, detail = 1): { mousedownPrevented: boolean } {
    let prevented = false;
    act(() => {
      el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail });
      el.dispatchEvent(down);
      prevented = down.defaultPrevented;
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, detail }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
    });
    return { mousedownPrevented: prevented };
  }
  /** A keyboard activation (Enter on a focused button) is a click with detail 0. */
  const keyboardClick = (el: HTMLElement) =>
    act(() => {
      el.focus();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    });
  const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
    });
  const typeInto = (input: HTMLInputElement, value: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const submit = (form: HTMLFormElement) =>
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  const tick = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
  /** Past MentionPicker's DEBOUNCE_MS (160), so its search actually fires. */
  const DEBOUNCE_WAIT_MS = 220;

  const menu = () => document.body.querySelector('[role="menu"]') as HTMLElement | null;
  const dialog = () => document.body.querySelector('.rte-toolbar-panel[role="dialog"]') as HTMLElement | null;
  const option = (value: string) => menu()!.querySelector(`[role="menuitemradio"][data-value="${value}"]`) as HTMLButtonElement;

  // ── inventory ──────────────────────────────────────────────────────────────

  const inventory = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('.rte-toolbar-row > [data-rte-group]')).map((g) => [
      (g as HTMLElement).dataset.rteGroup,
      Array.from(g.querySelectorAll('[data-rte-control]')).map((c) => (c as HTMLElement).dataset.rteControl),
    ]);

  it('full: the Word-like group order, every control present exactly once', () => {
    const { host } = mount({ value: 'hello' });
    expect(inventory(host)).toEqual([
      ['history', ['undo', 'redo']],
      ['format-tools', ['format-painter', 'clear-format']],
      ['font', ['font-family', 'font-size']],
      ['marks', ['bold', 'italic', 'strike', 'code', 'superscript', 'subscript']],
      ['color', ['text-color', 'text-color-more', 'bg-color', 'bg-color-more']],
      ['paragraph', ['h1', 'h2', 'h3', 'line-height']],
      ['blocks', ['bullet-list', 'ordered-list', 'blockquote', 'code-block', 'table', 'divider']],
      ['insert', ['link', 'image', 'mention', 'sticker', 'poll']],
    ]);
    // Dividers only BETWEEN groups; the row keeps the one-row-below-sm contract.
    const row = host.querySelector('.rte-toolbar-row') as HTMLElement;
    expect(row.className).toMatch(/overflow-x-auto/);
    expect(row.className).toMatch(/sm:flex-wrap/);
    expect(row.children[0].getAttribute('data-rte-group')).toBe('history');
    // Named exactly 插入/编辑链接; tooltips carry shortcuts, sup/sub included.
    const link = host.querySelector('[data-rte-control="link"]') as HTMLButtonElement;
    expect(link.getAttribute('aria-label')).toBe(L('rte_link_edit'));
    expect((host.querySelector('[data-rte-control="superscript"]') as HTMLElement).title).toBe(`${L('rte_superscript')} (Ctrl+.)`);
    expect((host.querySelector('[data-rte-control="subscript"]') as HTMLElement).getAttribute('aria-keyshortcuts')).toBe('Control+,');
    expect((host.querySelector('[data-rte-control="format-painter"]') as HTMLElement).title).toBe(`${L('rte_format_painter')}\n${L('rte_format_painter_hint')}`);
  });

  it('compact: the light comment-box set, 清除格式 last', () => {
    const { host } = mount({ value: 'hello', variant: 'compact' });
    expect(inventory(host)).toEqual([
      ['marks', ['bold', 'italic', 'strike', 'code']],
      ['color', ['text-color', 'text-color-more', 'bg-color', 'bg-color-more']],
      ['blocks', ['bullet-list', 'ordered-list']],
      ['insert', ['link', 'image', 'mention', 'sticker', 'poll']],
      ['format-tools', ['clear-format']],
      // A comment box on a touch device has no Mod-Z: these two buttons are the
      // only undo it has, so they are in BOTH variants.
      ['history', ['undo', 'redo']],
    ]);
  });

  it('below sm the full row reorders: 撤销/格式刷/字体 last, 加粗 first', () => {
    const { host } = mount({ value: 'hello' });
    const order = (id: string) => (host.querySelector(`[data-rte-group="${id}"]`) as HTMLElement).className.match(/max-sm:order-(\d)/)?.[1] ?? '0';
    expect([order('history'), order('format-tools'), order('font')]).toEqual(['2', '2', '2']);
    expect([order('marks'), order('color'), order('paragraph'), order('blocks'), order('insert')]).toEqual(['0', '0', '0', '0', '0']);
    // The divider that sat between 字体 and 加粗 lands between 插入 and the tail.
    const dividers = Array.from(host.querySelectorAll('.rte-toolbar-row > .rte-toolbar-divider')).map((d) => (d as HTMLElement).className.match(/max-sm:order-(\d)/)?.[1] ?? '0');
    expect(dividers).toEqual(['2', '2', '1', '0', '0', '0', '0']);
    // Compact never reorders: its row is short enough to read as it is.
    const { host: compact } = mount({ value: 'hi', variant: 'compact' });
    expect(compact.querySelector('.rte-toolbar-row')!.innerHTML).not.toContain('max-sm:order');
  });

  it('附件 and 插入引用 appear only where the host enables them', () => {
    const { host } = mount({ value: 'x', embedPicker: { upload: { zoneSlug: 'edge-inference', onUploaded: () => {} } } });
    const insert = inventory(host).find(([g]) => g === 'insert')![1];
    expect(insert).toEqual(['link', 'image', 'file', 'mention', 'sticker', 'poll', 'embed']);
  });

  // ── 字体 / 字号 / 行高 ─────────────────────────────────────────────────────

  it('字体: 默认 on top, 中文 and English groups previewed in their own stacks; a pick sets exactly the selection', () => {
    const { editor, control, md } = mount({ value: '前文 重点 后文' });
    select(editor, '重点');
    const trigger = control('font-family')!;
    // The two un-set triggers must not read the same (in 中文 both said 默认);
    // the spoken value is still 默认.
    expect(trigger.textContent).toBe(L('rte_font_trigger_default'));
    expect(trigger.getAttribute('aria-label')).toBe(`${L('rte_font_family')}: ${L('rte_font_default')}`);
    expect(control('font-size')!.textContent).toBe(L('rte_size_trigger_default'));
    expect(control('font-size')!.getAttribute('aria-label')).toBe(`${L('rte_font_size')}: ${L('rte_size_default')}`);
    expect(trigger.textContent).not.toBe(control('font-size')!.textContent);
    expect(click(trigger).mousedownPrevented).toBe(true);
    const m = menu()!;
    expect(m).not.toBeNull();
    const options = Array.from(m.querySelectorAll('[role="menuitemradio"]')) as HTMLElement[];
    expect(options[0].dataset.value).toBe('');
    expect(options[0].getAttribute('aria-checked')).toBe('true');
    const groups = Array.from(m.querySelectorAll('[role="group"]'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([L('rte_font_group_cjk'), L('rte_font_group_latin')]);
    expect(Array.from(groups[0].querySelectorAll('[role="menuitemradio"]')).map((o) => (o as HTMLElement).dataset.value)).toEqual([...RICH_CJK_FONT_FAMILIES]);
    expect(Array.from(groups[1].querySelectorAll('[role="menuitemradio"]')).map((o) => (o as HTMLElement).dataset.value)).toEqual([...RICH_LATIN_FONT_FAMILIES]);
    expect(option('georgia').style.fontFamily).toContain('Georgia');
    expect(option('kai').style.fontFamily).toContain('Kaiti');

    click(option('georgia'));
    expect(md()).toBe('前文 <span data-font="georgia">重点</span> 后文');
    expect(menu()).toBeNull(); // closes after the pick
    expect(control('font-family')!.textContent).toBe(L('rte_font_name_georgia'));

    // A selection over two fonts shows an EMPTY box (Word); 默认 removes the font.
    select(editor, '前文 重点');
    expect(control('font-family')!.textContent).toBe('');
    click(control('font-family')!);
    expect(menu()!.querySelector('[aria-checked="true"]')).toBeNull();
    click(option(''));
    expect(md()).toBe('前文 重点 后文');
  });

  it('字号: the px list; a legacy size still shows by name; Esc closes back into the editor', async () => {
    const { editor, control, md } = mount({ value: '<span data-size="lg">大字</span> 普通' });
    select(editor, '普通');
    click(control('font-size')!);
    expect(Array.from(menu()!.querySelectorAll('[role="menuitemradio"]')).map((o) => (o as HTMLElement).dataset.value)).toEqual(['', ...RICH_FONT_SIZES_PX.map(String)]);
    click(option('24'));
    expect(md()).toBe('<span data-size="lg">大字</span> <span data-size="24">普通</span>');
    expect(control('font-size')!.textContent).toBe('24');
    select(editor, '大字');
    expect(control('font-size')!.textContent).toBe(L('rte_size_lg'));

    // Keyboard open moves focus to the checked option; arrows move; Esc returns to the editor.
    keyboardClick(control('font-size')!);
    expect(document.activeElement).toBe(option(''));
    key(menu()!, 'ArrowDown');
    expect(document.activeElement).toBe(option('10'));
    key(document.activeElement!, 'Escape');
    expect(menu()).toBeNull();
    await tick(40); // tiptap's focus() lands on the next frame
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it('行高: sets the top-level block, shows the value, is disabled in a table cell', () => {
    const { editor, control, md } = mount({ value: '第一段\n\n| a | b |\n| --- | --- |\n| 1 | 2 |' });
    caret(editor, 2);
    click(control('line-height')!);
    expect(Array.from(menu()!.querySelectorAll('[role="menuitemradio"]')).map((o) => (o as HTMLElement).dataset.value)).toEqual(['', ...RICH_LINE_HEIGHTS]);
    click(option('2'));
    expect(md().startsWith('<div data-lh="2">\n\n第一段\n\n</div>')).toBe(true);
    expect(control('line-height')!.textContent).toBe('2');
    let cell = -1;
    editor.state.doc.descendants((n, pos) => {
      if (cell < 0 && n.type.name === 'tableCell') cell = pos + 2;
      return true;
    });
    caret(editor, cell);
    expect(control('line-height')!.disabled).toBe(true);
  });

  it('行高: the trigger keeps ONE width, set or not — a caret move never moves the toolbar', () => {
    const { editor, control, md } = mount({ value: '有行高的段落\n\n普通段落' });
    caret(editor, 2);
    click(control('line-height')!);
    click(option('1.5'));
    expect(md().startsWith('<div data-lh="1.5">')).toBe(true);
    const withValue = control('line-height')!.className;
    expect(control('line-height')!.textContent).toBe('1.5');
    // Into the plain paragraph below: the label empties, the box must not.
    caret(editor, editor.state.doc.content.size - 1);
    expect(control('line-height')!.textContent).toBe('');
    expect(control('line-height')!.className).toBe(withValue);
    expect(withValue).toContain('w-[4.75rem]');
  });

  // ── colours ────────────────────────────────────────────────────────────────

  it('文字颜色: the palette, a theme swatch, the split glyph re-applying it, 最近使用 and 自动', () => {
    const { editor, control, md } = mount({ value: '甲 乙 丙' });
    select(editor, '甲');
    expect(control('text-color')!.querySelector('[data-last-color]')!.getAttribute('data-last-color')).toBe('#ff0000');
    click(control('text-color-more')!);
    const d = dialog()!;
    expect(d).not.toBeNull();
    expect(d.querySelectorAll('button[data-color]')).toHaveLength(70); // 60 theme + 10 standard, no recent yet
    const swatch = d.querySelector('button[data-color="#e53935"]') as HTMLButtonElement;
    expect(swatch.getAttribute('aria-label')).toBeTruthy();
    expect(swatch.getAttribute('aria-pressed')).toBe('false');
    expect(click(swatch).mousedownPrevented).toBe(true);
    expect(md()).toBe('<span data-color="#e53935">甲</span> 乙 丙');
    expect(dialog()).toBeNull();
    // The glyph now carries that colour and applies it in one click.
    expect(control('text-color')!.querySelector('[data-last-color]')!.getAttribute('data-last-color')).toBe('#e53935');
    select(editor, '丙');
    click(control('text-color')!);
    expect(md()).toBe('<span data-color="#e53935">甲</span> 乙 <span data-color="#e53935">丙</span>');
    // Reopened on coloured text: the swatch is current and 最近使用 holds it.
    click(control('text-color-more')!);
    expect(dialog()!.querySelector('button[data-color="#e53935"][aria-pressed="true"]')).not.toBeNull();
    const recent = dialog()!.querySelector('[data-recent]')!;
    expect(Array.from(recent.querySelectorAll('button')).map((b) => b.getAttribute('data-color'))).toEqual(['#e53935']);
    expect(JSON.parse(window.localStorage.getItem('rte:recent-colors:color')!)).toEqual(['#e53935']);
    // 自动 removes the colour.
    const auto = dialog()!.querySelector('[data-rte-palette="auto"]') as HTMLButtonElement;
    expect(auto.textContent).toContain(L('rte_color_auto'));
    expect(auto.getAttribute('aria-pressed')).toBe('false');
    click(auto);
    expect(md()).toBe('<span data-color="#e53935">甲</span> 乙 丙');
  });

  it('背景色: a standard swatch stores hex on data-bg; a legacy named background marks its swatch', () => {
    const { editor, control, md } = mount({ value: '<span data-bg="yellow">旧</span> 新' });
    select(editor, '新');
    click(control('bg-color-more')!);
    click(dialog()!.querySelector('button[data-color="#ffff00"]')!);
    expect(md()).toBe('<span data-bg="yellow">旧</span> <span data-bg="#ffff00">新</span>');
    select(editor, '旧');
    click(control('bg-color-more')!);
    expect(dialog()!.querySelector(`button[data-color="${LEGACY_COLOR_SWATCH.yellow}"]`)!.getAttribute('aria-pressed')).toBe('true');
  });

  it('自定义: `#` is implied, the error waits for blur / submit, #RGB / uppercase normalise to lowercase #rrggbb', () => {
    const { editor, control, md } = mount({ value: '自定义颜色' });
    select(editor, '颜色');
    click(control('text-color-more')!);
    const hex = dialog()!.querySelector('input[type="text"]') as HTMLInputElement;
    const apply = dialog()!.querySelector('button[type="submit"]') as HTMLButtonElement;
    const alerting = () => dialog()!.querySelector('[role="alert"]') != null;

    // Typing `#1f6feb` one key at a time used to flash the error at #1, #1f,
    // #1f6f and #1f6fe (and announce each flash).
    for (const partial of ['#', '#1', '#1f', '#1f6f', '#1f6fe']) {
      typeInto(hex, partial);
      expect([partial, alerting(), hex.getAttribute('aria-invalid')]).toEqual([partial, false, null]);
    }
    typeInto(hex, 'red');
    act(() => hex.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); // React 17+ listens for focusout
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    expect(alerting()).toBe(true);
    // 应用 stays enabled so Enter on garbage still reaches the form (a disabled
    // default button swallows the implicit submission).
    expect(apply.disabled).toBe(false);
    submit(hex.form!);
    expect(dialog()).not.toBeNull();
    expect(md()).toBe('自定义颜色');

    // A bare hex — what a design tool copies — is accepted with an implied `#`.
    typeInto(hex, '1f6feb');
    expect(alerting()).toBe(false);
    expect((dialog()!.querySelector('input[type="color"]') as HTMLInputElement).value).toBe('#1f6feb');
    typeInto(hex, '#1F6');
    expect((dialog()!.querySelector('input[type="color"]') as HTMLInputElement).value).toBe('#11ff66');
    typeInto(hex, 'ABC');
    submit(hex.form!);
    expect(md()).toBe('自定义<span data-color="#aabbcc">颜色</span>');
    click(control('text-color-more')!);
    expect(dialog()!.querySelector('[data-recent] button[data-color="#aabbcc"]')).not.toBeNull();
  });

  it('swatches preview through the page’s own hex rules, and grow for a finger', () => {
    const { editor, control } = mount({ value: 'abc' });
    select(editor, 'b');
    click(control('text-color-more')!);
    const swatch = dialog()!.querySelector('button[data-color="#e53935"]') as HTMLButtonElement;
    // `.rte-swatch` + the custom property IS the contract: app/rich-text.css
    // paints it with the very expression it paints span[data-color] with, so a
    // dark ground clamps the preview exactly like the text.
    expect(swatch.classList.contains('rte-swatch')).toBe(true);
    expect(swatch.dataset.kind).toBe('color');
    expect(swatch.style.getPropertyValue('--rt-c')).toBe('#e53935');
    expect(swatch.style.backgroundColor).toBe(''); // never the raw hex
    expect(swatch.style.width).toBe('20px');
    const bar = control('text-color')!.querySelector('[data-last-color]') as HTMLElement;
    expect([bar.classList.contains('rte-swatch'), bar.style.getPropertyValue('--rt-c')]).toEqual([true, '#ff0000']);
    expect(control('text-color-more')!.className).toContain('[@media(pointer:coarse)]:w-6');

    // A touch device gets 28 px squares, and the panel widens to hold them.
    const real = window.matchMedia;
    vi.stubGlobal('matchMedia', (q: string) => ({ ...real(q), matches: q.includes('coarse') }));
    const touch = mount({ value: 'abc' });
    select(touch.editor, 'b');
    click(touch.control('text-color-more')!);
    const big = dialog()!.querySelector('button[data-color="#e53935"]') as HTMLButtonElement;
    expect([big.style.width, big.style.height]).toEqual(['28px', '28px']);
    expect(dialog()!.style.width).toContain('340px'); // 10 × 28 + 9 gaps + padding
  });

  it('palette keyboard: opens on the current swatch, arrows walk the grid across sections, Esc returns to the editor', async () => {
    const { editor, control } = mount({ value: 'abc' });
    select(editor, 'b');
    keyboardClick(control('text-color-more')!);
    const first = dialog()!.querySelector('[data-nav-row="0"][data-nav-col="0"]');
    expect(document.activeElement).toBe(first);
    key(document.activeElement!, 'ArrowRight');
    expect((document.activeElement as HTMLElement).dataset.color).toBe('#000000');
    key(document.activeElement!, 'ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.color).toBe(THEME_GRID[1][1].hex);
    for (let i = 0; i < 5; i += 1) key(document.activeElement!, 'ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.navRow).toBe('6'); // 标准色
    expect((document.activeElement as HTMLElement).dataset.color).toBe(STANDARD_COLORS[1].hex);
    key(document.activeElement!, 'End');
    expect((document.activeElement as HTMLElement).dataset.color).toBe(STANDARD_COLORS[9].hex);
    key(document.activeElement!, 'Escape');
    expect(dialog()).toBeNull();
    await tick(40);
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it('inside the 知识库 reader the palette and the link dialog portal into .reader-root and wear its theme', () => {
    // A boxed editor is a site `.surface` card (lib/rich-text-ground.ts): only an editor sitting directly on the reader ground takes its tone.
    const { host, editor, control } = mount({ value: '读书笔记', hostClass: 'reader-root', chrome: 'document' });
    select(editor, '笔记');
    click(control('text-color-more')!);
    const d = dialog()!;
    expect(host.contains(d)).toBe(true);
    expect(d.className).toContain('var(--reader-surface)');
    expect((d.querySelector('button[data-color="#000000"]') as HTMLElement).className).toContain('var(--reader-border)');
    key(window, 'Escape');
    click(control('link')!);
    expect(host.contains(dialog())).toBe(true);
    expect(control('bold')!.className).toContain('var(--reader-muted)');
  });

  // ── 格式刷 ──────────────────────────────────────────────────────────────────

  /** A real drag-select gesture as the painter sees it: mousedown on the editor, selection, mouseup on the document. */
  async function mouseSelect(ed: Editor, needle: string) {
    act(() => {
      ed.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    select(ed, needle);
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    await tick();
  }

  it('格式刷 one-shot: copies at the selection, paints the next mouse selection exactly, disarms, one undo step', async () => {
    const { editor, control, md } = mount({ value: '<span data-color="#e53935">**源格式**</span> 目标文字 *旧斜体*' });
    select(editor, '源格式');
    click(control('format-painter')!);
    expect(control('format-painter')!.getAttribute('aria-pressed')).toBe('true');
    expect(editor.view.dom.classList.contains(FORMAT_PAINTER_ARMED_CLASS)).toBe(true);

    // A plain click (empty selection) paints nothing and stays armed.
    act(() => editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    caret(editor, rangeOf(editor, '目标').from);
    act(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })));
    await tick();
    expect(formatPainterState(editor.state).armed).toBe(true);

    // The italic target loses its italic and gets exactly bold + colour.
    await mouseSelect(editor, '旧斜体');
    expect(md()).toBe('<span data-color="#e53935">**源格式**</span> 目标文字 <span data-color="#e53935">**旧斜体**</span>');
    expect(formatPainterState(editor.state).armed).toBe(false);
    expect(control('format-painter')!.getAttribute('aria-pressed')).toBe('false');
    expect(editor.view.dom.classList.contains(FORMAT_PAINTER_ARMED_CLASS)).toBe(false);

    act(() => {
      editor.commands.undo();
    });
    expect(md()).toBe('<span data-color="#e53935">**源格式**</span> 目标文字 *旧斜体*');
  });

  it('格式刷 sticky (double-click): paints every selection — keyboard selections too — until Esc', async () => {
    const { editor, control, md } = mount({ value: '<sup>上</sup> 一 二 三' });
    select(editor, '上');
    const painter = control('format-painter')!;
    click(painter, 1);
    click(painter, 2);
    expect(formatPainterState(editor.state)).toMatchObject({ armed: true, sticky: true });
    await mouseSelect(editor, '一');
    // Keyboard: Shift+arrows, painted when Shift is released.
    select(editor, '二');
    act(() => {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    });
    expect(md()).toBe('<sup>上</sup> <sup>一</sup> <sup>二</sup> 三');
    expect(formatPainterState(editor.state).armed).toBe(true);
    act(() => {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(formatPainterState(editor.state).armed).toBe(false);
    await mouseSelect(editor, '三');
    expect(md()).toBe('<sup>上</sup> <sup>一</sup> <sup>二</sup> 三');
    // A single click on the armed button also stops it.
    click(painter, 1);
    expect(formatPainterState(editor.state).armed).toBe(true);
    click(painter, 1);
    expect(formatPainterState(editor.state).armed).toBe(false);
  });

  it('格式刷 one-shot waits out a double click, so a TRIPLE click paints the paragraph', async () => {
    const { editor, control, md } = mount({ value: '<span data-color="#c00000">**源**</span> 甲\n\n第二段 三击 结束' });
    select(editor, '源');
    click(control('format-painter')!);

    // Double click (the word) → third press (the paragraph). The waiting paint
    // is cancelled by that third mousedown; without the wait the word was
    // already painted and the painter disarmed before the triple click landed.
    act(() => editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 2 })));
    select(editor, '三击');
    act(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 2 })));
    await tick(120); // the human gap between the second and third click
    expect(md()).toBe('<span data-color="#c00000">**源**</span> 甲\n\n第二段 三击 结束');
    expect(formatPainterState(editor.state).armed).toBe(true);
    act(() => editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 3 })));
    select(editor, '第二段 三击 结束');
    act(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 3 })));
    await tick(20);
    expect(md()).toBe('<span data-color="#c00000">**源**</span> 甲\n\n<span data-color="#c00000">**第二段 三击 结束**</span>');
    expect(formatPainterState(editor.state).armed).toBe(false);
  });

  it('格式刷 one-shot: a double click alone still paints the word, once the multi-click window is over', async () => {
    const { editor, control, md } = mount({ value: '<sup>上</sup> 甲 乙' });
    select(editor, '上');
    click(control('format-painter')!);
    act(() => editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 2 })));
    select(editor, '乙');
    act(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 2 })));
    expect(md()).toBe('<sup>上</sup> 甲 乙'); // still waiting for a possible third click
    await tick(MULTI_CLICK_MS + 40);
    expect(md()).toBe('<sup>上</sup> 甲 <sup>乙</sup>');
    expect(formatPainterState(editor.state).armed).toBe(false);
  });

  it('格式刷 disarms when focus leaves the editor, but not for the toolbar’s own panels', async () => {
    const { editor, control } = mount({ value: '<span data-bg="#ffff00">源</span> 目标文字' });
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    select(editor, '源');
    click(control('format-painter')!);
    expect(formatPainterState(editor.state).armed).toBe(true);

    // The palette's own input keeps the editor's selection, so it keeps the brush.
    click(control('bg-color-more')!);
    const hex = dialog()!.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => {
      hex.focus();
      editor.view.dom.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: hex }));
    });
    await tick(5);
    expect(formatPainterState(editor.state).armed).toBe(true);
    key(window, 'Escape');

    // The title field of the composer is not: Esc pressed THERE never reaches
    // the editor's keymap, so the brush used to survive and repaint the next
    // thing selected.
    act(() => {
      outside.focus();
      editor.view.dom.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    });
    await tick(5);
    expect(formatPainterState(editor.state).armed).toBe(false);
    expect(control('format-painter')!.getAttribute('aria-pressed')).toBe('false');
    expect(editor.view.dom.classList.contains(FORMAT_PAINTER_ARMED_CLASS)).toBe(false);
    outside.remove();
  });

  it('格式刷 never copies links, keeps the target link, and never puts inline code on an @mention', async () => {
    const { editor, control, md } = mount({ value: '[来源](/zones) `代码` 看 [链接文字](/docs) 和 [@王伟](/users/wang) 好' });
    select(editor, '来源');
    click(control('format-painter')!);
    expect(formatPainterState(editor.state).marks.map((m) => m.type.name)).toEqual([]);
    await mouseSelect(editor, '链接文字');
    expect(md()).toContain('[链接文字](/docs)');
    select(editor, '代码');
    click(control('format-painter')!);
    await mouseSelect(editor, '王伟 好');
    // The selection started inside the mention: it is widened to the whole mention, which takes no code.
    expect(md()).toContain('和 [@王伟](/users/wang)` 好`');
    expect(md()).not.toContain('[`@');
  });

  // ── 插入/编辑链接 ─────────────────────────────────────────────────────────

  const linkForm = () => dialog()?.querySelector('form') as HTMLFormElement | null;
  const textField = () => linkForm()!.querySelector('#rte-link-text') as HTMLInputElement;
  const urlField = () => linkForm()!.querySelector('#rte-link-url') as HTMLInputElement;

  it('insert at a caret: the address field has focus, Enter inserts text as a link, the next keystroke is plain', async () => {
    const { editor, control, md } = mount({ value: 'hello' });
    act(() => {
      editor.commands.focus('end');
    });
    click(control('link')!);
    expect(dialog()!.getAttribute('aria-label')).toBe(L('rte_link_edit'));
    expect(document.activeElement).toBe(urlField());
    expect(textField().value).toBe('');
    typeInto(textField(), '官网');
    typeInto(urlField(), 'example.com');
    submit(linkForm()!);
    expect(dialog()).toBeNull();
    expect(md()).toBe('hello[官网](https://example.com/)');
    await tick(40);
    expect(document.activeElement).toBe(editor.view.dom);
    act(() => {
      editor.commands.insertContent('!');
    });
    expect(md()).toBe('hello[官网](https://example.com/)!');
  });

  it('a selection becomes a link keeping its formatting; an invalid address is refused and nothing changes', () => {
    const { editor, control, md } = mount({ value: '看 <span data-color="#e53935">**文档**</span> 吧' });
    select(editor, '文档');
    click(control('link')!);
    expect(textField().value).toBe('文档');
    typeInto(urlField(), 'javascript:alert(1)');
    submit(linkForm()!);
    expect(dialog()).not.toBeNull();
    expect(linkForm()!.querySelector('[role="alert"]')).not.toBeNull();
    expect(urlField().getAttribute('aria-invalid')).toBe('true');
    expect(md()).toBe('看 <span data-color="#e53935">**文档**</span> 吧');
    typeInto(urlField(), '/docs/zones');
    submit(linkForm()!);
    expect(md()).toBe('看 <span data-color="#e53935">[**文档**](/docs/zones)</span> 吧');
  });

  it('inside a link: prefilled; a new address re-points it, new text replaces the words, 移除链接 unlinks, Esc cancels', () => {
    const { editor, control, md } = mount({ value: '读 [旧标题](https://a.example/) 完' });
    caret(editor, rangeOf(editor, '旧标题').from + 1);
    expect(linkAtSelection(editor.state)).toMatchObject({ href: 'https://a.example/', mention: false });
    click(control('link')!);
    expect(textField().value).toBe('旧标题');
    expect(urlField().value).toBe('https://a.example/');
    typeInto(urlField(), 'https://b.example/x');
    submit(linkForm()!);
    expect(md()).toBe('读 [旧标题](https://b.example/x) 完');

    caret(editor, rangeOf(editor, '旧标题').from + 1);
    click(control('link')!);
    typeInto(textField(), '新标题');
    submit(linkForm()!);
    expect(md()).toBe('读 [新标题](https://b.example/x) 完');

    caret(editor, rangeOf(editor, '新标题').from + 1);
    click(control('link')!);
    key(urlField(), 'Escape');
    expect(dialog()).toBeNull();
    expect(md()).toBe('读 [新标题](https://b.example/x) 完');

    click(control('link')!);
    const remove = Array.from(linkForm()!.querySelectorAll('button')).find((b) => b.textContent === L('rte_link_remove'))!;
    click(remove);
    expect(md()).toBe('读 新标题 完');
  });

  it('the caret bubble: 打开 / 编辑 / 取消链接 for a link; 打开 only for an @mention, whose toolbar button is disabled', async () => {
    const { editor, control, md } = mount({ value: '看 [文档](/docs) 与 [@王伟](/users/wang) 好' });
    // Layout jsdom does not have: the caret sits at (100, 100–120) inside a 700 px editor.
    editor.view.coordsAtPos = () => ({ left: 100, right: 100, top: 100, bottom: 120 });
    editor.view.dom.parentElement!.getBoundingClientRect = () => ({ top: 0, bottom: 700, left: 0, right: 900, width: 900, height: 700, x: 0, y: 0, toJSON: () => ({}) });
    const bubble = () => document.body.querySelector('[data-rte-link-bubble]') as HTMLElement | null;

    act(() => editor.view.dom.focus());
    caret(editor, rangeOf(editor, '文档').from + 1);
    expect(bubble()).not.toBeNull();
    const open = bubble()!.querySelector('a') as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe('/docs');
    expect(open.target).toBe('_blank');
    expect(bubble()!.querySelectorAll('button')).toHaveLength(2);
    // 编辑 opens the dialog (and hides the bubble) — prefilled from the link.
    click(bubble()!.querySelector(`button[aria-label="${L('rte_link_edit_short')}"]`)!);
    expect(bubble()).toBeNull();
    expect(urlField().value).toBe('/docs');
    key(urlField(), 'Escape');
    await tick(40); // focus returns to the editor on the next frame, and the bubble with it
    expect(bubble()).not.toBeNull();
    click(bubble()!.querySelector(`button[aria-label="${L('rte_link_unlink')}"]`)!);
    expect(md()).toBe('看 文档 与 [@王伟](/users/wang) 好');
    expect(bubble()).toBeNull();

    caret(editor, rangeOf(editor, '王伟').from + 1);
    expect(bubble()).not.toBeNull();
    expect(bubble()!.querySelectorAll('button')).toHaveLength(0);
    expect(control('link')!.disabled).toBe(true);

    // Blur hides it.
    act(() => editor.view.dom.blur());
    expect(bubble()).toBeNull();
  });

  // ── @提及 / 上标下标 / 清除格式 ────────────────────────────────────────────

  it('@提及 types the trigger and opens the SAME mention suggestion as typing @', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const { editor, control } = mount({ value: 'hello' });
    act(() => {
      editor.commands.focus('end');
    });
    click(control('mention')!);
    expect(editor.state.doc.textContent).toBe('hello @');
    expect(MentionSuggestionPluginKey.getState(editor.state)?.active).toBe(true);
    await tick(); // the suggestion plugin starts its session after an awaited items() call
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled(); // an empty query never searches

    act(() => {
      editor.commands.setContent('你好', false);
      editor.commands.focus('end');
    });
    click(control('mention')!);
    expect(editor.state.doc.textContent).toBe('你好@');
    expect(MentionSuggestionPluginKey.getState(editor.state)?.active).toBe(true);
  });

  it('Enter while the @人 list is still searching is swallowed, then picks once the rows are this query’s', async () => {
    // The picker keeps the PREVIOUS query's rows on screen while the next ones
    // load, so an Enter here used to either split the paragraph and leave "@adm"
    // as plain text (no rows yet) or insert the person the previous query
    // matched. Both are decided by `pending` (components/mention/MentionPicker.tsx).
    let release: (() => void) | null = null;
    const person = { userId: 'u1', handle: 'admin', displayName: 'Admin', avatarUrl: null, department: null, lab: null, isPrivate: false };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(new Response(JSON.stringify({ items: [person] })));
          }),
      ),
    );
    const { editor, control, md } = mount({ value: 'hello\n\nAfter' });
    act(() => {
      editor.commands.focus(6);
    });
    click(control('mention')!);
    act(() => {
      editor.commands.insertContent('adm');
    });
    await tick();

    const enter = () => {
      const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      act(() => {
        editor.view.dom.dispatchEvent(ev);
      });
      return ev.defaultPrevented;
    };

    // Still searching: the key belongs to the picker, not to the document.
    expect(enter()).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(md()).toBe('hello @adm\n\nAfter');

    await tick(DEBOUNCE_WAIT_MS); // past the 160 ms debounce → the request goes out
    act(() => release!());
    await tick();
    expect(enter()).toBe(true);
    expect(md()).toBe('hello [@Admin](/users/admin) \n\nAfter');
  });

  it('@提及 is disabled in a code block', () => {
    const { editor, control } = mount({ value: '```\ncode\n```' });
    caret(editor, 2);
    expect(control('mention')!.disabled).toBe(true);
  });

  it('上标 / 下标 toggle and replace each other; disabled in a code block', () => {
    const { editor, control, md } = mount({ value: 'x2 H2O\n\n```\ncode\n```' });
    select(editor, '2 ');
    select(editor, 'x2');
    act(() => {
      const { to } = rangeOf(editor, 'x2');
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, to - 1, to)));
    });
    click(control('superscript')!);
    expect(md().startsWith('x<sup>2</sup> H2O')).toBe(true);
    expect(control('superscript')!.getAttribute('aria-pressed')).toBe('true');
    click(control('subscript')!);
    expect(md().startsWith('x<sub>2</sub> H2O')).toBe(true);
    expect(control('superscript')!.getAttribute('aria-pressed')).toBe('false');
    click(control('subscript')!);
    expect(md().startsWith('x2 H2O')).toBe(true);
    let code = -1;
    editor.state.doc.descendants((n, pos) => {
      if (code < 0 && n.type.name === 'codeBlock') code = pos + 2;
      return true;
    });
    caret(editor, code);
    expect(control('superscript')!.disabled).toBe(true);
    expect(control('subscript')!.disabled).toBe(true);
  });

  it('清除格式 drops every inline format and the line height, keeps links and mentions', () => {
    const { editor, control, md } = mount({
      value: '<div data-lh="2">\n\n<span data-size="24"><span data-color="#e53935">**红**</span></span> <sup>上</sup> [链](/x) [@王伟](/users/wang)\n\n</div>',
    });
    act(() => {
      editor.commands.selectAll();
    });
    click(control('clear-format')!);
    expect(md()).toBe('红 上 [链](/x) [@王伟](/users/wang)');
  });

  // ── keyboard / focus ───────────────────────────────────────────────────────

  it('a MOUSE-opened menu still takes ↑ / ↓, and Tab never walks out of a panel', async () => {
    const { editor, control } = mount({ value: 'alpha beta' });
    caret(editor, 3);
    click(control('font-size')!); // opened with the pointer: focus is still in the text
    expect(document.activeElement).not.toBe(option(''));
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    act(() => {
      editor.view.dom.dispatchEvent(arrow);
    });
    // Claimed by the panel: without this the caret moved under an open menu that
    // could not be reached by keyboard at all.
    expect(arrow.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(option(''));
    // Tab closes a menu (APG) and hands the caret back.
    key(document.activeElement!, 'Tab');
    expect(menu()).toBeNull();
    await tick(40);
    expect(document.activeElement).toBe(editor.view.dom);

    // A dialog wraps instead: the palette is portaled at the END of <body>, so
    // Tab used to land on whatever the page keeps there — a hidden navbar.
    keyboardClick(control('text-color-more')!);
    const items = Array.from(dialog()!.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')).filter((el) => el.tabIndex !== -1);
    act(() => items[items.length - 1].focus());
    key(document.activeElement!, 'Tab');
    expect(document.activeElement).toBe(items[0]);
    key(document.activeElement!, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
    expect(dialog()).not.toBeNull();
  });

  it('⌘K / Ctrl+K opens 插入/编辑链接 and never reaches the site-wide search palette', () => {
    const { editor, control } = mount({ value: 'hello' });
    act(() => {
      editor.commands.focus('end');
    });
    expect((control('link') as HTMLElement).title).toBe(`${L('rte_link_edit')} (Ctrl+K)`);
    let reachedWindow = 0;
    const spy = () => {
      reachedWindow += 1;
    };
    window.addEventListener('keydown', spy);
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      editor.view.dom.dispatchEvent(ev);
    });
    window.removeEventListener('keydown', spy);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('#rte-link-url')).not.toBeNull();
    expect(ev.defaultPrevented).toBe(true);
    expect(reachedWindow).toBe(0); // SearchTrigger listens on window and ignores defaultPrevented
  });

  // ── 表格条 ─────────────────────────────────────────────────────────────────

  it('the table strip OVERLAYS while the caret is in a table — it never reserves a band', async () => {
    const { editor, host } = mount({ value: '第一段\n\n| a | b |\n| --- | --- |\n| 1 | 2 |' });
    const strip = () => host.querySelector('.rte-table-strip') as HTMLElement | null;
    caret(editor, 2);
    expect(strip()).toBeNull(); // a table somewhere in the document is not enough
    let cell = -1;
    editor.state.doc.descendants((n, pos) => {
      if (cell < 0 && n.type.name === 'tableCell') cell = pos + 2;
      return true;
    });
    caret(editor, cell);
    expect(strip()).not.toBeNull();
    expect(strip()!.className).toContain('absolute');
    expect((host.querySelector('.rte-toolbar') as HTMLElement).className).toContain('relative');
    // Fresh overlay: the second tap of a quick double-tap in the cell under it
    // must not land on 删除行.
    expect(strip()!.className).toContain('pointer-events-none');
    await tick(TABLE_STRIP_ARM_MS + 40);
    expect(strip()!.className).not.toContain('pointer-events-none');
    caret(editor, 2);
    expect(strip()).toBeNull();
  });

  // ── cost ───────────────────────────────────────────────────────────────────

  it('a meta-only transaction re-renders without re-running the toolbar’s dry runs', () => {
    const { editor } = mount({ value: 'hello world' });
    const original = editor.can.bind(editor);
    let calls = 0;
    editor.can = () => {
      calls += 1;
      return original();
    };
    act(() => {
      editor.view.dispatch(editor.state.tr.setMeta('toolbar-v3-probe', true));
    });
    expect(calls).toBe(0);
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 3 });
    });
    expect(calls).toBeGreaterThan(0);
  });

  it('the editor host does not re-render while typing changes no control', () => {
    // react-dom saves and restores the selection around EVERY commit, and on a
    // focused contenteditable that walks the whole post. A long body's onChange
    // is debounced (DEFER_EMIT_FROM), so before this the ONLY per-keystroke
    // re-render was tiptap's — and it cost ~3 ms a key.
    const { host, editor } = mount({ value: 'hello world', frozen: true });
    const bold = host.querySelector('[data-rte-control="bold"]') as HTMLElement;
    // React writes a fresh props object onto the node on every commit that
    // touches it — the toolbar's handlers are new closures per render.
    const propsOf = (el: Element) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
      return key ? (el as unknown as Record<string, unknown>)[key] : null;
    };
    act(() => {
      editor.commands.insertContent('!'); // the FIRST key legitimately enables 撤销
    });
    const before = propsOf(bold);
    expect(before).not.toBeNull();
    act(() => {
      editor.commands.insertContent('?');
    });
    expect(propsOf(bold)).toBe(before);
    act(() => {
      editor.commands.setTextSelection({ from: 3, to: 3 }); // a caret move in plain text
    });
    expect(propsOf(bold)).toBe(before);
    // …and it DOES re-render the moment a control changes.
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 4 });
      editor.commands.toggleBold();
    });
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(propsOf(bold)).not.toBe(before);
  });

  it('a transaction never rebuilds the toolbar’s divider ResizeObserver', () => {
    let built = 0;
    class CountingRO {
      constructor() {
        built += 1;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', CountingRO);
    // 插入引用 is the case that broke: its host passed a fresh arrow per render.
    const { editor } = mount({ value: 'hello', embedPicker: {} });
    const afterMount = built;
    expect(afterMount).toBeGreaterThan(0);
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        editor.commands.insertContent('x');
      });
      act(() => {
        editor.commands.setTextSelection({ from: 2, to: 4 });
      });
    }
    // Each rebuild also re-read every divider's offsetTop — a forced layout in
    // the commit phase.
    expect(built).toBe(afterMount);
  });

  it('the two modal dialogs are code-split out of every page that has a comment box', () => {
    const src = readFileSync(resolve(__dirname, '../components/RichTextEditor.tsx'), 'utf8');
    expect(src).not.toMatch(/^import \{[^}]*PollComposerDialog/m);
    expect(src).not.toMatch(/^import \{[^}]*EmbedPickerDialog/m);
    expect(src).toContain("dynamic(() => import('@/components/polls/PollComposerDialog')");
    expect(src).toContain("dynamic(() => import('@/components/zones/embeds/EmbedPickerDialog')");
  });

  it('the headless stack registers the painter commands (the one extension list)', () => {
    const ed = new Editor({ extensions: buildRichTextExtensions(), content: '<p><strong>a</strong> b</p>' });
    ed.commands.setTextSelection({ from: 1, to: 2 });
    expect(ed.commands.armFormatPainter()).toBe(true);
    ed.commands.setTextSelection({ from: 3, to: 4 });
    expect(ed.commands.applyFormatPainter()).toBe(true);
    expect(ed.storage.markdown.getMarkdown()).toBe('**a** **b**');
    expect(formatPainterState(ed.state).armed).toBe(false);
    ed.destroy();
  });
});
