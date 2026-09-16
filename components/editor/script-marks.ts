// 上标 / 下标 — Superscript and Subscript marks. React-free; registered for
// every editor by buildRichTextExtensions (components/editor/rich-text-extensions.ts).
//
// Stored as plain `<sup>…</sup>` / `<sub>…</sub>` inline HTML: GitHub's sanitize
// schema (lib/markdown.ts extends it) already allows both tags, markdown has no
// syntax of its own for them, and tiptap-markdown parses the tags back through
// parseHTML below (markdown-it runs with html: true). `@tiptap/extension-
// superscript` is not a dependency (and not importable under pnpm strict), so
// the two marks are declared here with tiptap core, like InlineCode.
//
// MUTUALLY EXCLUSIVE: each `excludes` both marks, so a parsed `<sup><sub>x</sub></sup>`
// keeps only one — it has no sensible rendering. Applying 下标 to 上标 text
// REPLACES it (Word / 飞书 behaviour). That needs the commands below: tiptap's
// setMark / toggleMark refuse a mark that an existing mark excludes (the rule
// that keeps bold off inline code), so a plain toggleMark('subscript') on
// superscript text would silently do nothing. The commands drop the other
// script mark in the same step instead, and their dry run (`can()`) answers
// the same way.
//
// WHY PRIORITY 1005 (the OUTERMOST inline mark — above the four format marks at
// 1001–1004 and Link at 1000). The markdown serializer opens marks in schema
// rank order, so rank decides where the tag sits in the stored text:
//   • Above Bold (100): `<sup>` is an HTML tag, i.e. PUNCTUATION to CommonMark's
//     flanking rules. Inside a bold run next to CJK text it would store
//     `这**<sup>是</sup>**文` — an opening `**` between a letter and `<` is not
//     left-flanking, the bold is lost on re-open (the same corruption that put
//     the format marks above bold). Outside, `这<sup>**是**</sup>文` is valid.
//   • Above Link (1000): a superscript @mention stores
//     `<sup>[@王伟](/users/x)</sup>`; with the tag inside the label
//     lib/mentions.ts no longer matches `[@…](/users/…)` and the mention stops
//     notifying.
//   • Above the format marks: a single fixed rank keeps the stored bytes
//     deterministic for any combination (`<sup><span data-color="red">x</span></sup>`
//     whichever was applied first). Outer also reads right: the author's 字号 on
//     raised text applies to the raised text, as in Word.
//
// A selection edge inside an @mention is widened to the whole mention first
// (format-marks.ts#widenOverMentions), as for the colour marks.
//
// INLINE CODE (priority 90, always innermost) is ALLOWED inside: `<sup>`x^2`</sup>`
// is an HTML tag around a code span — valid markdown, byte-stable, and the
// backticks never touch a delimiter run. Neither mark excludes the other.

import { Mark, isMarkActive, type CommandProps } from '@tiptap/core';
import type { Mark as PMMark, MarkType } from '@tiptap/pm/model';
import { widenOverMentions } from '@/components/editor/format-marks';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    scriptMarks: {
      setSuperscript: () => ReturnType;
      unsetSuperscript: () => ReturnType;
      /** 上标 on / off; turning it on removes 下标 from the same text. */
      toggleSuperscript: () => ReturnType;
      setSubscript: () => ReturnType;
      unsetSubscript: () => ReturnType;
      /** 下标 on / off; turning it on removes 上标 from the same text. */
      toggleSubscript: () => ReturnType;
    };
  }
}

/** Schema priority of both marks — see the header. */
export const SCRIPT_MARK_PRIORITY = 1005;

type ScriptName = 'superscript' | 'subscript';
const OTHER: Record<ScriptName, ScriptName> = { superscript: 'subscript', subscript: 'superscript' };

/**
 * Sets (`on`), removes, or toggles (`on: null`) one script mark over the
 * selection, removing the other script mark wherever it is set. False when no
 * text in the selection can carry the mark (a code block, a caret in one).
 */
function applyScript(name: ScriptName, on: boolean | null) {
  return ({ tr, state, dispatch }: CommandProps): boolean => {
    const type: MarkType | undefined = state.schema.marks[name];
    if (!type) return false;
    const other: MarkType | undefined = state.schema.marks[OTHER[name]];
    // A mention is raised / lowered whole or not at all (two half-chips otherwise).
    widenOverMentions(tr);
    const turnOn = on ?? !isMarkActive(state, type);
    const { selection } = tr;

    if (selection.empty) {
      if (!selection.$from.parent.type.allowsMarkType(type)) return false;
      if (dispatch) {
        const current = tr.storedMarks ?? selection.$from.marks();
        const kept = current.filter((m) => m.type !== type && m.type !== other);
        tr.setStoredMarks(turnOn ? type.create().addToSet(kept) : kept);
      }
      return true;
    }

    let allowed = false;
    for (const range of selection.ranges) {
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, _pos, parent) => {
        if (allowed) return false;
        if (node.isInline && (!parent || parent.type.allowsMarkType(type))) allowed = true;
        return !allowed;
      });
      if (allowed) break;
    }
    if (!allowed) return false;
    if (dispatch) {
      for (const range of selection.ranges) {
        const from = range.$from.pos;
        const to = range.$to.pos;
        if (other) tr.removeMark(from, to, other);
        if (turnOn) tr.addMark(from, to, type.create());
        else tr.removeMark(from, to, type);
      }
    }
    return true;
  };
}

function scriptMarkSerializer(tag: 'sup' | 'sub') {
  return {
    markdown: {
      serialize: {
        open: (_state: unknown, _mark: PMMark) => `<${tag}>`,
        close: (_state: unknown, _mark: PMMark) => `</${tag}>`,
        // Not mixable: prosemirror-markdown would otherwise reorder it with
        // bold / italic to share delimiters, moving the tag inside `**…**`.
        mixable: false,
        // tiptap-markdown implements expelling by re-scanning the open string
        // as a delimiter run; `<sup>` is not one.
        expelEnclosingWhitespace: false,
      },
      parse: {
        // markdown-it (html: true) emits the tags as inline HTML; parseHTML reads them.
      },
    },
  };
}

export const Superscript = Mark.create({
  name: 'superscript',
  priority: SCRIPT_MARK_PRIORITY,
  excludes: 'superscript subscript',

  parseHTML() {
    // Only the tag. `vertical-align: super` spans from pasted web pages are
    // deliberately not recognised — same "no style import" rule as colours.
    return [{ tag: 'sup' }];
  },

  renderHTML() {
    return ['sup', 0];
  },

  addStorage() {
    return scriptMarkSerializer('sup');
  },

  addCommands() {
    return {
      setSuperscript: () => applyScript('superscript', true),
      unsetSuperscript: () => applyScript('superscript', false),
      toggleSuperscript: () => applyScript('superscript', null),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-.': () => this.editor.commands.toggleSuperscript(),
    };
  },
});

export const Subscript = Mark.create({
  name: 'subscript',
  priority: SCRIPT_MARK_PRIORITY,
  excludes: 'superscript subscript',

  parseHTML() {
    return [{ tag: 'sub' }];
  },

  renderHTML() {
    return ['sub', 0];
  },

  addStorage() {
    return scriptMarkSerializer('sub');
  },

  addCommands() {
    return {
      setSubscript: () => applyScript('subscript', true),
      unsetSubscript: () => applyScript('subscript', false),
      toggleSubscript: () => applyScript('subscript', null),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-,': () => this.editor.commands.toggleSubscript(),
    };
  },
});

/** Register both in every editor instance (buildRichTextExtensions does). */
export const SCRIPT_MARK_EXTENSIONS = [Superscript, Subscript];
