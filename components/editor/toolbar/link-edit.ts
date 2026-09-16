// 插入/编辑链接 — the document half of LinkPopover.tsx / LinkBubble.tsx. React-free
// so tests/editor-toolbar-v3.test.ts drives it on the real extension stack.
//
// It replaces the old `window.prompt` path, which could only set an href on the
// current selection: no display text, no way to insert a link at a caret, and
// "remove" was an empty prompt. Rules:
//   • The href is NORMALISED here (normalizeLinkHref): http(s) through the
//     house normalizeHttpUrl (lib/zones/shared.ts), a bare `example.com` gets
//     `https://`, a site path starting with ONE `/` is kept root-relative (the
//     reader applies the deploy basePath), plus the two kinds of link the
//     EDITOR ITSELF already makes and stores — `mailto:` (typing an address
//     autolinks it) and a `#anchor` into the page's own headings (the TOC
//     generates those ids). Refusing those two meant a link the editor had just
//     created could not be edited: the dialog prefilled its href and then
//     rejected it on 确定. Everything else — `javascript:`, `//evil.example`,
//     whitespace or control characters — is refused and the popover says so.
//   • @mentions are links (lib/mentions.ts) but NOT editable through this: a
//     re-pointed or re-labelled mention silently stops notifying. The toolbar
//     button is disabled on a mention and the bubble offers 打开 only.
//   • Editing keeps the text's formatting: an unchanged display text only
//     swaps the href (the colour / bold inside the link survive); a changed one
//     replaces the text with the new words carrying the formatting of the old
//     first character.
//   • The caret ends AFTER the link with the link mark NOT stored — the Link
//     mark is inclusive (autolink on), so the next keystroke would otherwise
//     grow the link.

import { getMarkRange, type Editor } from '@tiptap/core';
import type { Mark as PMMark, MarkType } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { isMentionHref } from '@/lib/mentions';
import { normalizeHttpUrl } from '@/lib/zones/shared';

/** Longest href accepted (normalizeHttpUrl's own cap). */
const MAX_HREF = 2048;

/** `mailto:name@example.com`, optionally with a `?subject=…` tail. */
const MAILTO_RE = /^mailto:[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+(?:\?[^\s#]*)?$/i;
/**
 * An in-page anchor. Percent escapes are accepted too: that is the shape
 * tiptap-markdown gives back for a CJK heading id (`#%E5%BC%95%E8%A8%80`).
 */
const FRAGMENT_RE = /^#(?:[\p{L}\p{N}_-]|%[0-9A-Fa-f]{2})+$/u;

/**
 * User input → the stored href, or null when it is not a link we store.
 * `/path` (root-relative, not `//`), `http(s)://…`, a bare host-looking value
 * (`example.com/x`) that becomes `https://…`, a `mailto:` address or a
 * `#anchor` into the page itself.
 */
export function normalizeLinkHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > MAX_HREF) return null;
  // Whitespace / control characters anywhere: a URL parser would strip tabs and
  // newlines before resolving (the open-redirect shape CLAUDE.md 8b describes).
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return null;
  if (s.startsWith('/')) {
    // `//host` and `/\host` are scheme-relative to a browser.
    if (s.startsWith('//') || s.startsWith('/\\')) return null;
    return s;
  }
  if (s.startsWith('#')) return FRAGMENT_RE.test(s) ? s : null;
  // The scheme is the only part we case-fold: the local part of an address is
  // case-sensitive per RFC 5321.
  if (MAILTO_RE.test(s)) return `mailto:${s.slice('mailto:'.length)}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    // A scheme was typed: only http(s). (`localhost:3000` also matches the
    // scheme shape — treat a digits-only "scheme tail" as a host with a port.)
    if (/^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(s)) return normalizeHttpUrl(`https://${s}`);
    return normalizeHttpUrl(s);
  }
  // A bare host: at least one dot inside the host part, no leading dot.
  const host = s.split(/[/?#]/, 1)[0];
  if (!/^[^.][^/?#]*\.[^.][^/?#]*$/.test(host)) return null;
  return normalizeHttpUrl(`https://${s}`);
}

export interface LinkRange {
  from: number;
  to: number;
  href: string;
  /** An @mention (href /users/…): open only, never edited here. */
  mention: boolean;
}

const linkTypeOf = (state: EditorState): MarkType | undefined => state.schema.marks.link;

/**
 * The link the selection is IN: for a caret, the link around it (a caret right
 * after a link's last character counts — that is where it lands after a click
 * at its end); for a range, the link that covers ALL of it. Null otherwise.
 */
export function linkAtSelection(state: EditorState): LinkRange | null {
  const type = linkTypeOf(state);
  if (!type) return null;
  const { selection } = state;
  const { $from } = selection;
  const markAt = (): PMMark | null => {
    const after = $from.nodeAfter;
    const before = $from.nodeBefore;
    return (after && type.isInSet(after.marks)) || (before && type.isInSet(before.marks)) || null;
  };
  const mark = markAt();
  if (!mark) return null;
  // getMarkRange looks at the node AFTER the position first, then before.
  const range = getMarkRange($from, type, mark.attrs);
  if (!range) return null;
  if (!selection.empty && (selection.from < range.from || selection.to > range.to)) return null;
  if (!selection.empty && selection.$from.parent !== selection.$to.parent) return null;
  const href = String(mark.attrs.href ?? '');
  return { from: range.from, to: range.to, href, mention: isMentionHref(href) };
}

/** True when the selection (or the caret's marks) includes an @mention link. */
export function selectionTouchesMention(state: EditorState): boolean {
  const type = linkTypeOf(state);
  if (!type) return false;
  const isMention = (m: PMMark) => m.type === type && isMentionHref(m.attrs.href as string | undefined);
  const { selection } = state;
  if (selection.empty) {
    const { $from } = selection;
    return Boolean(
      ($from.nodeBefore && $from.nodeBefore.marks.some(isMention) && $from.nodeAfter && $from.nodeAfter.marks.some(isMention)) ||
        (state.storedMarks ?? []).some(isMention),
    );
  }
  let hit = false;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (hit) return false;
    if (node.isInline && node.marks.some(isMention)) hit = true;
    return !hit;
  });
  return hit;
}

export interface LinkDraft {
  /** The range the popover edits (null = insert at the caret). */
  range: { from: number; to: number } | null;
  /** The text in that range when the popover opened. */
  text: string;
  /** Existing href ('' for a new link). */
  href: string;
  /** False when the range holds anything but plain text in one block (a sticker, a line break, two paragraphs). */
  textEditable: boolean;
  /** Editing an existing (non-mention) link. */
  existing: boolean;
}

/** What the popover opens with, read from the live selection. */
export function linkDraftFor(state: EditorState): LinkDraft {
  const link = linkAtSelection(state);
  if (link && !link.mention) {
    return { range: { from: link.from, to: link.to }, text: state.doc.textBetween(link.from, link.to), href: link.href, textEditable: plainTextRange(state, link.from, link.to), existing: true };
  }
  const { selection } = state;
  if (selection.empty) return { range: null, text: '', href: '', textEditable: true, existing: false };
  return {
    range: { from: selection.from, to: selection.to },
    text: state.doc.textBetween(selection.from, selection.to, ' '),
    href: '',
    textEditable: plainTextRange(state, selection.from, selection.to),
    existing: false,
  };
}

/** One textblock, text nodes only. */
function plainTextRange(state: EditorState, from: number, to: number): boolean {
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) return false;
  let ok = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!ok) return false;
    if (node.isInline && !node.isText) ok = false;
    return ok;
  });
  return ok;
}

/** Marks of the first text node in [from, to), without link. */
function formattingAt(state: EditorState | Transaction, from: number, to: number, link: MarkType): readonly PMMark[] {
  let marks: readonly PMMark[] | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (marks) return false;
    if (node.isText) marks = node.marks;
    return !marks;
  });
  return (marks ?? []).filter((m: PMMark) => m.type !== link);
}

/** Caret right after `pos`, typing there does NOT continue the link. */
function caretAfter(tr: Transaction, pos: number, link: MarkType) {
  tr.setSelection(TextSelection.create(tr.doc, pos));
  tr.removeStoredMark(link);
}

/**
 * Writes the link. `range` is the draft's range MAPPED to the current document
 * (the popover maps it through transactions that land while it is open).
 * Returns false when nothing was written (an invalid href, no link mark, an
 * empty insert).
 */
export function applyLinkEdit(
  editor: Editor,
  draft: { range: { from: number; to: number } | null; text: string; originalText: string; href: string; textEditable: boolean },
): boolean {
  const href = normalizeLinkHref(draft.href);
  const { state, view } = editor;
  const link = linkTypeOf(state);
  if (!href || !link) return false;
  const mark = link.create({ href });
  const tr = state.tr;
  const text = draft.text;
  if (draft.range && draft.range.from < draft.range.to) {
    const { from, to } = draft.range;
    if (!draft.textEditable || text === draft.originalText || text.trim() === '') {
      tr.removeMark(from, to, link);
      tr.addMark(from, to, mark);
      caretAfter(tr, to, link);
    } else {
      const node = state.schema.text(text, [...formattingAt(state, from, to, link), mark]);
      tr.replaceWith(from, to, node);
      caretAfter(tr, from + node.nodeSize, link);
    }
  } else {
    const at = draft.range ? draft.range.from : state.selection.from;
    const words = text.trim() === '' ? href : text;
    const $at = state.doc.resolve(at);
    if (!$at.parent.inlineContent || !$at.parent.type.allowsMarkType(link)) return false;
    const inherited = (state.storedMarks ?? $at.marks()).filter((m) => m.type !== link);
    const node = state.schema.text(words, [...inherited, mark]);
    tr.insert(at, node);
    caretAfter(tr, at + node.nodeSize, link);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** 取消链接 / 移除链接: drops the link mark over `range` (the whole link the caret is in). */
export function removeLinkAt(editor: Editor, range: { from: number; to: number }): boolean {
  const { state, view } = editor;
  const link = linkTypeOf(state);
  if (!link || range.from >= range.to) return false;
  const tr = state.tr.removeMark(range.from, range.to, link);
  view.dispatch(tr);
  return true;
}
