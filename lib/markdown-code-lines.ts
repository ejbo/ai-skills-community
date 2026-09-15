// 代码块 — the pure half of the Aceternity-style code frame (components/code/*).
//
// Three consumers share this module, so it imports NOTHING at runtime (no hast
// utilities, no highlight.js): it runs inside the server render of
// MarkdownRenderer, inside the client CodeBlock (attachment preview) and inside
// the editor's code-block extension.
//
//   1. `splitCodeLines` — THE line splitter. Highlighted code is a tree
//      (`<span class="hljs-string">"""doc\nstring"""</span>`), and a token can
//      span several lines. Wrapping each line in its own element means closing
//      every open token at the newline and RE-OPENING the same chain on the next
//      line; otherwise the second half of a multi-line string loses its colour
//      (or, with naive string splitting, the markup is simply broken). It works
//      over a tiny generic tree so the hast adapter (reader) and the hljs-HTML
//      adapter (CodeBlock) are two thin shims around one tested algorithm.
//   2. `parseCodeMeta` — the fence meta contract: ```py title="main.py" {1,3-5}
//      (also filename=…, file=…, or a bare `main.py`). Shared with the editor,
//      which must write back exactly what this reads.
//   3. `remarkCodeMeta` + `rehypeCodeLines` — the markdown pipeline plugins.
//
// WHY the meta rides a side channel instead of an attribute: mdast-util-to-hast
// puts the fence meta on `code.data.meta`, and rehype-raw (hast-util-raw)
// rebuilds every node through parse5 and drops `data`. Positions DO survive
// raw and sanitize, so `remarkCodeMeta` records meta by the fence's source
// offset in `file.data`, and `rehypeCodeLines` — which runs AFTER
// rehype-sanitize — looks it up by the code element's start offset. No
// sanitize-schema change is needed, and nothing a user writes as raw HTML can
// forge it (sanitize strips data-* on pre/code before this plugin runs, and the
// plugin rebuilds those attributes from scratch).
//
// Everything this plugin emits is generated here from validated values, which is
// why it may run after the trust boundary: class `code-line`, numeric
// data-line, a boolean data-highlighted, and on <pre> a language token matching
// CODE_LANGUAGE_RE, a filename without control characters, a line count.

// ---------------------------------------------------------------------------
// 1. The line splitter
// ---------------------------------------------------------------------------

/** A minimal tree the splitter understands; `el` is whatever the adapter needs to rebuild the element. */
export type LineNode<E> =
  | { type: 'text'; value: string }
  | { type: 'element'; el: E; children: LineNode<E>[] };

export interface SplitLines<E> {
  /** One entry per rendered line; each line carries its own copy of the open ancestor chain. */
  lines: LineNode<E>[][];
  /**
   * The source ended with a line break. The final (empty) line is dropped from
   * `lines` — a code fence always ends in `\n` and nobody wants a blank
   * numbered line under every block — so renderers use this to put the break
   * back and keep `textContent` byte-identical to the source.
   */
  endsWithNewline: boolean;
}

function textLength<E>(nodes: LineNode<E>[]): number {
  let n = 0;
  for (const node of nodes) n += node.type === 'text' ? node.value.length : textLength(node.children);
  return n;
}

/** Drop elements that ended up with no text (a token that started with a newline leaves an empty clone behind). */
function prune<E>(nodes: LineNode<E>[]): LineNode<E>[] {
  const out: LineNode<E>[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value) out.push(node);
      continue;
    }
    const children = prune(node.children);
    if (children.length > 0) out.push({ type: 'element', el: node.el, children });
  }
  return out;
}

/**
 * Split a (possibly highlighted) code tree into lines. `\n`, `\r\n` and a lone
 * `\r` are all line breaks — including a `\r\n` pair that a token boundary cut
 * in two. The break characters themselves are not kept in the lines.
 */
export function splitCodeLines<E>(nodes: readonly LineNode<E>[]): SplitLines<E> {
  const lines: LineNode<E>[][] = [];
  let line: LineNode<E>[] = [];
  // Open ancestors of the current position; `into` is that ancestor's clone in
  // the CURRENT line, re-pointed on every break.
  const stack: { el: E; into: LineNode<E>[] }[] = [];
  let pendingCR = false;

  const container = (): LineNode<E>[] => (stack.length > 0 ? stack[stack.length - 1].into : line);
  const pushText = (value: string) => {
    if (value) container().push({ type: 'text', value });
  };
  const breakLine = () => {
    lines.push(line);
    line = [];
    let parent = line;
    for (const entry of stack) {
      const clone: LineNode<E> = { type: 'element', el: entry.el, children: [] };
      parent.push(clone);
      entry.into = clone.children;
      parent = clone.children;
    }
  };

  const walk = (list: readonly LineNode<E>[]) => {
    for (const node of list) {
      if (node.type === 'element') {
        const clone: LineNode<E> = { type: 'element', el: node.el, children: [] };
        container().push(clone);
        stack.push({ el: node.el, into: clone.children });
        walk(node.children);
        stack.pop();
        continue;
      }
      let value = node.value;
      if (pendingCR && value.length > 0) {
        pendingCR = false;
        if (value.charCodeAt(0) === 10) value = value.slice(1); // the \n half of a split \r\n
      }
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c !== 10 && c !== 13) continue;
        pushText(value.slice(start, i));
        if (c === 13) {
          if (i + 1 < value.length) {
            if (value.charCodeAt(i + 1) === 10) i++;
          } else {
            pendingCR = true;
          }
        }
        breakLine();
        start = i + 1;
      }
      pushText(value.slice(start));
    }
  };

  walk(nodes);
  lines.push(line);

  const pruned = lines.map((l) => prune(l));
  let endsWithNewline = false;
  // With more than one line, the last can only be text-free when the source ended in a break.
  if (pruned.length > 1 && textLength(pruned[pruned.length - 1]) === 0) {
    pruned.pop();
    endsWithNewline = true;
  }
  return { lines: pruned, endsWithNewline };
}

// ---------------------------------------------------------------------------
// 1b. The splitting budget
// ---------------------------------------------------------------------------
//
// WHY: `splitCodeLines` re-opens every open ancestor on every line, so its work
// — and the markup it emits — grows with (line breaks) × (open element depth),
// NOT with the size of the input. highlight.js output is shallow, but a stored
// body can carry raw HTML: rehype-raw keeps nesting as written and sanitize
// allows `<b>`/`<em>`/`<span>`, so `<pre>` + 230 × `<b>` + 3000 lines — 7.6 KB,
// under the discussion-post cap — became 690 000 `<b>` clones and ~5 MB of HTML
// on EVERY server render of the feed (one process serves the whole site; the
// render is force-dynamic and the post sits in the feed). A block over the
// budget is NOT split: it keeps the tree sanitize produced (O(input)) inside
// the same frame and simply has no numbered rows.
//
// Every adapter must measure before it splits (`rehypeCodeLines`,
// `renderCodeLinesHtml`). The measurement is iterative, so no nesting depth can
// overflow the stack in it; the recursive splitter only ever runs on trees
// whose depth is within CODE_LINES_MAX_DEPTH.

/**
 * Nodes one markdown body may spend on line splitting, summed over all its code
 * blocks: one row per line plus one clone per ancestor re-opened at a break.
 * Real code is ~1 node per line (a highlighted file rarely breaks inside a
 * token), so this is ~20 000 numbered lines per body — a pathological nesting
 * exhausts it long before it can amplify anything.
 */
export const CODE_LINES_MAX_NODES = 20_000;
/** Deeper than this inside one `<code>` is never highlighter output; the block is shown unsplit. */
export const CODE_LINES_MAX_DEPTH = 32;

export interface CodeLineCost {
  /** Rendered line count (the final empty line after a trailing break is not counted). */
  lines: number;
  /**
   * What splitting ADDS on top of copying the input: one row per line plus one
   * clone per ancestor re-opened at a break. Only this part can amplify.
   */
  nodes: number;
  /** Deepest element nesting under the code root. */
  depth: number;
}

/**
 * Measure what `splitCodeLines` would cost, in O(input) and without recursion.
 * Line breaks are counted exactly like the splitter counts them (`\r\n` is one
 * break even when a token boundary cuts it in two).
 */
export function measureCodeLines<N>(
  roots: readonly N[],
  textOf: (node: N) => string | null,
  childrenOf: (node: N) => readonly N[] | null,
): CodeLineCost {
  let breaks = 0;
  let nodes = 0;
  let depth = 0;
  let pendingCR = false;
  let trailingBreak = false;
  const stack: { list: readonly N[]; i: number }[] = [{ list: roots, i: 0 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top.i >= top.list.length) {
      stack.pop();
      continue;
    }
    const node = top.list[top.i++];
    const open = stack.length - 1; // elements open around this node
    const text = textOf(node);
    if (text !== null) {
      if (!text) continue;
      let i = 0;
      if (pendingCR) {
        pendingCR = false;
        if (text.charCodeAt(0) === 10) i = 1;
      }
      for (; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c !== 10 && c !== 13) {
          trailingBreak = false;
          continue;
        }
        if (c === 13) {
          if (i + 1 < text.length) {
            if (text.charCodeAt(i + 1) === 10) i++;
          } else {
            pendingCR = true;
          }
        }
        breaks++;
        trailingBreak = true;
        nodes += 1 + open;
      }
      continue;
    }
    const children = childrenOf(node);
    if (children) {
      if (open + 1 > depth) depth = open + 1;
      stack.push({ list: children, i: 0 });
    }
  }
  // Mirrors splitCodeLines: a source ending in a break drops its empty last line.
  return { lines: breaks > 0 && trailingBreak ? breaks : breaks + 1, nodes: nodes + 1, depth };
}

/** True when a measured block may be split within `maxNodes`. */
export function codeLinesFit(cost: CodeLineCost, maxNodes: number): boolean {
  return cost.depth <= CODE_LINES_MAX_DEPTH && cost.nodes <= maxNodes;
}

const lineNodeText = <E>(n: LineNode<E>): string | null => (n.type === 'text' ? n.value : null);
const lineNodeChildren = <E>(n: LineNode<E>): readonly LineNode<E>[] | null => (n.type === 'element' ? n.children : null);

// ---------------------------------------------------------------------------
// 2. Fence meta
// ---------------------------------------------------------------------------

/** A language token as it may appear in `language-*` / a fence info string. */
export const CODE_LANGUAGE_RE = /^[\w#+.-]{1,40}$/;
export const CODE_FILENAME_MAX = 120;
/** Upper bound on highlighted lines one fence may ask for (`{1-100000}` must not allocate a huge set). */
export const CODE_HIGHLIGHT_MAX_LINES = 1000;
const CODE_HIGHLIGHT_MAX_LINE_NO = 100_000;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
// `py main.py` — a bare token that looks like a file name (has an extension, not a version number).
const BARE_FILE_RE = /^(?![\d.]+$)[\w@+-][\w@+./-]*\.[A-Za-z0-9]{1,10}$/;

export interface CodeMeta {
  filename: string | null;
  /** Sorted, unique, 1-based. */
  highlight: number[];
}

/** Validate a filename read from stored content: trimmed, ≤ CODE_FILENAME_MAX, no control characters — else null. */
export function cleanCodeFilename(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const v = name.trim();
  if (!v || v.length > CODE_FILENAME_MAX || CONTROL_RE.test(v)) return null;
  return v;
}

/**
 * Normalize what a person TYPES as a filename in the editor: control characters
 * and the two characters a fence info string cannot carry (a backtick ends a
 * backtick fence's info string; a double quote would end `title="…"`) are
 * removed, and the value is capped rather than rejected mid-typing.
 */
export function normalizeCodeFilenameInput(name: string): string {
  return name.replace(new RegExp(CONTROL_RE.source, 'g'), '').replace(/[`"]/g, '').slice(0, CODE_FILENAME_MAX);
}

/** Normalize a language token; anything outside CODE_LANGUAGE_RE is dropped. */
export function cleanCodeLanguage(lang: string | null | undefined): string | null {
  if (typeof lang !== 'string') return null;
  const v = lang.trim();
  return CODE_LANGUAGE_RE.test(v) ? v : null;
}

function parseHighlight(src: string): number[] {
  const m = /\{([^{}]*)\}/.exec(src);
  if (!m) return [];
  const set = new Set<number>();
  for (const raw of m[1].split(',')) {
    if (set.size >= CODE_HIGHLIGHT_MAX_LINES) break;
    const item = raw.trim();
    let a: number;
    let b: number;
    const single = /^(\d{1,6})$/.exec(item);
    const range = /^(\d{1,6})\s*-\s*(\d{1,6})$/.exec(item);
    if (single) a = b = Number(single[1]);
    else if (range) {
      a = Number(range[1]);
      b = Number(range[2]);
    } else continue;
    if (a < 1 || b < a || b > CODE_HIGHLIGHT_MAX_LINE_NO) continue;
    for (let n = a; n <= b && set.size < CODE_HIGHLIGHT_MAX_LINES; n++) set.add(n);
  }
  return [...set].sort((x, y) => x - y);
}

/**
 * Parse a fence meta string (everything after the language).
 * Accepts `title="…"`, `title='…'`, `filename=…`, `file=…` (quoted or bare) and a
 * bare `main.py`; highlight ranges as `{1,3-5}`. Junk is ignored, never thrown.
 */
export function parseCodeMeta(meta: string | null | undefined): CodeMeta {
  if (typeof meta !== 'string' || !meta.trim()) return { filename: null, highlight: [] };
  const src = meta.slice(0, 2000);
  let filename: string | null = null;
  const kv = /(?:^|\s)(?:title|filename|file)=(?:"([^"]*)"|'([^']*)'|([^\s{}"']+))/i.exec(src);
  if (kv) {
    filename = kv[1] ?? kv[2] ?? kv[3] ?? null;
  } else {
    for (const tok of src.split(/\s+/)) {
      if (BARE_FILE_RE.test(tok)) {
        filename = tok;
        break;
      }
    }
  }
  return { filename: cleanCodeFilename(filename), highlight: parseHighlight(src) };
}

/** `[1,3,4,5]` → `"1,3-5"` (the form `parseCodeMeta` reads back). */
export function formatHighlightRanges(lines: readonly number[]): string {
  const sorted = [...new Set(lines.filter((n) => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(',');
}

/** Languages meaning "no highlighting" — rendered as plain text. */
export const PLAIN_CODE_LANGUAGES: ReadonlySet<string> = new Set(['text', 'plaintext', 'txt', 'plain', 'nohighlight', 'no-highlight']);

/**
 * Build a fence info string for a code block. A filename or highlight range
 * needs a language in front of it — markdown-it and remark both read the FIRST
 * word as the language, so ```` ``` title="a" ```` would store `title="a"` as
 * the language — hence `text` as the stand-in.
 */
export function buildFenceInfo(attrs: { language?: string | null; filename?: string | null; highlight?: string | null }): string {
  const language = cleanCodeLanguage(attrs.language);
  const filename = attrs.filename ? normalizeCodeFilenameInput(attrs.filename).trim() : '';
  const highlight = attrs.highlight ? formatHighlightRanges(parseHighlight(`{${attrs.highlight}}`)) : '';
  const extras = `${filename ? ` title="${filename}"` : ''}${highlight ? ` {${highlight}}` : ''}`;
  if (!language && !extras) return '';
  return `${language ?? 'text'}${extras}`;
}

/** A backtick fence longer than any backtick run inside the code, so the code can never close it early. */
export function codeFenceFor(code: string): string {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

// ---------------------------------------------------------------------------
// Language labels + the editor's picker list
// ---------------------------------------------------------------------------

/** The editor's language picker (value = what is written into the fence). Names are proper nouns, not UI copy. */
export const CODE_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'diff', label: 'Diff' },
  { value: 'go', label: 'Go' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'html', label: 'HTML' },
  { value: 'ini', label: 'INI / TOML' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'lua', label: 'Lua' },
  { value: 'makefile', label: 'Makefile' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'scss', label: 'SCSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'swift', label: 'Swift' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
];

const LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'Bash', shell: 'Shell', zsh: 'Zsh', console: 'Shell', 'c++': 'C++', cc: 'C++', hpp: 'C++', h: 'C',
  cs: 'C#', 'c#': 'C#', golang: 'Go', gql: 'GraphQL', htm: 'HTML', toml: 'TOML', js: 'JavaScript',
  jsx: 'JSX', mjs: 'JavaScript', cjs: 'JavaScript', kt: 'Kotlin', kts: 'Kotlin', mk: 'Makefile',
  md: 'Markdown', py: 'Python', rb: 'Ruby', rs: 'Rust', ts: 'TypeScript', tsx: 'TSX', yml: 'YAML',
  dockerfile: 'Dockerfile', docker: 'Dockerfile', objc: 'Objective-C', objectivec: 'Objective-C',
  perl: 'Perl', pl: 'Perl', less: 'Less', wasm: 'WebAssembly', vb: 'VB.NET', vbnet: 'VB.NET',
  proto: 'Protobuf', protobuf: 'Protobuf', scala: 'Scala', dart: 'Dart', vue: 'Vue', svelte: 'Svelte',
  powershell: 'PowerShell', ps1: 'PowerShell', patch: 'Diff', svg: 'SVG', jsonc: 'JSON', json5: 'JSON5',
};
const LABEL_BY_VALUE = new Map(CODE_LANGUAGES.map((l) => [l.value, l.label]));

/**
 * Display label for a language token: `py` → Python. Plain-text tokens return
 * null (the caller shows its translated "plain text" label); unknown tokens are
 * returned as written.
 */
export function codeLanguageLabel(lang: string | null | undefined): string | null {
  const v = cleanCodeLanguage(lang);
  if (!v) return null;
  const key = v.toLowerCase();
  if (PLAIN_CODE_LANGUAGES.has(key)) return null;
  return LABEL_BY_VALUE.get(key) ?? LANGUAGE_ALIASES[key] ?? v;
}

// ---------------------------------------------------------------------------
// hljs HTML adapter (CodeBlock + editor decorations)
// ---------------------------------------------------------------------------

export function escapeCodeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/**
 * Tokenize highlight.js output into the splitter's tree. PRECONDITION: `html`
 * is hljs output or `escapeCodeHtml` output — text in both is fully escaped and
 * the only markup is `<span …>` / `</span>`, which is exactly what this reads.
 * It is NOT an HTML parser and must never be fed stored or user HTML.
 */
export function hljsHtmlToLineNodes(html: string): LineNode<string>[] {
  const root: LineNode<string>[] = [];
  const stack: LineNode<string>[][] = [root];
  const re = /<span\b[^>]*>|<\/span>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) stack[stack.length - 1].push({ type: 'text', value: html.slice(last, m.index) });
    if (m[0] === '</span>') {
      if (stack.length > 1) stack.pop();
    } else {
      const node: LineNode<string> = { type: 'element', el: m[0], children: [] };
      stack[stack.length - 1].push(node);
      stack.push(node.children);
    }
    last = re.lastIndex;
  }
  if (last < html.length) stack[stack.length - 1].push({ type: 'text', value: html.slice(last) });
  return root;
}

function renderHtmlNodes(nodes: LineNode<string>[]): string {
  let out = '';
  for (const n of nodes) out += n.type === 'text' ? n.value : `${n.el}${renderHtmlNodes(n.children)}</span>`;
  return out;
}

/**
 * hljs (or escaped plain) HTML → one `<span class="code-line" data-line="N">`
 * per line, the same markup `rehypeCodeLines` produces for the reader, so one
 * stylesheet (app/code-block.css) serves both.
 *
 * Over `maxNodes` (see "The splitting budget") the input comes back UNSPLIT
 * with `numbered: false` — still correct markup, just without rows.
 */
export function renderCodeLinesHtml(
  html: string,
  highlight?: Iterable<number>,
  maxNodes: number = CODE_LINES_MAX_NODES,
): { html: string; lineCount: number; numbered: boolean } {
  const tree = hljsHtmlToLineNodes(html);
  const cost = measureCodeLines(tree, lineNodeText, lineNodeChildren);
  if (!codeLinesFit(cost, maxNodes)) return { html, lineCount: cost.lines, numbered: false };
  const { lines, endsWithNewline } = splitCodeLines(tree);
  const hl = new Set(highlight ?? []);
  let out = '';
  lines.forEach((line, i) => {
    const n = i + 1;
    const br = i < lines.length - 1 || endsWithNewline ? '\n' : '';
    out += `<span class="code-line" data-line="${n}"${hl.has(n) ? ' data-highlighted=""' : ''}>${renderHtmlNodes(line)}${br}</span>`;
  });
  return { html: out, lineCount: lines.length, numbered: true };
}

export interface CodeTokenRange {
  from: number;
  to: number;
  className: string;
}

/**
 * hljs HTML → character ranges over the ORIGINAL (unescaped) source, one per
 * text run, carrying the class of the innermost token. Used by the editor to
 * turn highlighting into ProseMirror inline decorations. Innermost-only on
 * purpose: ProseMirror merges overlapping inline decorations into one span with
 * both classes, where descendant selectors like `.hljs-meta .hljs-string` can
 * no longer tell which one is inside.
 */
export function hljsHtmlToRanges(html: string): CodeTokenRange[] {
  const out: CodeTokenRange[] = [];
  let pos = 0;
  const walk = (nodes: LineNode<string>[], cls: string | null) => {
    for (const n of nodes) {
      if (n.type === 'text') {
        const len = n.value.replace(/&(?:#x?[0-9a-f]+|[a-z]+);/gi, '_').length;
        if (cls && len > 0) {
          const prev = out[out.length - 1];
          if (prev && prev.to === pos && prev.className === cls) prev.to += len;
          else out.push({ from: pos, to: pos + len, className: cls });
        }
        pos += len;
      } else {
        const m = /class="([^"]*)"/.exec(n.el);
        const own = m ? m[1].split(/\s+/).filter((c) => /^hljs-|^[a-z]+_$/.test(c)).join(' ') : '';
        walk(n.children, own || cls);
      }
    }
  };
  walk(hljsHtmlToLineNodes(html), null);
  return out;
}

// ---------------------------------------------------------------------------
// 3. Markdown pipeline plugins
// ---------------------------------------------------------------------------

type HText = { type: 'text'; value: string };
type HElement = {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HNode[];
  position?: { start?: { offset?: number } };
};
type HNode = HText | HElement | { type: string; children?: HNode[] };
type PluginFile = { data?: Record<string, unknown> } | undefined;

const CODE_META_KEY = 'aicCodeMeta';

/** remark plugin: remember each fence's meta by its source offset (see the header for why). */
export function remarkCodeMeta() {
  return (tree: unknown, file: PluginFile) => {
    const metas = new Map<number, string>();
    const walk = (node: { type?: string; meta?: unknown; position?: { start?: { offset?: number } }; children?: unknown[] }) => {
      if (node.type === 'code' && typeof node.meta === 'string' && node.meta) {
        const offset = node.position?.start?.offset;
        if (typeof offset === 'number') metas.set(offset, node.meta);
      }
      if (Array.isArray(node.children)) for (const c of node.children) walk(c as typeof node);
    };
    walk(tree as Parameters<typeof walk>[0]);
    if (metas.size > 0 && file) {
      file.data = file.data ?? {};
      file.data[CODE_META_KEY] = metas;
    }
  };
}

function isElement(node: HNode, tagName?: string): node is HElement {
  return node.type === 'element' && (!tagName || (node as HElement).tagName === tagName);
}

function hastToLineNodes(children: HNode[]): LineNode<HElement>[] {
  const out: LineNode<HElement>[] = [];
  for (const c of children) {
    if (c.type === 'text') out.push({ type: 'text', value: (c as HText).value });
    else if (isElement(c)) out.push({ type: 'element', el: c, children: hastToLineNodes(c.children) });
    // comments / doctype / raw carry no visible code text — sanitize has already removed them
  }
  return out;
}

function cloneProperties(props: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}

function lineNodesToHast(nodes: LineNode<HElement>[]): HNode[] {
  return nodes.map((n) =>
    n.type === 'text'
      ? { type: 'text', value: n.value }
      : { type: 'element', tagName: n.el.tagName, properties: cloneProperties(n.el.properties), children: lineNodesToHast(n.children) },
  );
}

function languageOf(code: HElement): string | null {
  const cls = code.properties?.className;
  const list = Array.isArray(cls) ? cls : typeof cls === 'string' ? cls.split(/\s+/) : [];
  for (const c of list) {
    if (typeof c === 'string' && c.startsWith('language-')) return cleanCodeLanguage(c.slice('language-'.length));
  }
  return null;
}

const hastText = (n: HNode): string | null => (n.type === 'text' ? (n as HText).value : null);
const hastChildren = (n: HNode): readonly HNode[] | null => (isElement(n) ? n.children : null);

/** Remaining split budget of ONE markdown tree, shared by its code blocks in document order. */
type SplitBudget = { remaining: number };

function transformPre(pre: HElement, metas: Map<number, string> | undefined, budget: SplitBudget) {
  const significant = pre.children.filter((c) => !(c.type === 'text' && !(c as HText).value.trim()));
  const code: HElement =
    significant.length === 1 && isElement(significant[0], 'code')
      ? significant[0]
      : { type: 'element', tagName: 'code', properties: {}, children: pre.children };
  const language = languageOf(code);
  const offset = code.position?.start?.offset;
  const meta = parseCodeMeta(typeof offset === 'number' ? metas?.get(offset) : undefined);

  // Rebuilt from scratch: nothing sanitize let through on <pre> is needed by the frame.
  const props: Record<string, unknown> = { dataCodeFrame: '' };
  if (language) props.dataLanguage = language;
  if (meta.filename) props.dataFilename = meta.filename;
  pre.properties = props;
  pre.children = [code];

  const cost = measureCodeLines(code.children, hastText, hastChildren);
  props.dataLines = cost.lines;
  // Over budget: the frame without rows. `code.children` stay exactly what
  // sanitize produced, so this costs what the input costs; there are no
  // `span.code-line` rows, hence no line numbers and no highlighted rows.
  if (!codeLinesFit(cost, budget.remaining)) return;
  budget.remaining -= cost.nodes;

  const { lines, endsWithNewline } = splitCodeLines(hastToLineNodes(code.children));
  const highlight = meta.highlight.filter((n) => n <= lines.length);
  const hl = new Set(highlight);

  code.children = lines.map((line, i): HElement => {
    const n = i + 1;
    const children = lineNodesToHast(line);
    if (i < lines.length - 1 || endsWithNewline) children.push({ type: 'text', value: '\n' });
    return {
      type: 'element',
      tagName: 'span',
      properties: { className: ['code-line'], dataLine: n, ...(hl.has(n) ? { dataHighlighted: '' } : {}) },
      children,
    };
  });
  props.dataLines = lines.length;
  if (highlight.length > 0) props.dataHighlight = formatHighlightRanges(highlight);
}

/**
 * rehype plugin — runs AFTER rehype-sanitize. Splits every `<pre>` into
 * numbered line spans and stamps the frame hooks (`data-language`,
 * `data-filename`, `data-lines`, `data-highlight`) that MarkdownRenderer's `pre`
 * override hands to CodeFrame. A `<pre>` without a single `<code>` child (raw
 * HTML) is wrapped in one so every block gets the same frame.
 *
 * `maxNodes` is the splitting budget for the whole tree (default
 * CODE_LINES_MAX_NODES); blocks past it keep their frame but are not split.
 * A host that renders ONE body as several trees (MarkdownRenderer, around poll
 * widgets) divides the budget between them so the body as a whole stays bounded.
 */
export function rehypeCodeLines(options?: { maxNodes?: number }) {
  const maxNodes = options?.maxNodes ?? CODE_LINES_MAX_NODES;
  return (tree: unknown, file: PluginFile) => {
    const raw = file?.data?.[CODE_META_KEY];
    const metas = raw instanceof Map ? (raw as Map<number, string>) : undefined;
    const budget: SplitBudget = { remaining: maxNodes };
    // Iterative, and in document order (the budget goes to the first blocks).
    // A transformed <pre> is not descended into.
    const stack: HNode[] = [tree as HNode];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (isElement(node, 'pre')) {
        transformPre(node, metas, budget);
        continue;
      }
      const children = (node as { children?: HNode[] }).children;
      if (Array.isArray(children)) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  };
}
