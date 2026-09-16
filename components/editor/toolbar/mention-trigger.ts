// @提及 toolbar button — the document half. React-free (tests drive it headless).
//
// The button does NOT open a people picker of its own: it types the trigger
// character, and the @人 suggestion plugin (components/mention/mention-suggestion.ts)
// takes it from there exactly as if the author had pressed `@` — the same
// MentionPicker, the same search, the same stored `[@名](/users/handle)` link.
// One picker, one code path.
//
// The only decision is whether a SPACE must go first. The plugin refuses an `@`
// glued to an ASCII word character (`bob@corp.com` must stay an email —
// mentionTriggerAllowed), so after `hello` the button inserts ` @`; after 汉字,
// punctuation or at a line start it inserts `@` alone, because 中文 is typed
// without spaces and the plugin accepts it there.

import type { Editor } from '@tiptap/core';
import { MENTION_TRIGGER_CHAR, mentionTriggerAllowed } from '@/components/mention/mention-suggestion';

/** The text the button inserts at a caret whose previous character is `prevChar` ('' at a block start). */
export function mentionTriggerText(prevChar: string): string {
  return mentionTriggerAllowed(prevChar) ? MENTION_TRIGGER_CHAR : ` ${MENTION_TRIGGER_CHAR}`;
}

/** Where a mention cannot start: inside a code block or inline code (the plugin refuses both). */
export function mentionTriggerBlocked(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  if (!$from.parent.inlineContent || $from.parent.type.spec.code) return true;
  const code = state.schema.marks.code;
  return Boolean(code && code.isInSet(state.storedMarks ?? $from.marks()));
}

/**
 * Collapses a range selection to its end, types the trigger there and leaves
 * the caret after it (the suggestion plugin opens on that transaction).
 * Returns false where a mention cannot start.
 */
export function insertMentionTrigger(editor: Editor): boolean {
  if (mentionTriggerBlocked(editor)) return false;
  const { state } = editor;
  const at = state.selection.to;
  const $at = state.doc.resolve(at);
  const prev = $at.parentOffset > 0 ? state.doc.textBetween(at - 1, at, undefined, '￼') : '';
  const text = mentionTriggerText(prev);
  return editor
    .chain()
    .focus()
    .setTextSelection(at)
    .command(({ tr }) => {
      // The caret's formatting carries over (typing `@` would keep it), but
      // never a link: right after a link the inclusive Link mark would swallow
      // the `@` — and the whole @query — into that link's text.
      const marks = (state.storedMarks ?? $at.marks()).filter((m) => m.type.name !== 'link');
      tr.insert(at, state.schema.text(text, marks));
      return true;
    })
    .run();
}
