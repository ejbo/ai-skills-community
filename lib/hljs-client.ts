// highlight.js for client code that highlights by itself — the attachment
// preview (components/code/CodeBlock.tsx) and the editor's code-block
// decorations (components/editor/code-block-extension.ts). Both import THIS
// module lazily (`import('@/lib/hljs-client')`), never `highlight.js/lib/common`.
//
// WHY not `highlight.js/lib/common`: through the package's exports map the ESM
// `lib/common` is `es/common.js`, which merely re-exports the CommonJS
// `lib/common.js` — and that one `require`s the CommonJS `lib/languages/*`.
// rehype-highlight (MarkdownRenderer, statically bundled on every page that
// renders a body or a comment) gets its grammars from lowlight, which imports
// `highlight.js/lib/languages/*` = the ESM `es/languages/*`. Same grammars,
// different files, so the bundler cannot share them: the lazy chunk re-shipped
// ~140 KB minified (~41 KB gzip) of grammars the page had already downloaded.
//
// This module imports the very specifiers lowlight imports (`highlight.js/lib/core`
// resolves to `es/core.js`, which re-exports the one `lib/core.js`; the grammar
// list below is lowlight@3's `common`), so on a page that already renders
// markdown the lazy chunk is just this file. tests/code-block-preview.test.ts pins the
// list against the lowlight that rehype-highlight actually resolves.
//
// `lowlight` itself is not imported: it is not a direct dependency (pnpm's
// strict layout would not resolve it from here), and a dynamic import of it
// would also keep its `all` export (~190 grammars) alive.

import type { HLJSApi, LanguageFn } from 'highlight.js';
import core from 'highlight.js/lib/core';
import arduino from 'highlight.js/lib/languages/arduino';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import objectivec from 'highlight.js/lib/languages/objectivec';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import phpTemplate from 'highlight.js/lib/languages/php-template';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import pythonRepl from 'highlight.js/lib/languages/python-repl';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import vbnet from 'highlight.js/lib/languages/vbnet';
import wasm from 'highlight.js/lib/languages/wasm';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

export type Hljs = HLJSApi;

/** lowlight@3 `common`, key for key (the key is the registered language name). */
export const HLJS_COMMON_GRAMMARS: Readonly<Record<string, LanguageFn>> = {
  arduino,
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  objectivec,
  perl,
  php,
  'php-template': phpTemplate,
  plaintext,
  python,
  'python-repl': pythonRepl,
  r,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  vbnet,
  wasm,
  xml,
  yaml,
};

let instance: Hljs | null = null;

/**
 * One shared instance with the common grammars registered. `newInstance()`
 * rather than the `core` default: that default is the same singleton the
 * CommonJS `highlight.js/lib/common` registers into (components/CodeViewer.tsx),
 * and this module should neither depend on nor mutate it.
 */
export function getHljs(): Hljs {
  if (!instance) {
    const hljs = core.newInstance();
    for (const [name, grammar] of Object.entries(HLJS_COMMON_GRAMMARS)) hljs.registerLanguage(name, grammar);
    instance = hljs;
  }
  return instance;
}
