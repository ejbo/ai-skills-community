'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Languages, Loader2, StickyNote, Sparkles, Trash2 } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { pushToast } from '@/components/Toaster';
import { textRects } from './anchoring';

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface SelectionPayload {
  chapterIndex: number;
  quote: string;
  charStart: number;
  charEnd: number;
}

export interface SelectionContext {
  root: HTMLElement;
  chapterIndex: number;
}

/** Toolbar height incl. padding — used to decide whether it fits above the text. */
const MENU_H = 56;

interface Placement {
  top: number;
  left: number;
  /** true ⇒ the toolbar sits ABOVE the selection and is translated up. */
  above: boolean;
}

/** Where the toolbar goes for the current selection, or null if it has none. */
function placeFor(range: Range): Placement | null {
  // Text rects only — a range spanning a paragraph break also reports the block
  // BORDER boxes, whose top edge would park the toolbar over unrelated text.
  const rects = textRects(range);
  const first = rects[0] ?? range.getBoundingClientRect();
  const last = rects[rects.length - 1] ?? first;
  if (!first || (first.width < 1 && first.height < 1)) return null;
  const clampX = (x: number) => Math.min(Math.max(x, 130), window.innerWidth - 130);
  // Above unless it would collide with the reader chrome; then below the last
  // line. The old code clamped `top` to 64 instead, which parked the toolbar on
  // top of the header for selections near the top of the viewport.
  // `above` is translated up, so `top` is the toolbar's BOTTOM edge there and
  // its TOP edge here — the two branches clamp against different limits.
  if (first.top - MENU_H >= 64) {
    return { top: first.top - 10, left: clampX(first.left + first.width / 2), above: true };
  }
  return {
    top: Math.min(last.bottom + 10, window.innerHeight - MENU_H - 8),
    left: clampX(last.left + last.width / 2),
    above: false,
  };
}

/** Floating menu above (or below) a text selection inside a chapter article. */
export function SelectionMenu({
  capture,
  onHighlight,
  onNote,
  onAskAi,
  onTranslate,
}: {
  /** Resolve the live selection into an anchorable payload (null = not in an article). */
  capture: () => SelectionPayload | null;
  onHighlight: (payload: SelectionPayload, color: HighlightColor) => void;
  onNote: (payload: SelectionPayload) => void;
  onAskAi: (quote: string) => void;
  /** Selection translation — anchored near the menu position. */
  onTranslate: (text: string, anchor: { top: number; left: number }) => void;
}) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const [pos, setPos] = useState<Placement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) {
      setPos(null);
      return;
    }
    if (!capture()) {
      setPos(null);
      return;
    }
    setPos(placeFor(sel.getRangeAt(0)));
  }, [capture]);

  useEffect(() => {
    const onUp = (e: Event) => {
      // Ignore pointer-ups on the menu itself (clicking a button collapses nothing).
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      window.setTimeout(refresh, 0);
    };
    // Any mousedown OUTSIDE the toolbar dismisses it immediately. Without this
    // the toolbar stays parked over the two lines above the previous selection
    // and swallows the mousedown that would start the next drag there — the
    // "sometimes I just can't select" case.
    const onDown = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setPos(null);
    };
    const onSelChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPos(null);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('selectionchange', onSelChange);
    };
  }, [refresh]);

  function dismiss(clearSelection: boolean) {
    if (clearSelection) window.getSelection()?.removeAllRanges();
    setPos(null);
  }

  if (!pos) return null;

  return (
    <div
      ref={menuRef}
      role="toolbar"
      aria-label={t('selection_toolbar')}
      className={`reader-panel rborder fixed z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border px-2.5 py-2 shadow-xl ${
        pos.above ? '-translate-y-full' : ''
      }`}
      style={{ top: pos.top, left: pos.left }}
      // The toolbar is not all buttons — it has padding, gaps and a divider.
      // A mousedown landing on any of those would collapse the selection the
      // toolbar exists to act on, and `selectionchange` would then hide it
      // mid-click. This does NOT make it a mousedown black hole: the
      // dismiss-on-outside listener above already exempts targets inside it.
      onMouseDown={(e) => e.preventDefault()}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={t('highlight_color', { color })}
          // preventDefault per BUTTON keeps the selection alive while clicking,
          // without making the whole toolbar a mousedown black hole.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const payload = capture();
            if (!payload) return dismiss(true);
            onHighlight(payload, color);
            dismiss(true);
          }}
          className={`hl-dot-${color} h-5 w-5 rounded-full transition hover:scale-110`}
        />
      ))}
      <span className="rborder mx-0.5 h-4 w-px border-l" />
      <MenuButton
        label={t('note')}
        onClick={() => {
          const payload = capture();
          if (!payload) return dismiss(true);
          onNote(payload);
          dismiss(true);
        }}
      >
        <StickyNote className="h-4 w-4" />
      </MenuButton>
      <MenuButton
        label={tc('copy')}
        onClick={async () => {
          const text = window.getSelection()?.toString() ?? '';
          const ok = text ? await copyText(text) : false;
          pushToast(ok ? 'success' : 'error', ok ? tc('copied') : tc('copy_failed'));
          dismiss(false);
        }}
      >
        <Copy className="h-4 w-4" />
      </MenuButton>
      <MenuButton
        label={t('translate')}
        onClick={() => {
          const text = (window.getSelection()?.toString() ?? '').trim().slice(0, 3000);
          if (!text || !pos) return dismiss(true);
          onTranslate(text, { top: pos.top, left: pos.left });
          dismiss(false);
        }}
      >
        <Languages className="h-4 w-4" />
      </MenuButton>
      <MenuButton
        label={t('ask_ai_short')}
        onClick={() => {
          const payload = capture();
          if (!payload) return dismiss(true);
          onAskAi(payload.quote);
          dismiss(true);
        }}
      >
        <Sparkles className="h-4 w-4" />
      </MenuButton>
    </div>
  );
}

function MenuButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="r-muted grid h-7 w-7 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)] hover:text-[var(--reader-accent)]"
    >
      {children}
    </button>
  );
}

/**
 * Popover for an existing mark. Clicking a highlight opens THIS: the quote, the
 * annotation itself (editable in place), the color palette and delete. The note
 * used to live only in the right-hand 我的笔记 panel, so a painted mark carried
 * no visible annotation.
 */
export function MarkPopover({
  top,
  left,
  quote,
  currentColor,
  noteText,
  saving,
  onRecolor,
  onSaveNote,
  onOpenInPanel,
  onDelete,
  onClose,
  onEditingChange,
}: {
  top: number;
  left: number;
  quote: string;
  currentColor: string;
  noteText: string | null;
  saving: boolean;
  onRecolor: (color: HighlightColor) => void;
  /** Resolves to whether the note was persisted — the editor stays open on failure. */
  onSaveNote: (text: string) => Promise<boolean>;
  onOpenInPanel: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** Reported upward so the reader does not unmount the popover mid-edit. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(noteText ?? '');

  // Only adopt an incoming note while NOT editing — a failed save rolls the
  // parent's state back, and adopting that would erase what the user typed.
  useEffect(() => {
    if (!editing) setDraft(noteText ?? '');
  }, [noteText, editing]);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('highlight_toolbar')}
      className="reader-panel rborder fixed z-50 w-80 max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-xl border p-2.5 shadow-2xl"
      style={{
        top: Math.min(top, typeof window !== 'undefined' ? window.innerHeight - 240 : top),
        left: Math.min(
          Math.max(left, 170),
          typeof window !== 'undefined' ? window.innerWidth - 170 : left,
        ),
      }}
    >
      <div className="flex items-center gap-1.5">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t('recolor_to', { color })}
            onClick={() => onRecolor(color)}
            className={`hl-dot-${color} h-5 w-5 rounded-full transition hover:scale-110 ${
              currentColor === color ? 'ring-2 ring-accent-500/60 ring-offset-1' : ''
            }`}
          />
        ))}
        <span className="rborder mx-0.5 h-4 w-px border-l" />
        <MenuButton label={tc('delete')} onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </MenuButton>
      </div>

      <p className={`r-muted mt-2 line-clamp-3 border-l-2 pl-2 text-xs leading-relaxed hl-border-${currentColor}`}>
        {quote}
      </p>

      {editing ? (
        <div className="mt-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            // Matches the API cap (highlights/[highlightId] PATCH: noteText max 2000).
            maxLength={2000}
            placeholder={t('note_placeholder')}
            className="reader-panel rborder w-full resize-y rounded-lg border px-2 py-1.5 text-xs leading-relaxed outline-none focus:border-accent-500"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDraft(noteText ?? '');
                setEditing(false);
              }}
              className="r-muted h-7 rounded-lg px-2.5 text-xs transition hover:bg-[var(--reader-hover)]"
            >
              {tc('cancel')}
            </button>
            <button
              type="button"
              disabled={saving}
              // Close only AFTER the save lands. Closing synchronously made the
              // spinner unreachable and, on failure, threw the typed note away
              // (the parent's rollback flowed straight back into `draft`).
              onClick={() => {
                void onSaveNote(draft).then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
              className="flex h-7 items-center gap-1 rounded-lg bg-accent-500 px-2.5 text-xs font-medium text-white transition hover:bg-accent-600 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {tc('save')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {noteText && (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{noteText}</p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rborder inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition hover:border-accent-500 hover:text-[var(--reader-accent)]"
            >
              <StickyNote className="h-3 w-3" />
              {noteText ? t('edit_note') : t('note')}
            </button>
            <button
              type="button"
              onClick={onOpenInPanel}
              className="r-muted ml-auto text-[11px] transition hover:text-[var(--reader-accent)]"
            >
              {t('notes_title')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Popover for another reader's shared annotation: their note + a way in. */
export function CommunityNotePopover({
  top,
  left,
  authorName,
  quote,
  noteText,
  replyCount,
  onOpenInPanel,
  onClose,
}: {
  top: number;
  left: number;
  authorName: string;
  quote: string;
  noteText: string | null;
  replyCount: number;
  onOpenInPanel: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('reader');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('notes_here')}
      className="reader-panel rborder fixed z-50 w-80 max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-xl border p-2.5 shadow-2xl"
      style={{
        top: Math.min(top, typeof window !== 'undefined' ? window.innerHeight - 220 : top),
        left: Math.min(
          Math.max(left, 170),
          typeof window !== 'undefined' ? window.innerWidth - 170 : left,
        ),
      }}
    >
      <p className="text-xs font-semibold">{authorName}</p>
      <p className="r-muted mt-1.5 line-clamp-3 border-l-2 border-[color:var(--reader-border)] pl-2 text-xs leading-relaxed">
        {quote}
      </p>
      {noteText && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{noteText}</p>}
      <button
        type="button"
        onClick={onOpenInPanel}
        className="r-muted mt-2 text-[11px] transition hover:text-[var(--reader-accent)]"
      >
        {replyCount > 0 ? t('replies_expand', { count: replyCount }) : t('reply_expand')}
      </button>
    </div>
  );
}
