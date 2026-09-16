// 富文本格式标记 — text colour, background, font size, font family, and an
// inline-code mark that can carry them. The storage contract (attribute names,
// closed value sets, the strict hex shape) is lib/rich-marks.ts; the palette is
// app/rich-text.css; the reader's allowlist is lib/markdown.ts. This file is
// the editor half. Superscript / subscript live in script-marks.ts, 行高 in
// line-height.ts.
//
// v3 (2026-09-15): colour and background accept any `#rrggbb` besides the legacy
// names (input is normalised — `#ABC` → `#aabbcc` — and anything else refused),
// 字号 is a px list besides the legacy sm/lg/xl, and 字体 has CJK + Latin keys.
// A hex mark renders in the EDITOR DOM with the custom property the reader's
// post-sanitize plugin sets (`style="--rt-c: #aabbcc"`, painted by
// app/rich-text.css); the markdown serializer never writes that style — the
// stored bytes are the data attribute only.
//
// React-free and import-light on purpose: the headless tests
// (tests/rich-marks.test.ts) build a real Editor from these exact extensions.
//
// REGISTRATION (components/RichTextEditor.tsx):
//   StarterKit.configure({ code: false }),   // InlineCode below replaces it
//   Link.configure(…),
//   …,
//   ...FORMAT_MARK_EXTENSIONS,
//   Markdown.configure(…)
// Order in the array does not matter — priority decides the schema order —
// but EVERY editor instance must register the same list, or opening a body in
// an editor without these marks silently strips the formatting on save.
//
// WHY THESE PRIORITIES (probed headless against the shipped stack, see the
// digest in the editor job): a mark's priority decides its rank in the schema,
// and the markdown serializer opens marks in rank order, so a higher priority
// is an OUTER mark in the stored text.
//   • ABOVE Link (1000). A coloured @mention must store as
//     `<span data-color="red">[@王伟](/users/x)</span>`: with the span inside
//     the link label, lib/mentions.ts's `[@…](/users/…)` pattern no longer
//     matches and the mention silently stops notifying.
//   • ABOVE Bold (100). At a lower rank, colouring one character of a bold run
//     next to CJK text stores `这**是粗<span …>体</span**>文字` — the closing
//     `**` is no longer right-flanking and the markup corrupts on re-open.
//   • fontSize > fontFamily > textBg > textColor (1004 … 1001). Size and
//     family must be OUTSIDE the background: an inline background paints the
//     span's OWN line box, so `<span data-bg><span data-size="xl">` would draw
//     a highlight shorter than the glyphs it sits behind. Colour is innermost
//     because it has no geometry. The order is fixed so nesting (and therefore
//     the stored bytes) is deterministic for any combination.
//   • InlineCode at 90 — BELOW bold/italic/strike. prosemirror-markdown only
//     writes a code run verbatim (unescaped, between backticks) when code is
//     the INNERMOST mark of the text; anything else nests outside the
//     backticks, which is the only valid shape (`<span …>` inside backticks is
//     literal text).
//
// The four format marks are NOT `mixable`: prosemirror-markdown may reorder
// mixable marks to share delimiters, and reordering a span inside `**…**` is
// exactly the CJK flanking corruption above. They also do NOT
// `expelEnclosingWhitespace`: tiptap-markdown implements that by re-scanning
// the OPEN string as a `**`-style delimiter run and shifting it character by
// character, which would walk `<span data-color="red">` into the text.

import { Extension, Mark, getMarkRange, isMarkActive, markInputRule, markPasteRule, type Editor } from '@tiptap/core';
import type { Mark as PMMark, MarkType, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { AddMarkStep, ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform';
import {
  RICH_MARK_ATTR,
  RICH_MARK_KINDS,
  RICH_MARK_NAME,
  isHexColor,
  isRichMarkValue,
  normalizeRichMarkValue,
  type RichMarkKind,
} from '@/lib/rich-marks';
import { isMentionHref } from '@/lib/mentions';
import { resetLineHeightInSelection } from '@/components/editor/line-height';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    richFormatting: {
      /**
       * Colour the selection (or the next typed text when the selection is
       * empty). `value`: a legacy name (`'red'`) or a hex colour in any case,
       * `#rgb` or `#rrggbb` — stored as lowercase `#rrggbb`. Anything else
       * (alpha, CSS names, rgb()) is refused: the command returns false.
       */
      setTextColor: (value: string) => ReturnType;
      unsetTextColor: () => ReturnType;
      /** Background — same values as setTextColor. */
      setTextBg: (value: string) => ReturnType;
      unsetTextBg: () => ReturnType;
      /** 字号: a px value from RICH_FONT_SIZES_PX (number or string, `24` / `'24'`) or a legacy `sm|lg|xl`. */
      setFontSize: (value: string | number) => ReturnType;
      unsetFontSize: () => ReturnType;
      /** 字体: a key of RICH_FONT_FAMILY_STACKS (never a family name). */
      setFontFamily: (value: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
      /**
       * 清除格式: drops the four format marks plus bold / italic / strike /
       * inline code / superscript / subscript from the SELECTION, and resets
       * the 行高 of the top-level blocks it covers. With an empty selection it
       * only drops the marks the next typed character would carry (like
       * unsetTextColor & co.) and leaves the paragraph alone. Links (and
       * therefore @mentions) are content, not formatting, and are kept.
       */
      clearRichFormatting: () => ReturnType;
    };
  }
}

/** Schema priority per kind — see the header for why this exact order. */
export const RICH_MARK_PRIORITY: Record<RichMarkKind, number> = {
  size: 1004,
  font: 1003,
  bg: 1002,
  color: 1001,
};

/** Priority of the inline-code mark: below bold/italic/strike (100) so it is always innermost. */
export const INLINE_CODE_PRIORITY = 90;

/** Mark names 清除格式 removes, besides the four format marks. */
const CLEARED_BASIC_MARKS = ['bold', 'italic', 'strike', 'code', 'superscript', 'subscript'] as const;

/** The custom property each hex mark paints through (app/rich-text.css reads them). */
const HEX_STYLE_PROPERTY = { color: '--rt-c', bg: '--rt-bg' } as const;

/**
 * The editor-DOM style of a hex colour mark: the custom property the reader's
 * post-sanitize plugin sets (lib/markdown-rich-style.ts), so app/rich-text.css
 * paints writing and reading with ONE rule set. Only ever built from a value
 * that passed isHexColor. Never serialized to markdown.
 */
export function hexStyleFor(kind: 'color' | 'bg', value: string): string | null {
  return isHexColor(value) ? `${HEX_STYLE_PROPERTY[kind]}: ${value}` : null;
}

/** The style hexStyleFor renders, as it comes back out of a DOM serializer (spacing and `;` vary). */
const EDITOR_HEX_STYLE_RE = new RegExp(
  `(<span\\s+data-(?:color|bg)="#[0-9a-f]{6}")\\s+style="(?:${HEX_STYLE_PROPERTY.color}|${HEX_STYLE_PROPERTY.bg})\\s*:\\s*#[0-9a-f]{6}\\s*;?\\s*"`,
  'g',
);

/**
 * Removes the editor-only custom property from serialized editor HTML.
 *
 * ONE door needs this: a table markdown cannot express (merged cells, a cell
 * holding two paragraphs / a list / a code block) is stored as raw HTML built
 * by `getHTMLFromFragment` — which runs the marks' renderHTML, style and all
 * (components/markdown-table.ts). The stored bytes are the contract
 * (lib/rich-marks.ts: data attributes, never `style=`), and a stored `style`
 * breaks more than tidiness: RICH_SPAN_TAG_RE matches the exact span shape, so
 * lib/markdown-text.ts counted such a span as visible text, reported it as
 * foreign HTML and left it in the SKILL.md / AI-context body that
 * stripRichFormatting is supposed to clean.
 */
export function stripEditorHexStyle(html: string): string {
  return html.includes('--rt-') ? html.replace(EDITOR_HEX_STYLE_RE, '$1') : html;
}

/** The single attribute each format mark carries. */
const VALUE_ATTR = 'value';

function openTag(kind: RichMarkKind, mark: PMMark): string {
  const value = mark.attrs[VALUE_ATTR];
  // Unreachable through parse / commands / the guard plugin — but a bare
  // `<span>` must never be written into a stored body, so an invalid value
  // serializes as NO tag at all (the text is kept, unformatted).
  return isRichMarkValue(kind, value) ? `<span ${RICH_MARK_ATTR[kind]}="${value as string}">` : '';
}

/** True when the selection (or, for a caret, the marks it would type with) includes an @mention link. */
function selectionTouchesMention(tr: Transaction): boolean {
  const link = tr.doc.type.schema.marks.link;
  if (!link) return false;
  const isMention = (m: PMMark) => m.type === link && isMentionHref(m.attrs.href as string | undefined);
  const { selection } = tr;
  if (selection.empty) return (tr.storedMarks ?? selection.$from.marks()).some(isMention);
  let hit = false;
  for (const range of selection.ranges) {
    tr.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (hit) return false;
      if (node.isInline && node.marks.some(isMention)) hit = true;
      return !hit;
    });
  }
  return hit;
}

/**
 * A selection edge that falls INSIDE an @mention is moved to the mention's
 * edge. Format marks rank above Link, so formatting part of a link splits it
 * into two anchors (`<span …>[@王](/users/x)</span>[伟](/users/x)`) — stable,
 * but for a mention that renders as two broken chips. A mention is formatted
 * whole or not at all. Ordinary links are left alone: two adjacent anchors to
 * the same URL read as one link.
 */
export function widenOverMentions(tr: Transaction): void {
  const { selection, doc } = tr;
  const link = doc.type.schema.marks.link;
  if (!link || selection.empty || !(selection instanceof TextSelection)) return;
  const edge = (pos: number, side: -1 | 1): number => {
    const $pos = doc.resolve(pos);
    const before = $pos.nodeBefore;
    const after = $pos.nodeAfter;
    if (!before || !after) return pos;
    const mention = before.marks.find(
      (m) => m.type === link && isMentionHref(m.attrs.href as string | undefined) && m.isInSet(after.marks),
    );
    if (!mention) return pos;
    const range = getMarkRange($pos, link, mention.attrs);
    return range ? (side < 0 ? range.from : range.to) : pos;
  };
  const from = edge(selection.from, -1);
  const to = edge(selection.to, 1);
  if (from !== selection.from || to !== selection.to) tr.setSelection(TextSelection.create(doc, from, to));
}

function createFormatMark(kind: RichMarkKind) {
  const name = RICH_MARK_NAME[kind];
  const attr = RICH_MARK_ATTR[kind];
  return Mark.create({
    name,
    priority: RICH_MARK_PRIORITY[kind],
    // `inclusive` stays at the ProseMirror default (true): typing at the end of
    // red text continues red, which is what Word / Docs / Notion do.

    addAttributes() {
      return {
        [VALUE_ATTR]: {
          default: null,
          parseHTML: (el: HTMLElement) => {
            const v = el.getAttribute(attr);
            return isRichMarkValue(kind, v) ? v : null;
          },
          // The mark's own renderHTML writes the one attribute; returning {}
          // here keeps tiptap from also emitting a `value="…"` attribute.
          renderHTML: () => ({}),
        },
      };
    },

    parseHTML() {
      return [
        {
          // ONLY our own stored shape. A pasted web page / Word document carries
          // `style="color: …"` spans — those never match, so arbitrary inline
          // colours (unreadable on the dark theme) cannot enter a body.
          tag: `span[${attr}]`,
          getAttrs: (node: string | HTMLElement) =>
            typeof node !== 'string' && isRichMarkValue(kind, node.getAttribute(attr)) ? null : false,
          // A span carrying several formats (`<span data-color data-bg>`, only
          // possible from API-written or hand-written HTML) must yield every
          // mark, not just the first rule that matched.
          consuming: false,
        },
      ];
    },

    renderHTML({ mark }) {
      const value = mark.attrs[VALUE_ATTR];
      if (isRichMarkValue(kind, value)) {
        const style = kind === 'color' || kind === 'bg' ? hexStyleFor(kind, value as string) : null;
        return ['span', style ? { [attr]: value, style } : { [attr]: value }, 0];
      }
      // See openTag: only reachable by constructing a mark by hand before the
      // guard plugin runs. The editor still has to show the text somewhere.
      return ['span', 0];
    },

    addStorage() {
      return {
        markdown: {
          // Explicit rather than tiptap-markdown's HTML-mark fallback (which
          // derives the same tags by regex from renderHTML): the stored bytes
          // are the contract, so they are spelled out here and pinned by tests.
          serialize: {
            open: (_state: unknown, mark: PMMark) => openTag(kind, mark),
            close: (_state: unknown, mark: PMMark) => (isRichMarkValue(kind, mark.attrs[VALUE_ATTR]) ? '</span>' : ''),
            mixable: false,
            expelEnclosingWhitespace: false,
          },
          parse: {
            // markdown-it (html: true) emits the span as inline HTML and the
            // parseHTML rule above reads it back.
          },
        },
      };
    },
  });
}

export const TextColorMark = createFormatMark('color');
export const TextBgMark = createFormatMark('bg');
export const FontSizeMark = createFormatMark('size');
export const FontFamilyMark = createFormatMark('font');

/**
 * StarterKit's Code mark, re-declared (the `@tiptap/extension-code` package is
 * not importable from app code under pnpm's strict layout) with ONE behavioural
 * change: it no longer `excludes: '_'`.
 *
 * Coexists with: the four format marks and Link. Their stored shape is always
 * OUTSIDE the backticks — `<span data-color="red">`fetch()`</span>`,
 * `[`fetch()`](/docs)` — which is valid markdown and round-trips byte-stable.
 *
 * Still excludes bold / italic / strike. Those are delimiter runs, and a
 * delimiter next to a backtick is only flanking when the character on its
 * other side is whitespace or punctuation — which CJK prose never has. Probed
 * on this stack: bold code between two 汉字 (`调用<strong><code>foo()</code></strong>名`)
 * serializes as `调用`**foo()**`名`: tiptap-markdown's delimiter trimming walks
 * the `**` INSIDE the backticks, so the saved code text itself becomes
 * `**foo()**` — silent corruption of the one thing inline code promises to
 * keep verbatim. Italic before a full-width comma does not even round-trip.
 * The combination works only in English, so it is refused everywhere: applying
 * code to bold text removes the bold, toggling bold on code is refused
 * (`editor.can().toggleBold()` is false there).
 *
 * Refuses to ADD code over an @mention: the stored label would start with a
 * backtick (`[`@王伟`](/users/x)`), lib/mentions.ts no longer recognises it
 * and the mention stops notifying without any visible sign.
 */
export const InlineCode = Mark.create({
  name: 'code',
  priority: INLINE_CODE_PRIORITY,
  excludes: 'code bold italic strike',
  code: true,
  // ArrowRight at the very end of a textblock steps out of the code run.
  exitable: true,
  // Enter / Shift-Enter / Enter in a list item END the code run. The mark is
  // inclusive (typing right after a chip on the same line extends it — kept on
  // purpose), and tiptap's splitBlock / splitListItem / setHardBreak carry the
  // caret's marks onto the new line unless the mark opts out: the whole next
  // paragraph, and every one after it, became inline code.
  keepOnSplit: false,

  parseHTML() {
    return [{ tag: 'code' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['code', HTMLAttributes, 0];
  },

  addCommands() {
    return {
      setCode:
        () =>
        ({ tr, commands }) =>
          selectionTouchesMention(tr) ? false : commands.setMark(this.name),
      toggleCode:
        () =>
        ({ state, tr, commands }) => {
          if (!isMarkActive(state, this.type) && selectionTouchesMention(tr)) return false;
          return commands.toggleMark(this.name);
        },
      unsetCode:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-e': () => this.editor.commands.toggleCode(),
    };
  },

  addInputRules() {
    // Same patterns as @tiptap/extension-code: `text` becomes code as the
    // closing backtick is typed, and pasted `text` likewise.
    return [markInputRule({ find: /(^|[^`])`([^`]+)`(?!`)/, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: /(^|[^`])`([^`]+)`(?!`)/g, type: this.type })];
  },
});

// ─── guard: an invalid value can never live in the document ─────────────────

const guardKey = new PluginKey('richMarkGuard');

function formatKindOf(type: MarkType): RichMarkKind | null {
  for (const kind of RICH_MARK_KINDS) if (RICH_MARK_NAME[kind] === type.name) return kind;
  return null;
}

function isInvalidFormatMark(mark: PMMark): boolean {
  const kind = formatKindOf(mark.type);
  return kind != null && !isRichMarkValue(kind, mark.attrs[VALUE_ATTR]);
}

function hasInvalidMark(node: PMNode): boolean {
  let found = false;
  node.descendants((child) => {
    if (found) return false;
    if (child.marks.some(isInvalidFormatMark)) found = true;
    return !found;
  });
  return found;
}

/** Removes every invalid-valued format mark in the document. Returns true when it changed anything. */
function stripInvalid(tr: Transaction): boolean {
  let changed = false;
  tr.doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (!isInvalidFormatMark(mark)) continue;
      tr.removeMark(pos, pos + node.nodeSize, mark);
      changed = true;
    }
  });
  return changed;
}

/** Did this step put an invalid-valued format mark into the document? */
function stepIntroducesInvalid(step: unknown): boolean {
  if (step instanceof AddMarkStep) return isInvalidFormatMark(step.mark);
  if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
    let bad = false;
    step.slice.content.descendants((n) => {
      if (bad) return false;
      if (n.marks.some(isInvalidFormatMark)) bad = true;
      return !bad;
    });
    return bad;
  }
  return false;
}

/**
 * The commands and the parse rules only ever produce listed values; this
 * catches the two remaining doors — a raw `setMark('textColor', { value: … })`
 * and JSON content — so the renderHTML / serializer fallbacks stay unreachable.
 * The common case costs one pass over the transaction's STEPS (not the
 * document); only a transaction that actually introduced a bad value pays for
 * a document walk, and nothing is dispatched otherwise.
 */
const RichMarkGuard = Extension.create({
  name: 'richMarkGuard',

  onCreate() {
    const { state, view } = this.editor;
    if (!hasInvalidMark(state.doc)) return;
    const tr = state.tr;
    stripInvalid(tr);
    tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
    view.dispatch(tr);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: guardKey,
        appendTransaction(transactions: readonly Transaction[], _old: EditorState, newState: EditorState) {
          if (!transactions.some((t) => t.docChanged && t.steps.some(stepIntroducesInvalid))) return null;
          const tr = newState.tr;
          if (!stripInvalid(tr)) return null;
          return tr.setMeta('addToHistory', false);
        },
      }),
    ];
  },
});

// ─── commands ────────────────────────────────────────────────────────────────

const FormatCommands = Extension.create({
  name: 'richFormattingCommands',

  addCommands() {
    const setter =
      (kind: RichMarkKind) =>
      (value: string | number) =>
      ({ tr, commands }: { tr: Transaction; commands: Editor['commands'] }) => {
        // Input is normalised to the stored form (`#ABC` → `#aabbcc`, 24 → '24');
        // a value outside the v3 sets is refused, never coerced into one.
        const stored = normalizeRichMarkValue(kind, value);
        if (stored == null) return false;
        widenOverMentions(tr);
        return commands.setMark(RICH_MARK_NAME[kind], { [VALUE_ATTR]: stored });
      };
    // Empty selection: removes the stored mark only, so the NEXT typed text is
    // unformatted — the run the caret sits in keeps its colour.
    const unsetter =
      (kind: RichMarkKind) =>
      () =>
      ({ tr, commands }: { tr: Transaction; commands: Editor['commands'] }) => {
        widenOverMentions(tr);
        return commands.unsetMark(RICH_MARK_NAME[kind]);
      };

    return {
      setTextColor: setter('color'),
      unsetTextColor: unsetter('color'),
      setTextBg: setter('bg'),
      unsetTextBg: unsetter('bg'),
      setFontSize: setter('size'),
      unsetFontSize: unsetter('size'),
      setFontFamily: setter('font'),
      unsetFontFamily: unsetter('font'),
      clearRichFormatting:
        () =>
        ({ state, tr, dispatch }) => {
          const types = [...RICH_MARK_KINDS.map((k) => RICH_MARK_NAME[k]), ...CLEARED_BASIC_MARKS]
            .map((n) => state.schema.marks[n])
            .filter((t): t is MarkType => Boolean(t));
          if (!dispatch) return true;
          const { selection } = tr;
          // A CARET clears the marks the next character would be typed with and
          // NOTHING else — exactly what unsetTextColor & co. do there. It must
          // not reset the paragraph's 行高 either: the text under the caret
          // keeps its bold / colour / 字号 (nothing is selected to clear), so
          // re-spacing the paragraph would be the one visible effect of a
          // button the author pressed to remove formatting they can see.
          if (selection.empty) {
            const caretMarks = tr.storedMarks ?? selection.$from.marks();
            tr.setStoredMarks(caretMarks.filter((m) => !types.includes(m.type)));
            return true;
          }
          // 行高 is paragraph formatting: Word's 清除格式 resets it for the
          // paragraphs a selection covers.
          resetLineHeightInSelection(tr);
          for (const range of selection.ranges) {
            for (const type of types) tr.removeMark(range.$from.pos, range.$to.pos, type);
          }
          return true;
        },
    };
  },
});

/**
 * Register ALL of these in every editor instance, with `StarterKit.configure({ code: false })`.
 * InlineCode is also named `code`; with StarterKit's left on, tiptap silently
 * builds a hybrid (probed: the stock mark's schema POSITION with this spec) —
 * which only works by accident of the excludes list.
 */
export const FORMAT_MARK_EXTENSIONS = [
  TextColorMark,
  TextBgMark,
  FontSizeMark,
  FontFamilyMark,
  InlineCode,
  FormatCommands,
  RichMarkGuard,
];

// ─── read helpers (toolbar) ──────────────────────────────────────────────────

/**
 * The value of a format mark at the selection, or null when the selection is
 * MIXED (text with different values, or some text without the mark) or has
 * none. An empty selection reads the marks the next typed character would get
 * (stored marks, else the caret's). Only text counts: an image, sticker or hard
 * break inside the range does not make it mixed. The v3 toolbar's selects show
 * this (a blank 字号 box over "12 and 24 px" text, like Word).
 */
export function activeRichValue(editor: Editor, kind: RichMarkKind): string | null {
  const { state } = editor;
  const type = state.schema.marks[RICH_MARK_NAME[kind]];
  if (!type) return null;
  const read = (marks: readonly PMMark[]): string | null => {
    const value = type.isInSet(marks)?.attrs[VALUE_ATTR];
    return isRichMarkValue(kind, value) ? (value as string) : null;
  };
  const { selection } = state;
  if (selection.empty) return read(state.storedMarks ?? selection.$from.marks());
  // `seen` is false until the first text node; `value` null once mixed.
  const acc: { seen: boolean; value: string | null } = { seen: false, value: null };
  for (const range of selection.ranges) {
    let mixed = false;
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (mixed) return false;
      if (!node.isText) return true;
      const v = read(node.marks);
      if (!acc.seen) {
        acc.seen = true;
        acc.value = v;
      } else if (v !== acc.value) {
        acc.value = null;
      }
      if (acc.value === null) mixed = true;
      return false;
    });
    if (mixed) return null;
  }
  return acc.value;
}
