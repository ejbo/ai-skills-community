'use client';

// alphaXiv-style selection toolbar: a small floating pill that appears where
// you finished selecting, carrying the verbs that act on a passage —
// 高亮 / 笔记 / 翻译 / 问 AI / 复制. Everything is CLICKABLE; the keyboard
// shortcuts are a shortcut, never the only way in.
//
// This used to be blamed for the reader's unselectable text and was deleted.
// The real cause was React rewriting the article's innerHTML on every render
// (see ReaderContent), which is fixed. What IS kept from that lesson:
//   • the container never preventDefaults mousedown — only the buttons do, so
//     the toolbar is not a black hole that swallows the next drag;
//   • any mousedown outside dismisses it immediately;
//   • it is positioned from TEXT rects (never Range.getClientRects, which also
//     returns block border boxes) and flips below when there is no room above.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Languages, Loader2, Sparkles, StickyNote, X } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { pushToast } from '@/components/Toaster';
import { textRects } from './anchoring';
import { HIGHLIGHT_COLORS, type HighlightColor, type SelectionPayload } from './MarkPopover';

/** Toolbar height incl. padding — decides whether it fits above the selection. */
const PILL_H = 44;
const GAP = 10;

interface Placement {
  top: number;
  left: number;
  /** true ⇒ sits ABOVE the selection (translated up by its own height). */
  above: boolean;
}

function placeFor(range: Range): Placement | null {
  const rects = textRects(range);
  const first = rects[0];
  const last = rects[rects.length - 1] ?? first;
  if (!first) return null;
  const clampX = (x: number) => Math.min(Math.max(x, 150), window.innerWidth - 150);
  if (first.top - PILL_H - GAP >= 56) {
    return { top: first.top - GAP, left: clampX(first.left + first.width / 2), above: true };
  }
  return {
    top: Math.min(last.bottom + GAP, window.innerHeight - PILL_H - 8),
    left: clampX(last.left + last.width / 2),
    above: false,
  };
}

export interface TranslationResult {
  text: string;
  /** True when it came straight from the shared cache — no model call, no wait. */
  cached: boolean;
}

export function SelectionToolbar({
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
  onTranslate: (text: string) => Promise<TranslationResult>;
}) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const [pos, setPos] = useState<Placement | null>(null);
  const [translation, setTranslation] = useState<{
    loading: boolean;
    text: string | null;
    cached: boolean;
    error: string | null;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const inSelf = (target: EventTarget | null) =>
    ref.current && target instanceof Node && ref.current.contains(target);

  const refresh = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim() || !capture()) {
      setPos(null);
      setTranslation(null);
      return;
    }
    setPos(placeFor(sel.getRangeAt(0)));
  }, [capture]);

  // Keep up with the text. The pill is `fixed`, so without this it stays at the
  // viewport point where the selection USED to be — floating over unrelated
  // paragraphs. Recomputed from the live selection on every scroll (capture
  // phase, because the reader scrolls an inner container, not the window), and
  // hidden once the selection leaves the viewport.
  useEffect(() => {
    if (!pos) return;
    const reposition = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const next = placeFor(sel.getRangeAt(0));
      setPos(next && next.top > 8 && next.top < window.innerHeight - 8 ? next : null);
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [pos]);

  useEffect(() => {
    const onUp = (e: Event) => {
      if (inSelf(e.target)) return;
      window.setTimeout(refresh, 0);
    };
    // Dismiss on ANY outside press, so the toolbar can never sit over the text
    // absorbing the mousedown that would start the next selection.
    const onDown = (e: Event) => {
      if (inSelf(e.target)) return;
      setPos(null);
      setTranslation(null);
    };
    const onSelChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPos(null);
        setTranslation(null);
      }
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

  const dismiss = (clearSelection: boolean) => {
    if (clearSelection) window.getSelection()?.removeAllRanges();
    setPos(null);
    setTranslation(null);
  };

  const runTranslate = async () => {
    const text = (window.getSelection()?.toString() ?? '').trim();
    if (!text) return dismiss(true);
    setTranslation({ loading: true, text: null, cached: false, error: null });
    try {
      const res = await onTranslate(text);
      setTranslation({ loading: false, text: res.text, cached: res.cached, error: null });
    } catch (e) {
      setTranslation({
        loading: false,
        text: null,
        cached: false,
        error: (e as Error).message || t('translate_failed_retry'),
      });
    }
  };

  if (!pos) return null;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t('selection_toolbar')}
      className={`reader-panel rborder fixed z-50 -translate-x-1/2 rounded-xl border shadow-xl ${
        pos.above ? '-translate-y-full' : ''
      } ${translation ? 'w-[min(360px,calc(100vw-24px))]' : ''}`}
      style={{ top: pos.top, left: pos.left }}
    >
      {translation ? (
        <div className="p-3">
          <div className="flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5 text-[var(--reader-accent)]" />
            <span className="text-xs font-semibold">{t('translate')}</span>
            {translation.cached && (
              <span className="r-muted inline-flex items-center gap-0.5 text-[10px]">
                <Check className="h-3 w-3" />
                {t('translate_from_cache')}
              </span>
            )}
            <ToolButton label={tc('dismiss')} onClick={() => setTranslation(null)} className="ml-auto">
              <X className="h-3.5 w-3.5" />
            </ToolButton>
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto text-sm leading-relaxed">
            {translation.loading ? (
              <span className="r-muted flex items-center gap-1.5 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('translating')}
              </span>
            ) : translation.error ? (
              <span className="text-xs text-danger">{translation.error}</span>
            ) : (
              <p className="whitespace-pre-wrap">{translation.text}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          {HIGHLIGHT_COLORS.map((color, i) => (
            <button
              key={color}
              type="button"
              title={`${t('highlight_color', { color })} (${i + 1})`}
              aria-label={t('highlight_color', { color })}
              // Per-BUTTON only: keeps the selection alive for this click without
              // making the whole pill deaf to mousedown.
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
          <ToolButton
            label={t('note')}
            onClick={() => {
              const payload = capture();
              if (!payload) return dismiss(true);
              onNote(payload);
              dismiss(true);
            }}
          >
            <StickyNote className="h-4 w-4" />
          </ToolButton>
          <ToolButton label={t('translate')} onClick={() => void runTranslate()}>
            <Languages className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            label={t('ask_ai_short')}
            onClick={() => {
              const payload = capture();
              if (!payload) return dismiss(true);
              onAskAi(payload.quote);
              dismiss(true);
            }}
          >
            <Sparkles className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            label={tc('copy')}
            onClick={async () => {
              const text = window.getSelection()?.toString() ?? '';
              const ok = text ? await copyText(text) : false;
              pushToast(ok ? 'success' : 'error', ok ? tc('copied') : tc('copy_failed'));
              dismiss(false);
            }}
          >
            <Copy className="h-4 w-4" />
          </ToolButton>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`r-muted grid h-7 w-7 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)] hover:text-[var(--reader-accent)] ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
