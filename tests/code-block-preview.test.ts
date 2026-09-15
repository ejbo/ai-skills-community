// @vitest-environment jsdom
// CodeBlock (the attachment preview's code frame):
//   ED-16 — a block without a language is PLAIN TEXT. It used to run
//     hljs.highlightAuto on anything up to 20 KB: a LICENSE came out as SQL, a log
//     as bash, and the whole guess ran synchronously on the main thread.
//   ED-15 — highlight.js is loaded through lib/hljs-client, whose grammar modules
//     are the ones rehype-highlight (lowlight) already bundles, instead of
//     `highlight.js/lib/common` (the CommonJS copies — a second ~140 KB download).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { CodeBlock } from '@/components/code/CodeBlock';
import { getHljs, HLJS_COMMON_GRAMMARS } from '@/lib/hljs-client';

const MESSAGES = { ui: { code_copy: 'Copy code', code_copied: 'Copied', code_copy_failed: 'Copy failed', code_plain_text: 'Plain text' } };

const MIT = `MIT License

Copyright (c) 2024 Example Corp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const LOG = Array.from({ length: 200 }, (_, i) => `2026-09-14 10:${String(i % 60).padStart(2, '0')}:00 INFO [worker-${i % 4}] export PATH=$HOME/bin; echo "job ${i} done" && exit 0`).join('\n');

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(blocks: Array<{ id: string; code: string; language?: string | null }>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages: MESSAGES,
        children: blocks.map((b) => createElement('div', { key: b.id, id: b.id }, createElement(CodeBlock, { code: b.code, language: b.language }))),
      }),
    );
  });
  return host;
}

const tokens = (el: Element | null) => el?.querySelectorAll('[class^="hljs-"], [class*=" hljs-"]').length ?? 0;

describe('CodeBlock never guesses a language (ED-16)', () => {
  it('leaves a LICENSE and a log plain while a known language is highlighted beside them', async () => {
    const el = await mount([
      { id: 'py', code: 'import os\ndef f(x):\n    return "s" + str(x)\n', language: 'python' },
      { id: 'license', code: MIT, language: null },
      { id: 'log', code: LOG },
      { id: 'txt', code: MIT, language: 'plaintext' },
    ]);
    // The positive control: once python is coloured, the lazy highlighter has
    // loaded and every effect that was going to highlight has done so.
    for (let i = 0; i < 200 && tokens(el.querySelector('#py')) === 0; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(tokens(el.querySelector('#py'))).toBeGreaterThan(0);
    for (const id of ['license', 'log', 'txt']) {
      const block = el.querySelector(`#${id}`)!;
      expect(tokens(block), id).toBe(0);
      expect(block.querySelector('code')?.className, id).not.toMatch(/language-(?!plaintext)/);
    }
    // Still the full frame: numbered rows, exact text.
    const license = el.querySelector('#license code')!;
    expect(license.querySelectorAll('.code-line').length).toBe(MIT.split('\n').length - 1);
    expect(license.textContent).toBe(MIT);
  });
});

describe('lib/hljs-client (ED-15)', () => {
  it('registers exactly the grammar MODULES rehype-highlight bundles, not copies', async () => {
    // lowlight is rehype-highlight's dependency, not ours — resolve it the way the bundler does.
    const req = createRequire(import.meta.url);
    const rehypeHighlight = req.resolve('rehype-highlight');
    const lowlightPath = createRequire(rehypeHighlight).resolve('lowlight');
    const lowlight = (await import(/* @vite-ignore */ pathToFileURL(lowlightPath).href)) as { common: Record<string, unknown> };
    expect(Object.keys(HLJS_COMMON_GRAMMARS).sort()).toEqual(Object.keys(lowlight.common).sort());
    for (const [name, grammar] of Object.entries(HLJS_COMMON_GRAMMARS)) {
      expect(grammar, name).toBe(lowlight.common[name]);
    }
  });

  it('one shared instance with those grammars (aliases included)', () => {
    const hljs = getHljs();
    expect(getHljs()).toBe(hljs);
    for (const name of Object.keys(HLJS_COMMON_GRAMMARS)) expect(hljs.getLanguage(name), name).toBeTruthy();
    expect(hljs.getLanguage('py')).toBeTruthy();
    expect(hljs.highlight('const a = 1', { language: 'ts' }).value).toContain('hljs-keyword');
  });

  it('no client highlighter imports highlight.js/lib/common any more', () => {
    for (const file of ['components/code/CodeBlock.tsx', 'components/editor/code-block-extension.ts']) {
      const src = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(src, file).not.toMatch(/['"]highlight\.js\/lib\/common['"]/);
      expect(src, file).toMatch(/import\(\s*['"]@\/lib\/hljs-client['"]\s*\)/);
    }
  });
});
