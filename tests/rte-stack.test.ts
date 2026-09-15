// @vitest-environment jsdom
//
// The editor as SHIPPED, end to end in jsdom — the integration the per-slice
// suites could not see:
//   1. buildRichTextExtensions (components/editor/rich-text-extensions.ts) is
//      the ONE list: its schema has exactly one `code` mark and one `codeBlock`
//      node (the replacements, not StarterKit's), and the order constraints
//      other suites rely on hold.
//   2. Every keyboard hint the toolbar prints names a binding that really runs.
//   3. components/RichTextEditor.tsx, mounted for real with the zh-CN messages:
//      文字样式 sits right after 行内代码 in both variants, the two code icons
//      differ, bold is disabled inside inline code, the code block renders its
//      node view, the counter counts visible text, a non-image drop on a
//      comment box is refused out loud, an image upload failure toasts, no
//      toolbar string is missing from messages/zh-CN.json, the table strip keeps
//      its box while the caret moves in and out of a table, a keystroke is
//      serialized once (debounced on long bodies, flushed on blur), and the
//      counter does not rescan on a caret move.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { Editor, type AnyExtension } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { CodeBlockWithView } from '@/components/editor/CodeBlockView';
import { FlowExtension } from '@/components/editor/flow-extension';
import { TOOLBAR_SHORTCUTS, ariaKeyShortcuts, formatShortcut } from '@/components/editor/shortcuts';
import { TABLE_EXTENSIONS } from '@/components/markdown-table';

const toasts: Array<{ kind: string; message: string }> = [];

// Counts the counter's scans (ED-32) without changing what they return.
const scans = { richTextLength: 0 };
vi.mock('@/lib/markdown-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/markdown-text')>();
  return {
    ...actual,
    richTextLength: (md: string) => {
      scans.richTextLength += 1;
      return actual.richTextLength(md);
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => '/zones/x/posts/new',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/Toaster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/Toaster')>();
  return {
    ...actual,
    pushToast: (kind: string, message: string) => {
      toasts.push({ kind, message });
    },
  };
});

const messages = JSON.parse(readFileSync(resolve(__dirname, '../messages/zh-CN.json'), 'utf8')) as Record<string, Record<string, string>>;
const ui = messages.ui;

// ─────────────────────────────────────────────────────────────────────────────
describe('buildRichTextExtensions — the one list', () => {
  it('replaces StarterKit code / codeBlock instead of doubling them', () => {
    const ed = new Editor({ extensions: buildRichTextExtensions({ embed: {}, upload: {} }), content: '' });
    const names = ed.extensionManager.extensions.map((e) => e.name);
    expect(names.filter((n) => n === 'code')).toHaveLength(1);
    expect(names.filter((n) => n === 'codeBlock')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
    // The InlineCode spec (format-marks.ts), not the stock `excludes: '_'`.
    expect(ed.schema.marks.code.spec.excludes).toBe('code bold italic strike');
    // The app code block: keeps `code: true` (the paste caret rule keys on it) and carries filename / highlight.
    expect(ed.schema.nodes.codeBlock.spec.code).toBe(true);
    expect(Object.keys(ed.schema.nodes.codeBlock.spec.attrs ?? {})).toEqual(expect.arrayContaining(['language', 'filename', 'highlight']));
    for (const mark of ['textColor', 'textBg', 'fontSize', 'fontFamily', 'link', 'bold']) expect(ed.schema.marks[mark]).toBeDefined();
    for (const node of ['table', 'image', 'stickerImage', 'pollEmbed', 'contentEmbed']) expect(ed.schema.nodes[node]).toBeDefined();
    ed.destroy();
  });

  it('keeps the order constraints: tables before the @人 suggestion, the flow extension last', () => {
    const list = buildRichTextExtensions();
    const at = (name: string) => list.findIndex((e: AnyExtension) => e.name === name);
    const lastTable = Math.max(...TABLE_EXTENSIONS.map((t) => list.indexOf(t)));
    expect(lastTable).toBeGreaterThanOrEqual(0);
    expect(lastTable).toBeLessThan(at('mentionSuggestion'));
    expect(at('markdown')).toBeLessThan(list.length - 1);
    expect(list[list.length - 1]).toBe(FlowExtension);
    expect(buildRichTextExtensions({ flow: false }).includes(FlowExtension)).toBe(false);
  });

  it('registers the embed node / upload placeholders only when asked, and swaps views without renaming', () => {
    const plain = new Editor({ extensions: buildRichTextExtensions({ upload: {} }), content: '' });
    expect(plain.schema.nodes.contentEmbed).toBeUndefined();
    expect(plain.extensionManager.extensions.some((e) => e.name === 'zoneFileUpload')).toBe(false);
    plain.destroy();
    const list = buildRichTextExtensions({ views: { codeBlock: CodeBlockWithView } });
    expect(list.filter((e) => e.name === 'codeBlock')).toHaveLength(1);
  });

  it('a pristine formatted body with a code block, table and image opens with no update and nothing to undo', async () => {
    let updates = 0;
    const body = [
      '前文 <span data-color="red">**重点**</span> `code()`',
      '',
      '```py title="main.py"',
      'print(1)',
      '```',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '![pic](/api/uploads/images/a.png)',
    ].join('\n');
    const ed = new Editor({ extensions: buildRichTextExtensions({ embed: {}, codeHighlight: false }), content: body, onUpdate: () => (updates += 1) });
    await new Promise((r) => setTimeout(r, 0));
    expect(updates).toBe(0);
    expect(ed.can().undo()).toBe(false);
    expect(ed.storage.markdown.getMarkdown()).toBe(body);
    ed.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('toolbar shortcut hints', () => {
  it('formats per platform', () => {
    expect(formatShortcut('Mod-b', true)).toBe('⌘B');
    expect(formatShortcut('Mod-Shift-s', true)).toBe('⇧⌘S');
    expect(formatShortcut('Mod-Alt-c', true)).toBe('⌥⌘C');
    expect(formatShortcut('Mod-b', false)).toBe('Ctrl+B');
    expect(formatShortcut('Mod-Shift-8', false)).toBe('Ctrl+Shift+8');
    expect(formatShortcut('Mod-Alt-1', false)).toBe('Ctrl+Alt+1');
    expect(ariaKeyShortcuts('Mod-Shift-z', true)).toBe('Meta+Shift+Z');
    expect(ariaKeyShortcuts('Mod-e', false)).toBe('Control+E');
  });

  // A real keydown through ProseMirror's handler chain (jsdom is not a Mac, so
  // `Mod` is Ctrl) — the path a key press takes, dispatch included.
  const press = (ed: Editor, combo: string) => {
    const parts = combo.split('-');
    const key = parts.pop()!;
    ed.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        ctrlKey: parts.includes('Mod'),
        altKey: parts.includes('Alt'),
        shiftKey: parts.includes('Shift'),
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  const fresh = (content: string) => {
    const ed = new Editor({ extensions: buildRichTextExtensions({ codeHighlight: false }), content });
    ed.commands.setTextSelection({ from: 1, to: 6 });
    return ed;
  };

  it('every hint names a binding that really runs', () => {
    const marks: Array<[keyof typeof TOOLBAR_SHORTCUTS, string]> = [
      ['bold', 'bold'],
      ['italic', 'italic'],
      ['strike', 'strike'],
      ['code', 'code'],
    ];
    for (const [key, mark] of marks) {
      const ed = fresh('hello world');
      press(ed, TOOLBAR_SHORTCUTS[key]);
      expect([key, ed.isActive(mark)]).toEqual([key, true]);
      ed.destroy();
    }
    const blocks: Array<[keyof typeof TOOLBAR_SHORTCUTS, string, Record<string, unknown>?]> = [
      ['h1', 'heading', { level: 1 }],
      ['h2', 'heading', { level: 2 }],
      ['h3', 'heading', { level: 3 }],
      ['bulletList', 'bulletList'],
      ['orderedList', 'orderedList'],
      ['blockquote', 'blockquote'],
      ['codeBlock', 'codeBlock'],
    ];
    for (const [key, node, attrs] of blocks) {
      const ed = fresh('hello world');
      press(ed, TOOLBAR_SHORTCUTS[key]);
      const first = ed.state.doc.firstChild!;
      expect([key, first.type.name, attrs ? first.attrs.level : undefined]).toEqual([key, node, attrs?.level]);
      ed.destroy();
    }
    const ed = new Editor({ extensions: buildRichTextExtensions(), content: 'a' });
    ed.commands.focus('end');
    ed.commands.insertContent('bc');
    expect(ed.state.doc.textContent).toBe('abc');
    press(ed, TOOLBAR_SHORTCUTS.undo);
    expect(ed.state.doc.textContent).toBe('a');
    press(ed, TOOLBAR_SHORTCUTS.redo);
    expect(ed.state.doc.textContent).toBe('abc');
    ed.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RichTextEditor mounted', async () => {
  const { RichTextEditor } = await import('@/components/RichTextEditor');

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const missing: string[] = [];

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
    toasts.length = 0;
    vi.unstubAllGlobals();
  });

  function mount(props: { value: string; variant?: 'full' | 'compact'; maxLength?: number; onChange?: (md: string) => void }) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const editorRef: { current: Editor | null } = { current: null };
    function Harness() {
      const [value, setValue] = useState(props.value);
      return createElement(RichTextEditor, {
        value,
        onChange: (md: string) => {
          props.onChange?.(md);
          setValue(md);
        },
        variant: props.variant ?? 'full',
        maxLength: props.maxLength,
        editorRef: editorRef as never,
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
          children: createElement(Harness),
        }),
      );
    });
    mounted = { root, host };
    const editor = editorRef.current as Editor | null;
    if (!editor) throw new Error('editor not created');
    const button = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
    return { host, editor, button };
  }

  for (const variant of ['full', 'compact'] as const) {
    it(`${variant}: 文字样式 sits right after 行内代码, in the one-row scrolling toolbar`, () => {
      const { host, button } = mount({ value: 'hello', variant });
      const inline = button(ui.rte_inline_code)!;
      expect(inline).not.toBeNull();
      const next = inline.nextElementSibling as HTMLButtonElement;
      expect(next.getAttribute('aria-haspopup')).toBe('dialog');
      expect(next.getAttribute('aria-label')).toBe(ui.rte_text_style);
      const row = inline.parentElement!;
      expect(row.className).toContain('overflow-x-auto');
      expect(row.className).toContain('sm:flex-wrap');
      expect(row.className).toContain('[&>*]:shrink-0');
      expect(host.querySelector('input[type="file"]')?.getAttribute('accept')).not.toContain('image/*');
      expect(missing).toEqual([]);
    });
  }

  it('titles carry the platform shortcut; inline code and code block have different icons', () => {
    const { button } = mount({ value: 'hello' });
    const bold = button(ui.rte_bold)!;
    expect(bold.title).toBe(`${ui.rte_bold} (Ctrl+B)`);
    expect(bold.getAttribute('aria-keyshortcuts')).toBe('Control+B');
    expect(button(ui.rte_code_block)!.title).toBe(`${ui.rte_code_block} (Ctrl+Alt+C)`);
    expect(button(ui.rte_inline_code)!.querySelector('svg')!.getAttribute('class')).toContain('lucide-code');
    expect(button(ui.rte_code_block)!.querySelector('svg')!.getAttribute('class')).toContain('lucide-square-code');
  });

  it('bold / italic / strike are disabled inside inline code, enabled outside', () => {
    const { editor, button } = mount({ value: 'plain `code()` tail' });
    let codeAt = -1;
    editor.state.doc.descendants((n, pos) => {
      if (codeAt < 0 && n.isText && n.marks.some((m) => m.type.name === 'code')) codeAt = pos + 2;
      return true;
    });
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, codeAt, codeAt + 2)));
    });
    expect(button(ui.rte_bold)!.disabled).toBe(true);
    expect(button(ui.rte_italic)!.disabled).toBe(true);
    expect(button(ui.rte_strike)!.disabled).toBe(true);
    expect(button(ui.rte_inline_code)!.disabled).toBe(false); // it can always be turned off
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 4)));
    });
    expect(button(ui.rte_bold)!.disabled).toBe(false);
  });

  it('inline-mark buttons and 文字样式 are disabled at a caret inside a code block', () => {
    const { editor, button, host } = mount({ value: 'para\n\n```\ncode here\n```' });
    let at = -1;
    editor.state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'codeBlock') at = pos + 3;
      return true;
    });
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    });
    for (const label of [ui.rte_bold, ui.rte_italic, ui.rte_strike, ui.rte_inline_code, ui.rte_link]) expect([label, button(label)!.disabled]).toEqual([label, true]);
    expect((host.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    });
    expect(button(ui.rte_bold)!.disabled).toBe(false);
    expect((host.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a fenced code block renders the framed node view with its language picker and filename', async () => {
    const { host } = mount({ value: '```py title="main.py"\nprint(1)\n```' });
    // React node views mount through EditorContent's portal renderer on the next commit.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const frame = host.querySelector('[data-code-block]');
    expect(frame).not.toBeNull();
    expect((frame!.querySelector('select') as HTMLSelectElement).value).toBe('py');
    expect((frame!.querySelector('input') as HTMLInputElement).value).toBe('main.py');
  });

  it('the counter counts visible text, not the formatting markup', () => {
    const value = '<span data-color="red">hello</span>';
    const { host } = mount({ value, variant: 'compact', maxLength: 10 });
    const counter = Array.from(host.querySelectorAll('span')).find((s) => /\d+ \/ 10/.test(s.textContent ?? ''))!;
    expect(counter.textContent).toBe('5 / 10');
    expect(counter.className).not.toContain('text-danger');
  });

  it('a non-image file dropped on a comment box is refused out loud (and never opened by the browser)', () => {
    const { editor } = mount({ value: 'x', variant: 'compact' });
    const view = editor.view;
    view.posAtCoords = () => null;
    const event = new Event('drop', { cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['print(1)'], 'batch.py', { type: 'text/x-python-script' })], types: ['Files'] } });
    let handled = false;
    act(() => {
      handled = Boolean(view.someProp('handleDrop', (f) => f(view, event, Slice.empty, false)));
    });
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain('batch.py');
  });

  it('a pasted image whose upload fails toasts the reason; a successful one lands as an image', async () => {
    const { editor } = mount({ value: 'x', variant: 'compact' });
    const view = editor.view;
    const pasteFile = (file: File) => {
      const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { files: [file], types: ['Files'], getData: () => '' } });
      act(() => {
        view.someProp('handlePaste', (f) => f(view, event, Slice.empty));
      });
    };

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'unsupported_type' }), { status: 415 }));
    vi.stubGlobal('fetch', fetchMock);
    pasteFile(new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: '' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The declared type comes from the extension when the OS reported none.
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
    expect(toasts.map((t) => t.kind)).toEqual(['error']);
    expect(toasts[0].message).toContain('shot.png');
    expect(toasts[0].message).toContain(messages.zones.attach_err_unsupported_type);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: '/api/uploads/images/ok.png' }), { status: 200 })));
    pasteFile(new File([new Uint8Array([1])], 'ok.png', { type: 'image/png' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const types: string[] = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).toContain('image');
    expect(editor.storage.markdown.getMarkdown()).toContain('![ok](/api/uploads/images/ok.png)');
    expect(toasts).toHaveLength(1);
  });

  // ED-14: the table strip mounted on caret entry, pushing the document down by
  // its height on mousedown in a cell (the cell under the pointer jumped away).
  it('the table strip keeps its box while the caret moves in and out of the table', () => {
    const { host, editor } = mount({ value: 'intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter' });
    const strip = () => host.querySelector('.rte-table-strip') as HTMLElement | null;
    expect(strip()).not.toBeNull(); // the doc holds a table: reserved, even with the caret outside
    const outside = strip()!;
    expect(outside.className).toContain('invisible');
    expect(outside.hasAttribute('inert')).toBe(true);
    expect(outside.getAttribute('aria-hidden')).toBe('true');

    let cell = -1;
    editor.state.doc.descendants((n, pos) => {
      if (cell < 0 && n.type.name === 'tableCell') cell = pos + 2;
      return true;
    });
    act(() => {
      editor.commands.setTextSelection(cell);
    });
    expect(strip()).toBe(outside); // the SAME element — nothing mounted above the document
    expect(strip()!.className).not.toContain('invisible');
    expect(strip()!.hasAttribute('inert')).toBe(false);
  });

  it('no table in the document ⇒ no table strip', () => {
    const { host } = mount({ value: 'no table here' });
    expect(host.querySelector('.rte-table-strip')).toBeNull();
  });

  // ED-17: two whole-document serializations per keystroke (onUpdate + the echo
  // check in the controlled sync); long documents paid it on every key.
  it('a keystroke in a short body serializes once and emits at once', () => {
    const emitted: string[] = [];
    const { editor } = mount({ value: 'hello', variant: 'compact', onChange: (md) => emitted.push(md) });
    const original = editor.storage.markdown.getMarkdown.bind(editor.storage.markdown);
    let calls = 0;
    editor.storage.markdown.getMarkdown = () => {
      calls += 1;
      return original();
    };
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!');
    });
    expect(emitted).toEqual(['hello!']);
    expect(calls).toBe(1);
  });

  it('a long body emits after a pause, once, and flushes on blur', async () => {
    vi.useFakeTimers();
    try {
      const emitted: string[] = [];
      const long = Array.from({ length: 400 }, (_, i) => `paragraph ${i} ${'x'.repeat(60)}`).join('\n\n');
      const { editor } = mount({ value: long, onChange: (md) => emitted.push(md) });
      act(() => {
        editor.commands.insertContentAt(1, 'A');
        editor.commands.insertContentAt(1, 'B');
      });
      expect(emitted).toEqual([]);
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(emitted).toHaveLength(1);
      expect(emitted[0].startsWith('BAparagraph 0')).toBe(true);

      act(() => {
        editor.commands.insertContentAt(1, 'C');
      });
      expect(emitted).toHaveLength(1);
      act(() => {
        editor.view.dom.dispatchEvent(new FocusEvent('blur'));
      });
      expect(emitted).toHaveLength(2);
      expect(emitted[1].startsWith('CBAparagraph 0')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // ED-20: a README body's linked badges / task lists / footnotes / <details>
  // were dropped by the first save without a word.
  it('says which parts of a loaded body it cannot keep, and the notice can be dismissed', () => {
    const { host } = mount({ value: '[![ci](/badge.svg)](https://ci.example.com)\n\n- [ ] todo\n\n<details>x</details>' });
    const notice = host.querySelector('[role="status"]');
    expect(notice?.textContent).toContain(ui.rte_unsupported_linked_image);
    expect(notice?.textContent).toContain(ui.rte_unsupported_task_list);
    expect(notice?.textContent).toContain(ui.rte_unsupported_html);
    const dismiss = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === ui.rte_unsupported_dismiss)!;
    act(() => {
      dismiss.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(Array.from(host.querySelectorAll('[role="status"]')).some((n) => n.textContent?.includes(ui.rte_unsupported_task_list))).toBe(false);
  });

  it('a body the editor fully keeps shows no notice', () => {
    const { host } = mount({ value: 'plain **bold** and a <span data-color="red">red</span> word' });
    expect(Array.from(host.querySelectorAll('[role="status"]')).some((n) => n.textContent?.includes(ui.rte_unsupported_dismiss))).toBe(false);
  });

  // ED-32: the counter scanned the body twice on EVERY render, caret moves included.
  it('the counter does not rescan the body on a selection-only change', () => {
    const { editor } = mount({ value: 'a <span data-color="red">red</span> word', variant: 'compact', maxLength: 100 });
    const before = scans.richTextLength;
    act(() => {
      for (let i = 1; i < 6; i += 1) editor.commands.setTextSelection(i);
    });
    expect(scans.richTextLength).toBe(before);
  });
});
