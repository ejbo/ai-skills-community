// A drop-in replacement for tiptap-markdown's serializer STATE that fixes how
// emphasis delimiters (`**` / `*` / `~~`) are placed. React-free; registered by
// FlowExtension (components/editor/flow-extension.ts).
//
// Why it exists. CommonMark only lets `**` close when it is "right-flanking":
// `**看[文档](/x)**这里` does NOT parse as bold — the closing `**` sits between
// `)` (punctuation) and 这 (a letter). tiptap-markdown knows this and "trims"
// every emphasis run: it shifts the delimiter one character at a time until
// markdown-it says it can open/close. Shifting is harmless across ordinary text
// (`**注意（重要**）` just drops the bracket from the run), but it happily walks
// INTO markdown syntax:
//
//   bold run ending at a link, CJK after  → `请**看[文档](/x**)这里`
//
// and on the next open the link's href is `/x**` and the bold is gone. A bold
// @mention is the common case, and a mention whose href is corrupted no longer
// notifies anyone. Two more real corruptions came from the same class:
// - the delimiter's start was recorded BEFORE the pending block break was
//   written, so a bold run opening the second paragraph of a quote shifted the
//   `>` markers themselves: `> a\n>\n> **b** c` → `> a\n> ****b** c`;
// - a run at output offset 0 was never trimmed at all (`start && end` was
//   falsy), and a run whose closing followed another closing lost its partner.
//
// The fix keeps tiptap-markdown's algorithm byte-for-byte for everything it gets
// right, with three changes:
// 1. a delimiter never moves across markdown / HTML syntax (`[ ] ( ) \` < > \ !`),
//    across ANOTHER kind of emphasis delimiter, or into the middle of a
//    character; when a run cannot be made valid without doing so, the run is
//    written as its HTML twin (`<strong>…</strong>`, `<em>`, `<del>`) instead —
//    which tiptap-markdown parses back to the same mark (html: true), the
//    reader's sanitizer allows, and which keeps `[@王伟](/users/…)` byte-intact
//    so lib/mentions.ts still extracts it. The two later cases were real
//    corruptions of their own:
//    - markdown-it counts emoji (Unicode symbols) as punctuation, so a bold run
//      ENDING in 😀 with text right after is not right-flanking. The shift moved
//      `**` ONE UTF-16 unit left — between the two surrogate halves of the
//      emoji (`**好的\ud83d**\ude00然后`). That string is not valid UTF-16:
//      Prisma refuses it ("unexpected end of hex escape") and the save 500s.
//      Combining marks, variation selectors and ZWJ sequences split the same
//      way (visibly, not fatally), so all of them block;
//    - bold + strike on `注意！` followed by text: the outer `**` walked across
//      the inner run's closing `~~` and split it (`请~**~注意！~**~这里`) — the
//      strike was gone on the next open. Crossing the SAME character is still
//      allowed: `***` is `***` whichever run it is read as;
// 2. a run's start is taken after the pending block break is flushed;
// 3. runs are paired with their closing by mark type and settled when their
//    textblock is done (every run is closed by then), innermost first.
//
// It also owns the ONE top-level loop: the document's children are rendered
// through serializeTopLevelBlocks (components/editor/line-height.ts), which
// wraps each run of blocks sharing a 行高 in `<div data-lh="v">` … `</div>`.
// Block serializers themselves are untouched; only the loop over the
// document's children groups them.

import { Extension } from '@tiptap/core';
import type { Node as PMNode, Mark as PMMark } from '@tiptap/pm/model';
import { MarkdownSerializerState } from '@tiptap/pm/markdown';
import { serializeTopLevelBlocks } from './line-height';

/** Characters a delimiter must never be moved across — they belong to link, code, HTML, image or escape syntax. */
const STRUCTURAL = new Set(['[', ']', '(', ')', '`', '<', '>', '\\', '!']);

/** Emphasis delimiter characters. A delimiter may cross its own character, never another kind's (header, rule 1). */
const EMPHASIS_CHARS = new Set(['*', '_', '~']);

/**
 * Code units that are only PART of a user-perceived character: a surrogate
 * half, the zero-width joiner, or a combining mark (`\p{M}` covers the emoji
 * variation selector U+FE0F and the keycap U+20E3). A delimiter moved across
 * one lands inside the character.
 */
const CLUSTER_PART_RE = /[\uD800-\uDFFF\u200D\p{M}]/u;
/** Code units that belong to the character BEFORE them (a landing spot right before one splits it). */
const EXTENDS_PREVIOUS_RE = /[\uDC00-\uDFFF\u200D\p{M}]/u;
/** Code units that belong to the character AFTER them (a landing spot right after one splits it). */
const JOINS_NEXT_RE = /[\uD800-\uDBFF\u200D]/;

/**
 * True when moving `delim` one code unit across `crossed` is not allowed: the
 * unit is syntax, another kind of emphasis delimiter, or part of a larger
 * character — or the spot the delimiter would land on (between `crossed` and
 * `beyond`) is inside a character.
 */
function blocksShift(delim: string, crossed: string, beyond: string, dir: 1 | -1): boolean {
  if (STRUCTURAL.has(crossed)) return true;
  if (EMPHASIS_CHARS.has(crossed) && crossed !== delim.charAt(0)) return true;
  if (CLUSTER_PART_RE.test(crossed)) return true;
  return dir === 1 ? EXTENDS_PREVIOUS_RE.test(beyond) : JOINS_NEXT_RE.test(beyond);
}

/** The HTML form of each emphasis delimiter the serializers emit. */
const HTML_TWIN: Record<string, readonly [string, string]> = {
  '**': ['<strong>', '</strong>'],
  __: ['<strong>', '</strong>'],
  '*': ['<em>', '</em>'],
  _: ['<em>', '</em>'],
  '~~': ['<del>', '</del>'],
};

export interface DelimScan {
  can_open: boolean;
  can_close: boolean;
}
/** markdown-it's own flanking test at `pos` of `text` (StateInline#scanDelims). */
export type DelimScanner = (text: string, pos: number) => DelimScan;

interface Run {
  mark: string;
  delimiter: string;
  start: number;
  end: number | null;
}

/** An in-place rewrite of `removed` chars at `at` into `inserted` chars. */
interface Edit {
  at: number;
  removed: number;
  inserted: number;
}

function shiftDelim(text: string, delim: string, start: number, offset: number): string {
  let res = text.substring(0, start) + text.substring(start + delim.length);
  res = res.substring(0, start + offset) + delim + res.substring(start + offset);
  return res;
}

/**
 * Settles one emphasis run whose delimiters sit at `from` (opening) and `to`
 * (closing) of `text`. Returns the new text and the length-changing edits it
 * made (in ascending position order), so the caller can re-map other runs.
 * Exported for the unit tests.
 */
export function settleEmphasisRun(
  text: string,
  delim: string,
  from: number,
  to: number,
  scan: DelimScanner,
): { text: string; edits: Edit[] } {
  const d = delim.length;
  // Stale or foreign positions (e.g. a table cell whose pipes were escaped in
  // between) — leave the text alone rather than rewrite characters that are
  // not this run's delimiters.
  if (d === 0 || to < from + d || text.substr(from, d) !== delim || text.substr(to, d) !== delim) {
    return { text, edits: [] };
  }

  let res = text;
  let start = from;
  let end = to;
  let blocked = false;

  while (start < end) {
    if (scan(res, start).can_open) break;
    // Moving right crosses the unit after the delimiter and lands before the next one.
    if (blocksShift(delim, res.charAt(start + d), res.charAt(start + d + 1), 1)) {
      blocked = true;
      break;
    }
    res = shiftDelim(res, delim, start, 1);
    start += 1;
  }
  if (!blocked) {
    while (end > start) {
      if (scan(res, end).can_close) break;
      // Moving left crosses the unit before the delimiter and lands after the one before it.
      if (blocksShift(delim, res.charAt(end - 1), res.charAt(end - 2), -1)) {
        blocked = true;
        break;
      }
      res = shiftDelim(res, delim, end, -1);
      end -= 1;
    }
  }

  if (blocked) {
    const twin = HTML_TWIN[delim];
    // No HTML twin (a future custom delimiter): never shift into syntax — the
    // untouched run is at worst literal text, never a corrupted link.
    if (!twin) return { text, edits: [] };
    const [open, close] = twin;
    return {
      text: text.substring(0, from) + open + text.substring(from + d, to) + close + text.substring(to + d),
      edits: [
        { at: from, removed: d, inserted: open.length },
        { at: to, removed: d, inserted: close.length },
      ],
    };
  }

  if (end - start < d + 1) {
    // Nothing left between the delimiters: drop both (tiptap-markdown's rule).
    return { text: res.substring(0, start) + res.substring(end + d), edits: [{ at: start, removed: end + d - start, inserted: 0 }] };
  }
  return { text: res, edits: [] };
}

/** Maps a position of the text BEFORE `edits` into the text after them. */
function mapThroughEdits(pos: number, edits: readonly Edit[]): number {
  let out = pos;
  for (const e of edits) {
    if (pos >= e.at + e.removed) out += e.inserted - e.removed;
    else if (pos > e.at) out = e.at + e.inserted; // inside a rewritten span: clamp to its end
  }
  return out;
}

// prosemirror-markdown declares the state's constructor and `out` internal;
// the members this subclass relies on are spelled out here.
interface SerializerStateLike {
  out: string;
  marks: Record<string, { open?: unknown; close?: unknown; expelEnclosingWhitespace?: boolean } | undefined>;
  write(content?: string): void;
  closeBlock(node: PMNode): void;
  render(node: PMNode, parent: PMNode, index: number): void;
  renderInline(parent: PMNode, fromBlockStart?: boolean): void;
  renderContent(parent: PMNode): void;
  markString(mark: PMMark, open: boolean, parent: PMNode, index: number): string;
}
const BaseState = MarkdownSerializerState as unknown as new (
  nodes: unknown,
  marks: unknown,
  options: unknown,
) => SerializerStateLike;

export class FlowMarkdownSerializerState extends BaseState {
  /** Read by tiptap-markdown's hardBreak serializer (`<br>` instead of `\` + newline inside GFM cells). */
  inTable = false;
  private runs: Run[] = [];

  constructor(
    nodes: unknown,
    marks: unknown,
    options: unknown,
    private readonly scan: DelimScanner,
  ) {
    super(nodes, marks, options);
  }

  markString(mark: PMMark, open: boolean, parent: PMNode, index: number): string {
    const info = this.marks[mark.type.name];
    if (info?.expelEnclosingWhitespace && typeof info.open === 'string' && typeof info.close === 'string') {
      if (open) {
        // `text()` is about to call `write()`, which may first flush the
        // previous block's break and this line's prefix (`\n>\n> `). Do it now,
        // so `start` is the delimiter itself and not the quote marker before it.
        this.write();
        this.runs.push({ mark: mark.type.name, delimiter: info.open, start: this.out.length, end: null });
      } else {
        for (let i = this.runs.length - 1; i >= 0; i -= 1) {
          const run = this.runs[i];
          if (run.end === null && run.mark === mark.type.name) {
            run.end = this.out.length;
            break;
          }
        }
      }
    }
    return super.markString(mark, open, parent, index);
  }

  renderInline(parent: PMNode, fromBlockStart?: boolean): void {
    super.renderInline(parent, fromBlockStart);
    // Every mark of this textblock is closed now and everything after its
    // closing delimiters is written (or is the end of the block, which the
    // flanking test treats as whitespace) — settle the runs here, BEFORE a
    // caller such as the GFM table serializer post-processes the output.
    this.settleRuns();
  }

  private settleRuns(): void {
    const closed = this.runs.filter((r): r is Run & { end: number } => r.end !== null);
    this.runs = this.runs.filter((r) => r.end === null);
    // Innermost first: a nested run always starts after the run around it.
    closed.sort((a, b) => b.start - a.start);
    for (let i = 0; i < closed.length; i += 1) {
      const run = closed[i];
      const { text, edits } = settleEmphasisRun(this.out, run.delimiter, run.start, run.end, this.scan);
      this.out = text;
      if (edits.length === 0) continue;
      for (const other of closed.slice(i + 1)) {
        other.start = mapThroughEdits(other.start, edits);
        other.end = mapThroughEdits(other.end, edits);
      }
      for (const open of this.runs) open.start = mapThroughEdits(open.start, edits);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/**
 * Swaps `editor.storage.markdown.serializer` for one that renders through
 * FlowMarkdownSerializerState. `getMarkdown()` reads the serializer off storage
 * on every call, so every consumer (onUpdate, the controlled sync, tests)
 * gets the fixed output. Priority 49: tiptap-markdown's `Markdown` (50) creates
 * that storage in its own onBeforeCreate, which runs first.
 */
export const FlowMarkdownSerializer = Extension.create({
  name: 'flowMarkdownSerializer',
  priority: 49,

  onBeforeCreate() {
    const storage = (this.editor.storage as AnyRecord).markdown as AnyRecord | undefined;
    const base = storage?.serializer as AnyRecord | undefined;
    const State = storage?.parser?.md?.inline?.State as (new (src: string, md: null, env: null, tokens: unknown[]) => AnyRecord) | undefined;
    if (!storage || !base || typeof base.serialize !== 'function' || !State) return;

    const scan: DelimScanner = (text, pos) => new State(text, null, null, []).scanDelims(pos, true) as DelimScan;
    // Same object, one method replaced: `nodes` / `marks` are getters on the
    // library's prototype that read `this.editor`, which the prototype chain
    // still resolves to the original serializer.
    const serializer = Object.create(base) as AnyRecord;
    serializer.serialize = (content: PMNode) => {
      const state = new FlowMarkdownSerializerState(serializer.nodes, serializer.marks, { hardBreakNodeName: 'hardBreak' }, scan);
      // `content` is the document (getMarkdown) or a top-level slice's
      // fragment — its children are the top level either way.
      serializeTopLevelBlocks(state, content);
      return state.out;
    };
    storage.serializer = serializer;
  },
});
