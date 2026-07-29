'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, StickyNote, Sparkles, Trash2 } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { pushToast } from '@/components/Toaster';
import { getTextOffsetOfPoint } from './anchoring';

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface SelectionPayload {
  quote: string;
  charStart: number;
  charEnd: number;
}

/** Floating menu above a text selection inside the article. */
export function SelectionMenu({
  articleRef,
  onHighlight,
  onNote,
  onAskAi,
}: {
  articleRef: React.RefObject<HTMLElement>;
  onHighlight: (payload: SelectionPayload, color: HighlightColor) => void;
  onNote: (payload: SelectionPayload) => void;
  onAskAi: (quote: string) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const sel = window.getSelection();
    const article = articleRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !article) {
      setPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer) || !sel.toString().trim()) {
      setPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setPos({
      top: Math.max(64, rect.top - 10),
      left: Math.min(Math.max(rect.left + rect.width / 2, 130), window.innerWidth - 130),
    });
  }, [articleRef]);

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
    const article = articleRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !article) return null;
    const range = sel.getRangeAt(0);
    // Re-validate containment: the selection may have escaped the article since
    // refresh() (Ctrl+A / Shift+End extend without a mouseup) — offsets computed
    // against outside points would store a permanently unanchorable highlight.
    if (!article.contains(range.commonAncestorContainer)) return null;
    const full = sel.toString().replace(/\s+/g, ' ').trim();
    if (!full) return null;
    const quote = full.slice(0, 300);
    const charStart = getTextOffsetOfPoint(article, range.startContainer, range.startOffset);
    let charEnd = getTextOffsetOfPoint(article, range.endContainer, range.endOffset);
    if (full.length > 300) {
      // Keep the stored span consistent with the truncated (= painted) quote.
      charEnd = Math.min(charEnd, charStart + quote.length);
      pushToast('info', '划线最长 300 字，已截取开头部分');
    }
    return { quote, charStart, charEnd: Math.max(charEnd, charStart + 1) };
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
      aria-label="选中文本操作"
      className="reader-panel rborder fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-xl border px-2.5 py-2 shadow-xl"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`高亮（${color}）`}
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
        label="笔记"
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
        label="复制"
        onClick={async () => {
          const text = window.getSelection()?.toString() ?? '';
          const ok = text ? await copyText(text) : false;
          pushToast(ok ? 'success' : 'error', ok ? '已复制' : '复制失败');
          dismiss(false);
        }}
      >
        <Copy className="h-4 w-4" />
      </MenuButton>
      <MenuButton
        label="问 AI"
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
      aria-label="高亮操作"
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
          aria-label={`改为${color}`}
          onClick={() => onRecolor(color)}
          className={`hl-dot-${color} h-5 w-5 rounded-full transition hover:scale-110 ${
            currentColor === color ? 'ring-2 ring-accent-500/60 ring-offset-1' : ''
          }`}
        />
      ))}
      <span className="rborder mx-0.5 h-4 w-px border-l" />
      <MenuButton label="笔记" onClick={onNote}>
        <StickyNote className="h-4 w-4" />
      </MenuButton>
      <button
        type="button"
        aria-label="删除高亮"
        title="删除高亮"
        onClick={onDelete}
        className="grid h-7 w-7 place-items-center rounded-lg text-danger transition hover:bg-danger/10"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
