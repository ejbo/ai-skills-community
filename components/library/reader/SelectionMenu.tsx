'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Languages, StickyNote, Sparkles, Trash2 } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { pushToast } from '@/components/Toaster';
import { getTextOffsetOfPoint } from './anchoring';

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

/** Floating menu above a text selection inside a chapter article. */
export function SelectionMenu({
  getContext,
  onHighlight,
  onNote,
  onAskAi,
  onTranslate,
}: {
  /** Resolve the chapter root containing a DOM node (null = outside articles). */
  getContext: (node: Node) => SelectionContext | null;
  onHighlight: (payload: SelectionPayload, color: HighlightColor) => void;
  onNote: (payload: SelectionPayload) => void;
  onAskAi: (quote: string) => void;
  /** Selection translation — anchored near the menu position. */
  onTranslate: (text: string, anchor: { top: number; left: number }) => void;
}) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!getContext(range.commonAncestorContainer) || !sel.toString().trim()) {
      setPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setPos({
      top: Math.max(64, rect.top - 10),
      left: Math.min(Math.max(rect.left + rect.width / 2, 130), window.innerWidth - 130),
    });
  }, [getContext]);

  useEffect(() => {
    const onUp = (e: Event) => {
      // Ignore pointer-ups on the menu itself (clicking a button collapses nothing).
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      window.setTimeout(refresh, 0);
    };
    const onSelChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPos(null);
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('selectionchange', onSelChange);
    };
  }, [refresh]);

  function capture(): SelectionPayload | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    // Re-validate containment: the selection may have escaped the article since
    // refresh() (Ctrl+A / Shift+End extend without a mouseup) — offsets computed
    // against outside points would store a permanently unanchorable highlight.
    const ctx = getContext(range.commonAncestorContainer);
    if (!ctx) return null;
    const full = sel.toString().replace(/\s+/g, ' ').trim();
    if (!full) return null;
    const quote = full.slice(0, 300);
    const charStart = getTextOffsetOfPoint(ctx.root, range.startContainer, range.startOffset);
    let charEnd = getTextOffsetOfPoint(ctx.root, range.endContainer, range.endOffset);
    if (full.length > 300) {
      // Keep the stored span consistent with the truncated (= painted) quote.
      charEnd = Math.min(charEnd, charStart + quote.length);
      pushToast('info', t('highlight_truncated'));
    }
    return { chapterIndex: ctx.chapterIndex, quote, charStart, charEnd: Math.max(charEnd, charStart + 1) };
  }

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
      className="reader-panel rborder fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-xl border px-2.5 py-2 shadow-xl"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={t('highlight_color', { color })}
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
      onClick={onClick}
      className="r-muted grid h-7 w-7 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)] hover:text-[var(--reader-accent)]"
    >
      {children}
    </button>
  );
}

/** Popover shown when clicking an existing highlight mark: recolor / note / delete. */
export function MarkPopover({
  top,
  left,
  currentColor,
  onRecolor,
  onNote,
  onDelete,
  onClose,
}: {
  top: number;
  left: number;
  currentColor: string;
  onRecolor: (color: HighlightColor) => void;
  onNote: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
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
      role="toolbar"
      aria-label={t('highlight_toolbar')}
      className="reader-panel rborder fixed z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border px-2.5 py-2 shadow-xl"
      style={{
        top: Math.min(top, typeof window !== 'undefined' ? window.innerHeight - 56 : top),
        left: Math.min(Math.max(left, 110), typeof window !== 'undefined' ? window.innerWidth - 110 : left),
      }}
    >
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
      <MenuButton label={t('note')} onClick={onNote}>
        <StickyNote className="h-4 w-4" />
      </MenuButton>
      <MenuButton label={tc('delete')} onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
      </MenuButton>
    </div>
  );
}
