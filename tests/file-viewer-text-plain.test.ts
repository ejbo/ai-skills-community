// @vitest-environment jsdom
//
// Owner scenario: 「附件……能预览的预览」 — a .txt / .log / LICENSE attachment
// opens as plain text. It did not: FileViewer handed CodeBlock `language: null`
// for a `text` plan, CodeBlock then ran highlight.js `highlightAuto` over up to
// 20 000 characters, and three ordinary server-log lines came back as VB.NET
// (relevance exactly 5, the acceptance threshold) — coloured keywords and a
// "VB.NET" label on a log file, plus every grammar run on the main thread.
//
// Pure helpers could not catch that (the misdetection happens in the component
// pair), so this mounts the real FileViewer, text branch, with the bytes served
// by a stubbed fetch, and waits for highlight.js to have had every chance to
// paint. A `.py` attachment is the positive control: it MUST be coloured, which
// proves the lazy highlight.js import actually ran in this environment and the
// plain cases are plain on merit.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement, lazy, Suspense, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// next/dynamic's loadable wrapper does not settle under jsdom + act; a plain
// React.lazy boundary is the same contract (load on first render, no SSR).
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
    const Lazy = lazy(() => loader().then((C) => ({ default: C })));
    return (props: Record<string, unknown>) => createElement(Suspense, { fallback: null }, createElement(Lazy, props));
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const messages = JSON.parse(readFileSync(resolve(__dirname, '../messages/zh-CN.json'), 'utf8'));

const LOG =
  '2026-09-14 10:00:01 INFO server started on port 3000\n' +
  '2026-09-14 10:00:02 WARN cache miss for key user:42\n' +
  '2026-09-14 10:00:03 ERROR failed to connect to db (timeout=5s)\n';

const LICENSE = `MIT License

Copyright (c) 2026 AI Community

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
`;

const PY = 'import os\n\ndef main(argv):\n    return len(argv)  # count\n\nif __name__ == "__main__":\n    main(os.sys.argv)\n';

let served = '';

beforeAll(() => {
  globalThis.fetch = vi.fn(async () => {
    const body = new TextEncoder().encode(served);
    return new Response(body, {
      status: 206,
      headers: { 'content-range': `bytes 0-${Math.max(0, body.byteLength - 1)}/${body.byteLength}`, 'content-type': 'application/octet-stream' },
    });
  }) as typeof fetch;
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

async function flush(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function view(name: string, storageKey: string, text: string, opts: { untilTokens?: boolean } = {}) {
  served = text;
  const { FileViewer } = await import('@/components/files/FileViewer');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      createElement(NextIntlClientProvider, {
        locale: 'zh-CN',
        messages,
        children: createElement(FileViewer, { url: `/api/zones/media/${storageKey}`, name, storageKey, sizeBytes: text.length }),
      }),
    );
  });
  for (let i = 0; i < 200 && !host.querySelector('code'); i++) await flush();
  expect(host.querySelector('code'), `${name}: the text branch never rendered`).not.toBeNull();
  if (opts.untilTokens) {
    // The control pays for the cold transform of highlight.js/lib/common.
    for (let i = 0; i < 400 && !host.querySelector('code [class*="hljs-"]'); i++) await flush(25);
  } else {
    // Give the highlighter every chance: the .py control already paid for its
    // lazy import, so a highlight, if one is coming, lands within a few macrotasks.
    for (let i = 0; i < 20; i++) await flush();
  }
  const code = host.querySelector('code')!;
  return {
    tokens: host.querySelectorAll('code [class*="hljs-"]').length,
    codeClass: code.className,
    text: code.textContent ?? '',
  };
}

describe('FileViewer — text attachments stay plain text', { timeout: 60_000 }, () => {
  it('positive control: a .py attachment is highlighted', async () => {
    const r = await view('batcher.py', 'file/abcdefghijklmnop.py', PY, { untilTokens: true });
    expect(r.tokens).toBeGreaterThan(0);
    expect(r.codeClass).toContain('language-python');
  });

  for (const [name, key, text] of [
    ['app.log', 'file/abcdefghijklmnoq.log', LOG],
    ['notes.txt', 'file/abcdefghijklmnor.txt', LOG],
    ['LICENSE', 'file/abcdefghijklmnos.bin', LICENSE],
  ] as const) {
    it(`${name}: no highlight.js tokens and no guessed language`, async () => {
      const r = await view(name, key, text);
      expect(r.text).toContain(text.split('\n')[0]);
      expect(r.tokens).toBe(0);
      // `hljs` alone (the frame's base class) or an explicit plain language —
      // never a guessed grammar such as language-vbnet.
      const langs = r.codeClass.split(/\s+/).filter((c) => c.startsWith('language-'));
      expect(langs.every((c) => /^language-(plaintext|text|txt|plain)$/.test(c)), r.codeClass).toBe(true);
    });
  }
});
