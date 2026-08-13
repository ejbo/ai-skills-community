'use client';

// Popovers for EXISTING marks. There is deliberately NO floating selection
// toolbar here any more: an opaque `fixed` panel positioned over the article —
// preventDefault-ing mousedown so its own buttons could act on the live
// selection — is exactly what made text under it unselectable. Selecting text
// in the reader is now 100% the browser's own behaviour, with nothing rendered
// over the text and nothing listening on the way down.
//
// Acting on a selection lives in the 我的笔记 panel (which reads the selection
// passively, on mouseup) and on the 1-4 / N keyboard shortcuts.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, StickyNote, Trash2 } from 'lucide-react';

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
