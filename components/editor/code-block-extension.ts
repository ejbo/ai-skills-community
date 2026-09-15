// 代码块 (editor) — the tiptap `codeBlock` node, React-free.
//
// WHY a re-implementation instead of `CodeBlock.extend(...)`: StarterKit's code
// block lives in @tiptap/extension-code-block, which is NOT a direct dependency
// of this app, and under pnpm's strict layout app code cannot import it (same
// situation as @tiptap/extension-text-style — see the editor research notes).
// Adding the dependency is out of bounds, so this file carries the upstream
// node (2.27.2, MIT) verbatim where behaviour matters — Backspace at start,
// exit on triple Enter, exit on ArrowDown, the ``` / ~~~ input rules, the VS
// Code paste handler — plus what this app needs on top:
//
//   - `filename` and `highlight` attributes, written into and read back from
//     the fence info string with the SAME contract the reader uses
//     (lib/markdown-code-lines.ts): ```py title="main.py" {1,3-5}. The
//     highlight ranges are not editable in the UI, but they must survive an
//     edit-and-save, or opening a post would silently strip them.
//   - a fence longer than any backtick run inside the code, so code containing
//     ``` can never close its own block;
//   - Tab / Shift-Tab indent and outdent inside the block (4 spaces for Python),
//     and Enter keeps the current line's indentation (triple Enter still exits);
//   - an info string the node cannot model (```js{1,3}) survives verbatim
//     (`rawInfo`, fenceInfoFor);
//   - syntax colouring as ProseMirror inline decorations (see
//     `codeHighlightPlugin` below).
//
// The name stays `codeBlock`, so the toolbar's toggleCodeBlock / isActive and
// tiptap-markdown's lookup by name keep working. Register it with
// `StarterKit.configure({ codeBlock: false })` — two nodes named codeBlock is a
// schema error. The node view lives in CodeBlockView.tsx (`CodeBlockWithView`),
// kept out of this file so headless tests and the markdown contract do not need
// React.

import { Node, mergeAttributes, textblockTypeInputRule, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import {
  buildFenceInfo,
  cleanCodeFilename,
  cleanCodeLanguage,
  codeFenceFor,
  formatHighlightRanges,
  hljsHtmlToRanges,
  parseCodeMeta,
  PLAIN_CODE_LANGUAGES,
  type CodeTokenRange,
} from '@/lib/markdown-code-lines';

export interface CodeBlockOptions {
  languageClassPrefix: string;
  exitOnTripleEnter: boolean;
  exitOnArrowDown: boolean;
  defaultLanguage: string | null | undefined;
  HTMLAttributes: Record<string, unknown>;
  /** Colour tokens while writing (lazy highlight.js). Tests turn it off. */
  highlight: boolean;
}

/** What Tab inserts (Python: indentUnitFor). Two spaces: the reader renders tabs at 4 columns, and most snippets pasted here are 2-space. */
export const CODE_INDENT = '  ';
/** Blocks longer than this are not coloured in the editor (highlighting runs on the main thread after each pause in typing). */
export const EDITOR_HIGHLIGHT_MAX_CHARS = 20_000;
const HIGHLIGHT_DEBOUNCE_MS = 160;

export const backtickInputRegex = /^```([a-z0-9#+-]+)?[\s\n]$/i;
export const tildeInputRegex = /^~~~([a-z0-9#+-]+)?[\s\n]$/i;

// ---- markdown-it (tiptap-markdown's parser) -------------------------------

type MdToken = { info: string; attrSet(name: string, value: string): void };
type MdRule = (tokens: MdToken[], idx: number, options: unknown, env: unknown, self: unknown) => string;
type MarkdownIt = { set(options: Record<string, unknown>): void; renderer: { rules: Record<string, MdRule | undefined> } };
type MdSerializerState = {
  write(content?: string): void;
  text(text: string, escape?: boolean): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
};

const FENCE_PATCHED = Symbol.for('aic.codeBlock.fenceMeta');

/**
 * tiptap-markdown renders markdown to HTML with markdown-it and lets ProseMirror
 * parse that HTML. markdown-it's fence rule keeps only the first word of the
 * info string (as `class="language-…"`), so the filename and highlight ranges
 * would be lost on every load. This wraps the rule ONCE per markdown-it
 * instance (`setup` runs on every parse) to stash them as data attributes on
 * the rendered <code>, where `parseHTML` below reads them. Token attrs are
 * escaped by markdown-it's renderAttrs.
 */
function patchFenceRule(md: MarkdownIt) {
  const flagged = md as unknown as Record<symbol, boolean>;
  if (flagged[FENCE_PATCHED]) return;
  const original = md.renderer.rules.fence;
  if (!original) return;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = (token.info ?? '').trim();
    // The whole info string, for `rawInfo` (see `fenceAttrsFromInfo`).
    if (info) token.attrSet('data-info', info);
    const space = info.search(/\s/);
    if (space > 0) {
      const meta = parseCodeMeta(info.slice(space + 1));
      if (meta.filename) token.attrSet('data-filename', meta.filename);
      if (meta.highlight.length > 0) token.attrSet('data-highlight', formatHighlightRanges(meta.highlight));
    }
    return original(tokens, idx, options, env, self);
  };
  flagged[FENCE_PATCHED] = true;
}

/**
 * The attributes a fence info string loads as — the SAME steps the parse takes
 * (first word → `language-…` class → cleanCodeLanguage; the rest →
 * parseCodeMeta, only after whitespace). Used to tell whether a stored info
 * string still says exactly what the node holds.
 */
export function fenceAttrsFromInfo(info: string): { language: string | null; filename: string | null; highlight: string | null } {
  const trimmed = info.trim();
  const space = trimmed.search(/\s/);
  const language = cleanCodeLanguage(space > 0 ? trimmed.slice(0, space) : trimmed);
  const meta = space > 0 ? parseCodeMeta(trimmed.slice(space + 1)) : { filename: null, highlight: [] as number[] };
  return { language, filename: meta.filename, highlight: meta.highlight.length > 0 ? formatHighlightRanges(meta.highlight) : null };
}

/**
 * The info string to write for a code block. An info string the node cannot
 * MODEL — ```js{1,3} (VitePress / Docusaurus line highlights), ```jsx:title=src/App.js,
 * ```{r}, ```js=5 — used to be rebuilt from the parsed parts, which dropped all
 * of it: opening a post and editing anything else erased it. The original
 * (`rawInfo`, captured at parse) is written back VERBATIM as long as it still
 * loads as the node's current language / filename / highlight; once the author
 * changes one of those in the editor, the info string is rebuilt from them.
 * A backtick or a line break could not live in a backtick fence's info string.
 */
export function fenceInfoFor(attrs: { language?: unknown; filename?: unknown; highlight?: unknown; rawInfo?: unknown }): string {
  const current = {
    language: (attrs.language as string | null | undefined) ?? null,
    filename: (attrs.filename as string | null | undefined) ?? null,
    highlight: (attrs.highlight as string | null | undefined) ?? null,
  };
  const raw = attrs.rawInfo;
  if (typeof raw === 'string' && raw.trim() && !/[`\r\n]/.test(raw)) {
    const loaded = fenceAttrsFromInfo(raw);
    if (loaded.language === current.language && loaded.filename === current.filename && loaded.highlight === current.highlight) return raw.trim();
  }
  return buildFenceInfo(current);
}

// ---- Tab / Shift-Tab / Enter ------------------------------------------------

/**
 * One indent step for `language`. Python gets four spaces (PEP 8 — a pasted
 * 4-space snippet then indents consistently); everything else CODE_INDENT.
 */
export function indentUnitFor(language: unknown): string {
  return typeof language === 'string' && /^(py|python|python3|py3)$/i.test(language) ? '    ' : CODE_INDENT;
}

/**
 * Enter inside a code block: a new line that keeps the current line's
 * indentation (only the whitespace BEFORE the caret — Enter in the middle of an
 * indent does not double it). A line holding nothing but whitespace loses that
 * whitespace first, so blank lines do not collect trailing spaces. Triple Enter
 * at the end still leaves the block — counted with the carried indentation
 * ignored, or an indented block could never be left that way.
 */
function codeEnter(editor: Editor, type: NodeType, exitOnTripleEnter: boolean): boolean {
  const { state } = editor;
  const { selection } = state;
  const { $from, $to, empty } = selection;
  if ($from.parent.type !== type || !$from.sameParent($to)) return false;
  if (!editor.isEditable) return false;
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;

  if (exitOnTripleEnter && empty && offset === $from.parent.content.size) {
    const blankRun = /\n[ \t]*\n[ \t]*$/.exec(text);
    if (blankRun) {
      return editor
        .chain()
        .command(({ tr }) => {
          tr.delete($from.pos - blankRun[0].length, $from.pos);
          return true;
        })
        .exitCode()
        .run();
    }
  }

  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const nl = text.indexOf('\n', offset);
  const lineEnd = nl === -1 ? text.length : nl;
  const indent = /^[ \t]*/.exec(text.slice(lineStart, offset))?.[0] ?? '';
  const tr = state.tr;
  let from = $from.pos;
  if (empty && indent.length > 0 && text.slice(lineStart, lineEnd).trim() === '') {
    tr.delete(from - (offset - lineStart), from);
    from -= offset - lineStart;
  }
  tr.insertText(`\n${indent}`, from, tr.mapping.map($to.pos));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function indentLines(editor: Editor, typeName: string, outdent: boolean): boolean {
  const { state } = editor;
  const { selection } = state;
  const { $from, $to } = selection;
  if ($from.parent.type.name !== typeName || !$from.sameParent($to)) return false;
  if (!editor.isEditable) return true; // swallow Tab in a read-only block rather than moving focus mid-read
  const unit = indentUnitFor($from.parent.attrs.language);

  if (!outdent && selection.empty) {
    editor.view.dispatch(state.tr.insertText(unit).scrollIntoView());
    return true;
  }

  const text = $from.parent.textContent;
  const base = $from.start();
  const fromOff = $from.parentOffset;
  let toOff = $to.parentOffset;
  // A selection ending exactly at the start of a line does not include that line.
  if (toOff > fromOff && text[toOff - 1] === '\n') toOff -= 1;

  const starts: number[] = [];
  let lineStart = text.lastIndexOf('\n', fromOff - 1) + 1;
  while (lineStart <= toOff) {
    starts.push(lineStart);
    const nl = text.indexOf('\n', lineStart);
    if (nl === -1 || nl >= toOff) break;
    lineStart = nl + 1;
  }

  const tr = state.tr;
  for (let i = starts.length - 1; i >= 0; i--) {
    const at = starts[i];
    if (!outdent) {
      tr.insertText(unit, base + at);
      continue;
    }
    let remove = 0;
    if (text[at] === '\t') remove = 1;
    else while (remove < unit.length && text[at + remove] === ' ') remove++;
    if (remove > 0) tr.delete(base + at, base + at + remove);
  }
  if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView());
  return true;
}

// ---- syntax colouring -------------------------------------------------------

type Hljs = import('@/lib/hljs-client').Hljs;

let hljsPromise: Promise<Hljs | null> | null = null;
function loadHljs(): Promise<Hljs | null> {
  // Lazy: highlight.js must not ride in the bundle of every page with a comment
  // box. Through lib/hljs-client, never `highlight.js/lib/common` — that entry
  // ships CommonJS copies of the grammars rehype-highlight already bundled (see there).
  hljsPromise ??= import('@/lib/hljs-client')
    .then((m) => m.getHljs())
    .catch(() => {
      hljsPromise = null; // a failed chunk load may succeed on the next attempt
      return null;
    });
  return hljsPromise;
}

// Per (language, text) token ranges, so a pause in typing re-highlights only the
// block that changed. Bounded; the oldest entries go first.
const rangeCache = new Map<string, CodeTokenRange[]>();
const RANGE_CACHE_MAX = 200;

function highlightable(node: PMNode): string | null {
  const lang = cleanCodeLanguage(node.attrs.language as string | null);
  if (!lang || PLAIN_CODE_LANGUAGES.has(lang.toLowerCase())) return null;
  const size = node.content.size;
  if (size === 0 || size > EDITOR_HIGHLIGHT_MAX_CHARS) return null;
  return lang;
}

function eachCodeBlock(doc: PMNode, typeName: string, fn: (node: PMNode, pos: number) => boolean | void) {
  let stop = false;
  doc.descendants((node, pos) => {
    if (stop) return false;
    if (node.type.name === typeName) {
      if (fn(node, pos) === false) stop = true;
      return false;
    }
    // Only containers can hold a code block; never walk into paragraph text.
    return !node.isTextblock && !node.isAtom;
  });
}

function hasHighlightableCode(doc: PMNode, typeName: string): boolean {
  let found = false;
  eachCodeBlock(doc, typeName, (node) => {
    if (highlightable(node)) {
      found = true;
      return false;
    }
  });
  return found;
}

function buildDecorations(doc: PMNode, typeName: string, hljs: Hljs): DecorationSet {
  const decorations: Decoration[] = [];
  eachCodeBlock(doc, typeName, (node, pos) => {
    const lang = highlightable(node);
    if (!lang || !hljs.getLanguage(lang)) return;
    const text = node.textContent;
    const key = `${lang}|${text}`;
    let ranges = rangeCache.get(key);
    if (!ranges) {
      try {
        ranges = hljsHtmlToRanges(hljs.highlight(text, { language: lang, ignoreIllegals: true }).value);
      } catch {
        ranges = [];
      }
      rangeCache.set(key, ranges);
      if (rangeCache.size > RANGE_CACHE_MAX) rangeCache.delete(rangeCache.keys().next().value as string);
    }
    const start = pos + 1;
    for (const r of ranges) decorations.push(Decoration.inline(start + r.from, start + r.to, { class: r.className }));
  });
  return DecorationSet.create(doc, decorations);
}

export const codeHighlightKey = new PluginKey<DecorationSet>('codeBlockHighlight');

/** True when a node of `typeName` is at, around or inside `from..to` of `doc`. */
function rangeTouchesCode(doc: PMNode, from: number, to: number, typeName: string): boolean {
  const lo = Math.max(0, Math.min(from, to, doc.content.size));
  const hi = Math.max(lo, Math.min(Math.max(from, to), doc.content.size));
  for (const pos of [lo, hi]) {
    const $pos = doc.resolve(pos);
    for (let d = $pos.depth; d > 0; d -= 1) if ($pos.node(d).type.name === typeName) return true;
  }
  let found = false;
  doc.nodesBetween(lo, hi, (node) => {
    if (found) return false;
    if (node.type.name === typeName) {
      found = true;
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}

/**
 * Whether the edit from `before` to `after` touched a code block. The changed
 * range comes from Fragment#findDiffStart / findDiffEnd, which skip unchanged
 * children by identity (structural sharing), so this is cheap on a long document.
 */
export function changeTouchesCode(before: PMNode, after: PMNode, typeName: string): boolean {
  const start = before.content.findDiffStart(after.content);
  if (start == null) return false;
  const end = before.content.findDiffEnd(after.content) ?? { a: before.content.size, b: after.content.size };
  let endA = end.a;
  let endB = end.b;
  // A change inside a run of equal characters makes the two scans overlap; widen
  // both ends the way prosemirror-view's DOM reader does.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return rangeTouchesCode(before, start, endA, typeName) || rangeTouchesCode(after, start, endB, typeName);
}

/** DecorationSet#eq exists at runtime but is marked internal (absent from the typings). */
function decorationSetsEqual(a: DecorationSet, b: DecorationSet | undefined): boolean {
  const eq = (a as unknown as { eq?: (other: DecorationSet) => boolean }).eq;
  return Boolean(b && typeof eq === 'function' && eq.call(a, b));
}

/**
 * Colours code while writing. Robustness rules, each one load-bearing:
 * - decorations are MAPPED through every edit immediately (no flash of
 *   uncoloured text), and recomputed only after a pause in typing;
 * - nothing is recomputed while an IME composition is open — replacing
 *   decorations around the composing text node aborts the composition;
 * - the recompute is a meta-only transaction (no doc change ⇒ no `update`
 *   event ⇒ no onChange, no autosave, no dirty draft);
 * - highlight.js is imported only once the document actually contains a code
 *   block with a language;
 * - per-keystroke work is proportional to the CHANGE, not the document: only an
 *   edit that touches a code block (typing in one, inserting / deleting / retyping
 *   one, changing its language) schedules anything. Every keystroke in a 200 KB
 *   post without code used to walk the whole document looking for a highlightable
 *   block, and once highlight.js was loaded every pause in typing — anywhere —
 *   rebuilt every block's decorations and dispatched a transaction, i.e. one more
 *   full RichTextEditor render per pause;
 * - a rebuilt set equal to the mapped one is not dispatched.
 */
function codeHighlightPlugin(typeName: string) {
  return new Plugin<DecorationSet>({
    key: codeHighlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(codeHighlightKey) as DecorationSet | undefined;
        if (next) return next;
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
      },
    },
    props: {
      decorations(state) {
        return codeHighlightKey.getState(state);
      },
    },
    view(view: EditorView) {
      let hljs: Hljs | null = null;
      let loading = false;
      let destroyed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const run = () => {
        timer = undefined;
        if (destroyed || !hljs) return;
        if (view.composing) {
          schedule(HIGHLIGHT_DEBOUNCE_MS);
          return;
        }
        const set = buildDecorations(view.state.doc, typeName, hljs);
        if (decorationSetsEqual(set, codeHighlightKey.getState(view.state))) return;
        view.dispatch(view.state.tr.setMeta(codeHighlightKey, set).setMeta('addToHistory', false));
      };
      const schedule = (delay: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, delay);
      };
      const ensure = (delay: number) => {
        if (hljs) {
          schedule(delay);
          return;
        }
        if (loading || !hasHighlightableCode(view.state.doc, typeName)) return;
        loading = true;
        void loadHljs().then((loaded) => {
          loading = false;
          if (destroyed || !loaded) return;
          hljs = loaded;
          schedule(0);
        });
      };

      ensure(0);
      return {
        update(v, prevState) {
          if (v.state.doc !== prevState.doc && changeTouchesCode(prevState.doc, v.state.doc, typeName)) ensure(HIGHLIGHT_DEBOUNCE_MS);
        },
        destroy() {
          destroyed = true;
          if (timer) clearTimeout(timer);
        },
      };
    },
  });
}

// ---- the node ---------------------------------------------------------------

export const CodeBlockBase = Node.create<CodeBlockOptions>({
  name: 'codeBlock',

  // Above StarterKit's 100 so Tab here wins over ListItem's sink-on-Tab when a
  // code block sits inside a list. Paragraph (1000) still leads the schema.
  priority: 101,

  addOptions() {
    return {
      languageClassPrefix: 'language-',
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      defaultLanguage: null,
      HTMLAttributes: {},
      highlight: true,
    };
  },

  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: this.options.defaultLanguage ?? null,
        parseHTML: (element) => {
          const { languageClassPrefix } = this.options;
          const code = element.querySelector('code') ?? element.firstElementChild;
          const classNames = [...(code?.classList ?? [])];
          const language = classNames.find((c) => c.startsWith(languageClassPrefix))?.slice(languageClassPrefix.length);
          return cleanCodeLanguage(language) ?? null;
        },
        rendered: false,
      },
      filename: {
        default: null,
        parseHTML: (element) =>
          cleanCodeFilename(element.getAttribute('data-filename') ?? element.querySelector('code')?.getAttribute('data-filename')),
        renderHTML: (attributes) => (attributes.filename ? { 'data-filename': attributes.filename } : {}),
      },
      highlight: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-highlight') ?? element.querySelector('code')?.getAttribute('data-highlight');
          const lines = parseCodeMeta(raw ? `{${raw}}` : null).highlight;
          return lines.length > 0 ? formatHighlightRanges(lines) : null;
        },
        renderHTML: (attributes) => (attributes.highlight ? { 'data-highlight': attributes.highlight } : {}),
      },
      // The fence info string exactly as stored — written back while it still
      // matches the three attributes above (fenceInfoFor). Never rendered.
      rawInfo: {
        default: null,
        rendered: false,
        parseHTML: (element) => (element.querySelector('code') ?? element).getAttribute('data-info'),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'pre', preserveWhitespace: 'full' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      ['code', { class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null }, 0],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MdSerializerState, node: PMNode) {
          const code = node.textContent;
          const fence = codeFenceFor(code);
          state.write(`${fence}${fenceInfoFor(node.attrs)}\n`);
          state.text(code, false);
          // ALWAYS a newline after non-empty code, even when it already ends in
          // one: the parse drops exactly one trailing newline (updateDOM below),
          // so `ensureNewLine` — a no-op after "\n" — lost one blank line at the
          // end of the code on every save. An empty block stays ```\n```.
          if (code) state.write('\n');
          else state.ensureNewLine();
          state.write(fence);
          state.closeBlock(node);
        },
        parse: {
          setup(this: { options: CodeBlockOptions }, markdownit: MarkdownIt) {
            markdownit.set({ langPrefix: this.options.languageClassPrefix ?? 'language-' });
            patchFenceRule(markdownit);
          },
          updateDOM(element: HTMLElement) {
            // markdown-it ends fence content with a newline ProseMirror would keep as an extra blank line.
            element.innerHTML = element.innerHTML.replace(/\n<\/code><\/pre>/g, '</code></pre>');
          },
        },
      },
    };
  },

  addCommands() {
    return {
      setCodeBlock:
        (attributes) =>
        ({ commands }) =>
          commands.setNode(this.name, attributes),
      toggleCodeBlock:
        (attributes) =>
        ({ commands }) =>
          commands.toggleNode(this.name, 'paragraph', attributes),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock(),

      Tab: ({ editor }) => indentLines(editor, this.name, false),
      'Shift-Tab': ({ editor }) => indentLines(editor, this.name, true),

      // remove code block when at start of document or code block is empty
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection;
        const isAtStart = $anchor.pos === 1;
        if (!empty || $anchor.parent.type.name !== this.name) return false;
        if (isAtStart || !$anchor.parent.textContent.length) return this.editor.commands.clearNodes();
        return false;
      },

      // A new line keeping the indentation; triple Enter at the end exits (codeEnter).
      Enter: ({ editor }) => codeEnter(editor, this.type, this.options.exitOnTripleEnter),

      // exit node on arrow down
      ArrowDown: ({ editor }) => {
        if (!this.options.exitOnArrowDown) return false;
        const { state } = editor;
        const { selection, doc } = state;
        const { $from, empty } = selection;
        if (!empty || $from.parent.type !== this.type) return false;
        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
        if (!isAtEnd) return false;
        const after = $from.after();
        if (after === undefined) return false;
        const nodeAfter = doc.nodeAt(after);
        if (nodeAfter) {
          return editor.commands.command(({ tr }) => {
            tr.setSelection(Selection.near(doc.resolve(after)));
            return true;
          });
        }
        return editor.commands.exitCode();
      },
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({ find: backtickInputRegex, type: this.type, getAttributes: (match) => ({ language: match[1] ?? null }) }),
      textblockTypeInputRule({ find: tildeInputRegex, type: this.type, getAttributes: (match) => ({ language: match[1] ?? null }) }),
    ];
  },

  addProseMirrorPlugins() {
    const plugins: Plugin[] = [
      // this plugin creates a code block for pasted content from VS Code
      // we can also detect the copied code language
      new Plugin({
        key: new PluginKey('codeBlockVSCodeHandler'),
        props: {
          handlePaste: (view, event) => {
            if (!event.clipboardData) return false;
            // don't create a new code block within code blocks
            if (this.editor.isActive(this.type.name)) return false;
            const text = event.clipboardData.getData('text/plain');
            const vscode = event.clipboardData.getData('vscode-editor-data');
            let language: string | null = null;
            try {
              language = cleanCodeLanguage(vscode ? (JSON.parse(vscode) as { mode?: string }).mode : null);
            } catch {
              language = null;
            }
            if (!text || !language) return false;
            const { tr, schema } = view.state;
            // strip carriage return chars from text pasted as code
            const textNode = schema.text(text.replace(/\r\n?/g, '\n'));
            tr.replaceSelectionWith(this.type.create({ language }, textNode));
            if (tr.selection.$from.parent.type !== this.type) {
              // put cursor inside the newly created code block
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2))));
            }
            // store meta information — useful for other plugins that depend on the paste event
            tr.setMeta('paste', true);
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
    if (this.options.highlight) plugins.push(codeHighlightPlugin(this.name));
    return plugins;
  },
});
