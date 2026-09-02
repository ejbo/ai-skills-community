// @人 — the EDITOR half of the mention contract (lib/mentions.ts).
//
// A mention is stored as an ORDINARY MARKDOWN LINK `[@显示名](/users/<handle>)`,
// so this file registers NO custom node: the pick inserts plain TEXT carrying
// the existing `link` mark. That is the whole reason the contract is a link —
// tiptap-markdown already round-trips links, so there is no serializer to write,
// nothing for the poll / embed / sticker / table nodes to collide with, an old
// body that happens to contain a profile link keeps working, and re-editing a
// post leaves the mention exactly as it was stored.
//
// What this module DOES own is the trigger: the `@tiptap/suggestion` plugin
// (the only new dependency) plus the two pure decisions around it —
// `mentionTriggerAllowed` (when an `@` is a mention and not an email) and
// `mentionLabelOf` (the link TEXT, derived from lib/mentions.ts so the rule
// lives in exactly one place). React never appears here: the popup is a
// separate client component fed through the two ref-backed callbacks below,
// which keeps this file headless-testable (tests/mention-editor.test.ts).

import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { mentionMarkdown } from '@/lib/mentions';

export const MENTION_TRIGGER_CHAR = '@';
export const MentionSuggestionPluginKey = new PluginKey('mentionSuggestion');
/** Class on the live `@查询` decoration — styled in RichTextEditor's global CSS. */
export const MENTION_QUERY_CLASS = 'rte-mention-query';

/** The minimum a pick needs; the popup passes the row it has. */
export interface MentionCandidate {
  handle: string;
  displayName: string;
}

/** One `@…` typing session, handed to the popup. Null between sessions. */
export interface MentionSession {
  /**
   * Bumped on every NEW session (a fresh `@`), stable while the query changes.
   * The popup keys its "dismissed" memory on it, so Esc closes THIS session
   * without deafening the next one.
   */
  id: number;
  /** Text after the `@`, exactly as typed (never trimmed here). */
  query: string;
  /**
   * The suggestion plugin's own decoration span. A real element, which is what
   * lets the popup ride `useAnchoredPanel` (it measures a trigger's rect) —
   * the editor root is `overflow-hidden`, so an in-flow popup would be clipped.
   */
  anchor: HTMLElement | null;
  /** The ProseMirror editable — the focused element while the popup is open. */
  editorDom: HTMLElement | null;
  /** Commits a pick into the doc at the live suggestion range. */
  select: (person: MentionCandidate) => void;
}

export interface MentionSuggestionOptions {
  /** Session start / query change / exit. */
  onSession: (session: MentionSession | null) => void;
  /** Return true to swallow the key (the popup navigated with it). */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * The link TEXT for a mention, taken straight out of the stored markdown so the
 * label rule (trim, strip `]`/newline, 80 chars, fall back to the handle) can
 * never drift from lib/mentions.ts. Deriving it costs one regex per pick and
 * buys a single source of truth.
 */
export function mentionLabelOf(displayName: string, handle: string): string {
  const m = /^\[@([\s\S]*)\]\(\/users\//.exec(mentionMarkdown(displayName, handle));
  return m ? m[1] : handle;
}

/**
 * Is an `@` at this position a mention trigger, given the character before it?
 *
 * The suggestion default (`allowedPrefixes: [' ']`) is wrong for this app: 中文
 * is typed without spaces, so 「你好@张三」 would never fire. We allow every
 * prefix EXCEPT the ones that make an email address — that keeps `bob@corp.com`
 * and `a.b-c+d@x` quiet while 汉字, punctuation, brackets and line starts all
 * trigger.
 */
export function mentionTriggerAllowed(prevChar: string): boolean {
  return prevChar === '' || !/[A-Za-z0-9_.+-]/.test(prevChar);
}

/**
 * Replace the `@query` range with the mention: `@Label` wearing the link mark,
 * then an UNMARKED space. The space is not cosmetic — `@tiptap/extension-link`
 * is `inclusive` whenever autolink is on (which RichTextEditor turns on), so
 * without it the next keystroke would grow the link and swallow the sentence
 * into the mention's text.
 */
export function insertMention(editor: Editor, range: Range, person: MentionCandidate): void {
  const label = mentionLabelOf(person.displayName, person.handle);
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        type: 'text',
        text: `${MENTION_TRIGGER_CHAR}${label}`,
        marks: [{ type: 'link', attrs: { href: `/users/${person.handle}` } }],
      },
      { type: 'text', text: ' ', marks: [] },
    ])
    .run();
}

export const MentionSuggestion = Extension.create<MentionSuggestionOptions>({
  name: 'mentionSuggestion',

  addOptions() {
    return { onSession: () => {}, onKeyDown: () => false };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    let sessionId = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toSession = (props: any, id: number): MentionSession => ({
      id,
      query: String(props.query ?? ''),
      anchor: (props.decorationNode as HTMLElement | null) ?? null,
      editorDom: (props.editor?.view?.dom as HTMLElement | undefined) ?? null,
      select: (person) => props.command(person),
    });

    return [
      Suggestion<MentionCandidate, MentionCandidate>({
        editor: this.editor,
        pluginKey: MentionSuggestionPluginKey,
        char: MENTION_TRIGGER_CHAR,
        // A space ENDS the query. Names with a space ("Wei Wang") are still
        // reachable: /api/users/search matches a single token against every
        // name part, so `@wei` and `@wang` both find them — while `allowSpaces`
        // would keep the popup open for the rest of the sentence.
        allowSpaces: false,
        // Our own `allow` decides the prefix (see mentionTriggerAllowed).
        allowedPrefixes: null,
        decorationClass: MENTION_QUERY_CLASS,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false; // 代码块
          const codeMark = state.schema.marks.code;
          if (codeMark && state.doc.rangeHasMark(range.from, range.to, codeMark)) return false;
          // Empty across a block boundary, which is exactly "line start" ⇒ allowed.
          const prev = range.from > 0 ? state.doc.textBetween(range.from - 1, range.from) : '';
          return mentionTriggerAllowed(prev);
        },
        // The popup owns its own fetching (debounced, abortable, cached), so
        // the plugin never needs the list — it only needs to know we are typing.
        items: () => [],
        command: ({ editor, range, props }) => insertMention(editor, range, props),
        render: () => ({
          onStart: (props) => {
            sessionId += 1;
            options.onSession(toSession(props, sessionId));
          },
          onUpdate: (props) => options.onSession(toSession(props, sessionId)),
          onExit: () => options.onSession(null),
          onKeyDown: ({ event }) => options.onKeyDown(event),
        }),
      }),
    ];
  },
});

export default MentionSuggestion;
