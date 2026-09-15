// @vitest-environment jsdom
//
// 富文本 → 简洁输入 in the comment composer (components/video/CommentComposer.tsx).
// The simple box is a markdown textarea; switching used to put the rich
// editor's HTML (`<span data-color>`, `<img width>`, `<br>` in cells) into it as
// raw tags without a word. Pins: a body with no HTML switches at once; one with
// only formatting asks and can strip it (text kept); one with other markup asks
// and switches byte-for-byte; 继续使用富文本 stays. Plus the pure detector.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { htmlMarkupIn } from '@/lib/markdown-text';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => '/videos/x',
  useSearchParams: () => new URLSearchParams(),
}));

const messages = JSON.parse(readFileSync(resolve(__dirname, '../messages/zh-CN.json'), 'utf8')) as Record<string, Record<string, string>>;
const vu = messages.video_ui;

describe('htmlMarkupIn', () => {
  it('tells formatting spans from other markup, and ignores code and prose', () => {
    expect(htmlMarkupIn('plain **bold** and a < b > c')).toEqual({ formatting: false, other: false });
    expect(htmlMarkupIn('a <span data-color="red">b</span> <span data-size="lg">c</span>')).toEqual({ formatting: true, other: false });
    expect(htmlMarkupIn('![p](/x.png)\n\n<img src="/x.png" alt="p" width="120">')).toEqual({ formatting: false, other: true });
    expect(htmlMarkupIn('| a<br>b | c |')).toEqual({ formatting: false, other: true });
    expect(htmlMarkupIn('<span data-color="red">x</span><strong>y</strong>')).toEqual({ formatting: true, other: true });
    // Tags inside code are literal text, and a foreign span is not ours.
    expect(htmlMarkupIn('`<span data-color="red">`\n\n```html\n<div>x</div>\n```')).toEqual({ formatting: false, other: false });
    expect(htmlMarkupIn('<span class="x">y</span>')).toEqual({ formatting: false, other: true });
  });
});

describe('CommentComposer — leaving 富文本', async () => {
  const { CommentComposer } = await import('@/components/video/CommentComposer');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  beforeAll(() => {
    const proto = Range.prototype as unknown as Record<string, unknown>;
    proto.getClientRects ??= () => [];
    proto.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView ??= () => {};
  });

  let mounted: { root: Root; host: HTMLElement } | null = null;
  afterEach(() => {
    if (mounted) {
      const m = mounted;
      act(() => m.root.unmount());
      m.host.remove();
      mounted = null;
    }
  });

  function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(NextIntlClientProvider, {
          locale: 'zh-CN',
          messages,
          onError: () => {},
          children: createElement(CommentComposer, { slug: 'x', onPosted: () => {} }),
        }),
      );
    });
    mounted = { root, host };
    const byLabel = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
    const byText = (text: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;
    const click = (el: HTMLElement) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    /** Turns on 富文本 and puts `html` into the editor as if typed (an update → onChange → body). */
    const richWith = (html: string) => {
      click(byLabel(vu.rich_on)!);
      const dom = host.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null;
      if (!dom?.editor) throw new Error('rich editor not mounted');
      act(() => {
        dom.editor!.commands.setContent(html, true);
      });
    };
    const textarea = () => host.querySelector('textarea');
    return { host, byText, click, richWith, textarea };
  }

  it('a body without HTML switches straight back', () => {
    const { byText, click, richWith, textarea } = mount();
    richWith('<p><strong>bold</strong> text</p>');
    click(byText(vu.rich_off)!);
    expect(textarea()?.value).toBe('**bold** text');
  });

  it('formatting only: asks, and 清除格式并切换 keeps the text without the spans', () => {
    const { host, byText, click, richWith, textarea } = mount();
    richWith('<p>a <span data-color="red">red</span> word</p>');
    click(byText(vu.rich_off)!);
    expect(textarea()).toBeNull(); // still rich
    expect(host.textContent).toContain(vu.rich_off_formatting_note);
    click(byText(vu.rich_off_strip)!);
    expect(textarea()?.value).toBe('a red word');
  });

  it('other markup: asks, 继续使用富文本 stays, 仍然切换 keeps the body byte-for-byte', () => {
    const { host, byText, click, richWith, textarea } = mount();
    richWith('<p><span data-color="red">x</span></p><img src="/api/uploads/images/a.png" alt="a" width="120">');
    click(byText(vu.rich_off)!);
    expect(host.textContent).toContain(vu.rich_off_markup_note);
    click(byText(vu.rich_off_stay)!);
    expect(textarea()).toBeNull();
    expect(byText(vu.rich_off)).not.toBeNull();
    click(byText(vu.rich_off)!);
    click(byText(vu.rich_off_anyway)!);
    const value = textarea()?.value ?? '';
    expect(value).toContain('<span data-color="red">x</span>');
    expect(value).toContain('width="120"');
  });

  // ED-30: every guard button removes itself when clicked, and nothing moved
  // focus afterwards — it fell to <body>.
  it('focus follows the choice: the question, back to the editor, into the textarea at the end', async () => {
    const { host, byText, click, richWith, textarea } = mount();
    richWith('<p>hello <span data-color="red">red</span> world</p>');
    click(byText(vu.rich_off)!);
    expect(document.activeElement).toBe(byText(vu.rich_off_strip));

    click(byText(vu.rich_off_stay)!);
    // tiptap's focus command lands on the next animation frame.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(host.querySelector('.ProseMirror')?.contains(document.activeElement)).toBe(true);

    click(byText(vu.rich_off)!);
    click(byText(vu.rich_off_strip)!);
    const ta = textarea()!;
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(ta.selectionEnd).toBe(ta.value.length);
  });

  it('a switch with no HTML lands in the textarea too; the first mount does not steal focus', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    const { byText, click, richWith, textarea } = mount();
    expect(document.activeElement).toBe(outside);
    richWith('<p>plain words</p>');
    click(byText(vu.rich_off)!);
    expect(document.activeElement).toBe(textarea());
    outside.remove();
  });
});
