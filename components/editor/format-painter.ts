// 格式刷 (format painter) — copy the inline formatting at the selection, then
// brush it onto the next text the author selects. React-free; registered for
// every editor by buildRichTextExtensions (components/editor/rich-text-extensions.ts),
// driven by the toolbar button (components/editor/toolbar/EditorToolbar.tsx).
//
// Word / 飞书 behaviour, which is what the owner asked for:
//   • CLICK the button: the formatting at the selection (or at the caret) is
//     copied and the painter ARMS — the button shows pressed, the text area
//     shows a brush cursor.
//   • The next NON-EMPTY selection made with the mouse (on mouseup) or the
//     keyboard (Shift+arrows, on releasing Shift) receives EXACTLY the copied
//     formatting: every paintable mark in that range is removed first, then the
//     copied ones are added. An empty source therefore paints "no formatting".
//     The painter disarms.
//   • DOUBLE-CLICK the button: sticky — it keeps painting every selection until
//     Esc or another click on the button.
//   • Esc disarms, and so does leaving the editor (see WHEN IT DISARMS).
//
// WHEN IT DISARMS. Esc only reaches the editor's own keymap, so an author who
// clicked the title field and pressed Esc used to come back to a still-armed
// brush and repaint the first thing they selected. The plugin therefore also
// watches `focusout`: once focus really sits outside this editor — and outside
// the toolbar's portaled panels, which keep the editor's selection — the
// painter goes idle. A window/tab switch (`document.hasFocus()` false) keeps it
// armed: the author is coming back to the same sentence.
//
// MULTI-CLICK. A one-shot paint on a DOUBLE click waits out the multi-click
// window (the third press cancels it) — otherwise the word was painted and the
// painter disarmed before the triple click that selects the paragraph even
// arrived, so 「双击刷一个词」 worked but 「三击刷一段」 silently did nothing.
//
// WHAT IS COPIED: the inline formatting marks only — bold, italic, strike,
// inline code, 上标 / 下标 and the four value marks (colour, background, 字号,
// 字体). NOT links and therefore not @mentions: those are content, and painting
// a link onto text would re-point it. 行高 is a block attribute and is not
// part of the painter either.
//
// ONE UNDO STEP: the removal and the additions are one transaction, and
// `closeHistory` starts a fresh history event so the paint never merges into
// the typing before it.
//
// Mentions: a selection edge inside an @mention is widened to the whole
// mention (the same rule the colour marks follow — format-marks.ts
// widenOverMentions), and inline code is never painted onto mention text
// (InlineCode refuses it: the stored `[`@x`](/users/x)` label no longer
// notifies). Every other mark lands on mentions like the toolbar buttons do.

import { Extension } from '@tiptap/core';
import type { Mark as PMMark } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { widenOverMentions } from '@/components/editor/format-marks';
import { isMentionHref } from '@/lib/mentions';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formatPainter: {
      /** Copy the formatting at the selection and arm. `sticky` keeps it armed after each paint. */
      armFormatPainter: (options?: { sticky?: boolean }) => ReturnType;
      /** Stop painting (no document change). */
      disarmFormatPainter: () => ReturnType;
      /** Paint the copied formatting onto the (non-empty) selection. False when not armed or nothing is selected. */
      applyFormatPainter: () => ReturnType;
    };
  }
}

/** The marks the painter copies and replaces — every inline FORMATTING mark, never link. */
export const PAINTER_MARK_NAMES = [
  'bold',
  'italic',
  'strike',
  'code',
  'superscript',
  'subscript',
  'textColor',
  'textBg',
  'fontSize',
  'fontFamily',
] as const;

const PAINTER_SET: ReadonlySet<string> = new Set(PAINTER_MARK_NAMES);

/** Class on the ProseMirror element while armed (the brush cursor — RichTextEditor's global CSS). */
export const FORMAT_PAINTER_ARMED_CLASS = 'rte-painter-armed';

/**
 * How long a one-shot paint waits after a double click for the triple click
 * that would select the paragraph — prosemirror-view's own double→triple
 * window (`input.ts`: `now - lastClick.time < 500`).
 */
export const MULTI_CLICK_MS = 500;

export interface FormatPainterState {
  armed: boolean;
  sticky: boolean;
  /** The copied marks (painter marks only). */
  marks: readonly PMMark[];
}

const IDLE: FormatPainterState = { armed: false, sticky: false, marks: [] };

export const FormatPainterPluginKey = new PluginKey<FormatPainterState>('formatPainter');

/** The painter's state in `state` (idle when the extension is not registered). */
export function formatPainterState(state: EditorState): FormatPainterState {
  return FormatPainterPluginKey.getState(state) ?? IDLE;
}

/**
 * The formatting to copy: for a caret, the marks the next typed character
 * would get (stored marks, else the caret's); for a range, the marks of its
 * FIRST text node — Word copies the formatting where the selection starts.
 */
export function copyPainterMarks(state: Pick<EditorState, 'doc' | 'selection' | 'storedMarks'>): PMMark[] {
  const { selection, doc } = state;
  let marks: readonly PMMark[] | null = null;
  if (selection.empty) {
    marks = state.storedMarks ?? selection.$from.marks();
  } else {
    doc.nodesBetween(selection.from, selection.to, (node) => {
      if (marks) return false;
      if (node.isText) marks = node.marks;
      return !marks;
    });
  }
  return (marks ?? []).filter((m) => PAINTER_SET.has(m.type.name));
}

const isMentionMark = (m: PMMark) => m.type.name === 'link' && isMentionHref(m.attrs.href as string | undefined);

/**
 * Replaces the formatting of `tr`'s selection with `marks`. Positions do not
 * move (mark steps only), so the removal and the additions address the same
 * range. Returns false (and adds nothing) for an empty selection.
 */
export function paintFormatting(tr: Transaction, marks: readonly PMMark[]): boolean {
  widenOverMentions(tr);
  const { selection } = tr;
  if (selection.empty) return false;
  const schema = tr.doc.type.schema;
  const types = PAINTER_MARK_NAMES.map((n) => schema.marks[n]).filter(Boolean);
  for (const range of selection.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    for (const type of types) tr.removeMark(from, to, type);
    for (const mark of marks) {
      if (mark.type.name !== 'code') {
        tr.addMark(from, to, mark);
        continue;
      }
      // Inline code: per text node, skipping @mention text (see the header).
      const spans: Array<[number, number]> = [];
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return true;
        if (!node.marks.some(isMentionMark)) spans.push([Math.max(pos, from), Math.min(pos + node.nodeSize, to)]);
        return false;
      });
      for (const [a, b] of spans) tr.addMark(a, b, mark);
    }
  }
  return true;
}

/** Reads the browser's selection into the view now (a drag or Shift+arrow may not have been flushed yet). */
function flushDomSelection(view: EditorView): void {
  try {
    (view as unknown as { domObserver?: { flush(): void } }).domObserver?.flush();
  } catch {
    /* a destroyed view */
  }
}

/** Paints the live selection if the painter is armed and the selection is non-empty. */
function paintNow(view: EditorView): boolean {
  if (view.isDestroyed || !view.editable) return false;
  flushDomSelection(view);
  const painter = formatPainterState(view.state);
  if (!painter.armed || view.state.selection.empty) return false;
  const tr = view.state.tr;
  if (!paintFormatting(tr, painter.marks)) return false;
  closeHistory(tr);
  if (!painter.sticky) tr.setMeta(FormatPainterPluginKey, IDLE);
  view.dispatch(tr);
  return true;
}

export const FormatPainter = Extension.create({
  name: 'formatPainter',

  addCommands() {
    return {
      armFormatPainter:
        (options = {}) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(FormatPainterPluginKey, {
              armed: true,
              sticky: Boolean(options.sticky),
              marks: copyPainterMarks(tr),
            } satisfies FormatPainterState);
          }
          return true;
        },
      disarmFormatPainter:
        () =>
        ({ state, tr, dispatch }) => {
          if (!formatPainterState(state).armed) return false;
          if (dispatch) tr.setMeta(FormatPainterPluginKey, IDLE);
          return true;
        },
      applyFormatPainter:
        () =>
        ({ state, tr, dispatch }) => {
          const painter = formatPainterState(state);
          if (!painter.armed || tr.selection.empty) return false;
          if (dispatch) {
            paintFormatting(tr, painter.marks);
            closeHistory(tr);
            if (!painter.sticky) tr.setMeta(FormatPainterPluginKey, IDLE);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Only while armed — otherwise Esc belongs to whoever else wants it.
      Escape: () => (formatPainterState(this.editor.state).armed ? this.editor.commands.disarmFormatPainter() : false),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FormatPainterState>({
        key: FormatPainterPluginKey,
        state: {
          init: () => IDLE,
          apply: (tr, value) => {
            const meta = tr.getMeta(FormatPainterPluginKey) as FormatPainterState | undefined;
            return meta ?? value;
          },
        },
        view: (view) => {
          // A drag can END outside the editor, so the mouseup is watched on the
          // document for the gesture that started inside it. The paint always
          // waits at least one task — ProseMirror (and the browser's
          // selectionchange) settle the final selection after mouseup — and a
          // one-shot paint after a DOUBLE click waits the multi-click window
          // out (see MULTI_CLICK, below).
          let timer = 0;
          let focusTimer = 0;
          let pendingUp: ((e: MouseEvent) => void) | null = null;
          const doc = view.dom.ownerDocument;
          const dropPending = () => {
            if (pendingUp) doc.removeEventListener('mouseup', pendingUp, true);
            pendingUp = null;
          };
          const onDown = (event: MouseEvent) => {
            if (event.button !== 0 || !formatPainterState(view.state).armed) return;
            // A further press in the same click series (double → triple) cancels
            // the paint the previous one queued.
            window.clearTimeout(timer);
            dropPending();
            pendingUp = (up: MouseEvent) => {
              dropPending();
              window.clearTimeout(timer);
              // A double click may still become a triple click (select the
              // paragraph): a ONE-SHOT paint waits that window out, because it
              // also disarms. Sticky repaints the wider selection anyway.
              const wait = up.detail === 2 && !formatPainterState(view.state).sticky ? MULTI_CLICK_MS : 0;
              timer = window.setTimeout(() => paintNow(view), wait);
            };
            doc.addEventListener('mouseup', pendingUp, true);
          };
          // Focus left the editor: disarm, unless it went to the toolbar's own
          // panels (they keep the selection) or the whole window lost focus.
          const onFocusOut = () => {
            if (!formatPainterState(view.state).armed) return;
            window.clearTimeout(focusTimer);
            // One task later: `relatedTarget` is null for a click on anything
            // unfocusable, so the landing element is read from activeElement.
            focusTimer = window.setTimeout(() => {
              if (view.isDestroyed || !formatPainterState(view.state).armed || !doc.hasFocus()) return;
              const active = doc.activeElement;
              const root = view.dom.closest('.rte') ?? view.dom;
              if (active instanceof Element && (root.contains(active) || active.closest('.rte-toolbar-panel'))) return;
              view.dispatch(view.state.tr.setMeta(FormatPainterPluginKey, IDLE));
            }, 0);
          };
          view.dom.addEventListener('mousedown', onDown);
          view.dom.addEventListener('focusout', onFocusOut);
          return {
            destroy: () => {
              view.dom.removeEventListener('mousedown', onDown);
              view.dom.removeEventListener('focusout', onFocusOut);
              dropPending();
              window.clearTimeout(timer);
              window.clearTimeout(focusTimer);
            },
          };
        },
        props: {
          handleDOMEvents: {
            // Keyboard selection: Shift+arrows, painted when Shift is released.
            keyup: (view, event) => {
              if (event.key !== 'Shift' || !formatPainterState(view.state).armed) return false;
              paintNow(view);
              return false;
            },
          },
          attributes: (state): Record<string, string> =>
            formatPainterState(state).armed ? { class: FORMAT_PAINTER_ARMED_CLASS } : {},
        },
      }),
    ];
  },
});
