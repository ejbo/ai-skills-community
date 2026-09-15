'use client';

// 文字样式 — ONE toolbar trigger for text colour, background, font size, font
// family and 清除格式. One button on purpose: the composer toolbar already
// wraps to three rows on a 390 px phone, and colour belongs in the compact
// comment boxes too, so four separate buttons were never an option.
//
// The popover is PORTALED (the editor root is `overflow-hidden`, and composers
// sit inside transformed cards / drawers) and anchored through the shared
// `useAnchoredPanel` — flip above when there is no room below, clamp to the
// viewport, re-measure on scroll, close when the trigger scrolls away or on an
// outside pointerdown. Every control swallows `mousedown`, so the editor keeps
// its selection while the author picks: the formatting lands on exactly the
// text that was selected, and an EMPTY selection sets the format for whatever
// is typed next (tiptap's setMark stores the mark).
//
// Swatches paint with the SAME CSS variables as the stored spans
// (app/rich-text.css), so the menu previews the colour the reader will see on
// this theme. With `tone="reader"` the panel is portaled into the enclosing
// `.reader-root` instead of <body>: the 知识库 reader has its own theme axis and
// both its chrome variables and its palette tokens only exist inside that root.
//
// The panel also keeps OFF the selection it formats (components/editor/avoid-selection.ts):
// anchored under a sticky toolbar it opened right on top of the first lines of
// the text, and a mouse user — for whom it stays open between picks — chose
// colour, background, size and font without seeing any of them applied. It is
// re-placed after every transaction while open, since 字号 / 字体 grow the
// selection under it.
//
// Motion: none. Menus never animate in this app (lib/motion.ts budget).

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { posToDOMRect, type Editor } from '@tiptap/core';
import { Baseline, Check, RemoveFormatting } from 'lucide-react';
import { useAnchoredPanel, visibleViewport } from '@/components/useAnchoredPanel';
import { panelAvoidingSelection, type PanelBox } from '@/components/editor/avoid-selection';
import { activeRichMarkValue, applyRichMark } from '@/components/editor/format-marks';
import {
  RICH_BG_COLORS,
  RICH_FONT_FAMILIES,
  RICH_FONT_SIZES,
  RICH_TEXT_COLORS,
  type RichMarkKind,
} from '@/lib/rich-marks';

export interface TextStyleMenuProps {
  editor: Editor;
  /** 'full' adds 字号 + 字体; 'compact' (comment boxes) keeps colour, background and 清除格式. */
  variant: 'full' | 'compact';
  disabled?: boolean;
  /** 'reader' = inside the 知识库 reader (its own theme variables). */
  tone?: 'default' | 'reader';
}

type Active = { color: string | null; bg: string | null; size: string | null; font: string | null };

const NONE: Active = { color: null, bg: null, size: null, font: null };

function readActive(editor: Editor): Active {
  if (editor.isDestroyed) return NONE;
  return {
    color: activeRichMarkValue(editor, 'color'),
    bg: activeRichMarkValue(editor, 'bg'),
    size: activeRichMarkValue(editor, 'size'),
    font: activeRichMarkValue(editor, 'font'),
  };
}

const sameActive = (a: Active, b: Active) => a.color === b.color && a.bg === b.bg && a.size === b.size && a.font === b.font;

/** Preview size of the 字号 labels — the stored sizes are em, so these are relative to the 13 px label. */
const SIZE_PREVIEW: Record<string, string> = { default: '13px', sm: '11.5px', lg: '15.5px', xl: '18px' };

const FONT_PREVIEW: Record<string, string | undefined> = {
  default: undefined,
  serif: 'var(--rt-font-serif)',
  kai: 'var(--rt-font-kai)',
  mono: 'var(--rt-font-mono)',
};

const PANEL_W = 264;

export function TextStyleMenu({ editor, variant, disabled = false, tone = 'default' }: TextStyleMenuProps) {
  const t = useTranslations('ui');
  const full = variant === 'full';
  const reader = tone === 'reader';

  // The toolbar re-renders with the editor today, but the trigger's colour bar
  // must not depend on the parent's render policy — subscribe, and only set
  // state when the active formats actually change.
  const [active, setActive] = useState<Active>(() => readActive(editor));
  useEffect(() => {
    const sync = () => setActive((prev) => {
      const next = readActive(editor);
      return sameActive(prev, next) ? prev : next;
    });
    sync();
    editor.on('transaction', sync);
    return () => {
      editor.off('transaction', sync);
    };
  }, [editor]);

  const panel = useAnchoredPanel<HTMLButtonElement>({ width: PANEL_W, height: full ? 348 : 210, align: 'left' });
  const { open, toggle, close, pos, triggerRef, panelRef, host: bodyHost } = panel;

  // Where the panel actually goes: the hook's anchored spot, moved off the selection.
  const [placed, setPlaced] = useState<PanelBox | null>(null);
  const selection = editor.state.selection;
  useLayoutEffect(() => {
    if (!open || !pos) {
      setPlaced(null);
      return;
    }
    const el = panelRef.current;
    let rect: DOMRect | null = null;
    if (!selection.empty && !editor.isDestroyed) {
      try {
        rect = posToDOMRect(editor.view, selection.from, selection.to);
      } catch {
        rect = null; // no layout (a detached view)
      }
    }
    const base: PanelBox = { left: pos.left, top: pos.top, width: el?.offsetWidth || PANEL_W, height: el?.offsetHeight || (full ? 348 : 210), maxHeight: pos.maxHeight };
    const next = panelAvoidingSelection(base, rect && rect.width + rect.height > 0 ? rect : null, visibleViewport());
    setPlaced((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight ? prev : next));
  }, [open, pos, selection, editor, panelRef, full]);

  // Portal target: the reader root for tone="reader" (see header), else what
  // the hook picked (the fullscreen element, or <body>).
  const [readerHost, setReaderHost] = useState<Element | null>(null);
  useEffect(() => {
    if (reader) setReaderHost(triggerRef.current?.closest('.reader-root') ?? null);
  }, [reader, triggerRef]);
  const host = (reader && readerHost) || bodyHost;

  // The editor became read-only (submitting, permission lost) while the menu was up.
  useEffect(() => {
    if (disabled && open) close(false);
  }, [disabled, open, close]);

  // Esc returns to the EDITOR, not the trigger: the author opened the menu
  // mid-sentence and the caret is where they want to keep typing. Capture on
  // window so this runs before the hook's own document listener (which would
  // move focus onto the toolbar button).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      close(false);
      editor.commands.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close, editor]);

  // Opened from the keyboard ⇒ put focus on the first control so Tab / Enter
  // work; opened with a pointer ⇒ leave focus in the editor.
  const openedByKeyboard = useRef(false);
  useEffect(() => {
    if (!open || !openedByKeyboard.current || !pos) return;
    openedByKeyboard.current = false;
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open, pos, panelRef]);

  // Touch: close after each pick (the panel covers the text being formatted).
  // Mouse: stay open so colour + background can be picked in one visit.
  // Keyboard: close too — applying refocuses the editor, so the panel would
  // otherwise be left open with nothing focused inside it.
  const lastPointer = useRef<string>('mouse');
  const notePointer = useCallback((e: React.PointerEvent) => {
    lastPointer.current = e.pointerType;
  }, []);
  // mousedown (not pointerdown) is what moves focus out of the editor; cancelling
  // pointerdown instead would also swallow the compatibility mouse events.
  const keepSelection = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const afterAction = (e: React.MouseEvent) => {
    const viaKeyboard = e.detail === 0;
    if (viaKeyboard || lastPointer.current === 'touch') close(false);
    lastPointer.current = 'mouse';
  };

  const pick = (kind: RichMarkKind, value: string | null) => (e: React.MouseEvent) => {
    applyRichMark(editor, kind, value);
    afterAction(e);
  };

  const clearAll = (e: React.MouseEvent) => {
    editor.chain().focus().clearRichFormatting().run();
    afterAction(e);
  };

  const chrome = reader
    ? 'border-[var(--reader-border)] bg-[var(--reader-surface)] text-[var(--reader-fg)]'
    : 'border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100';
  const muted = reader ? 'text-[var(--reader-muted)]' : 'text-zinc-500 dark:text-zinc-400';
  const hover = reader ? 'hover:bg-[var(--reader-hover)]' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800';
  const ring = reader
    ? 'ring-2 ring-[var(--reader-fg)]'
    : 'ring-2 ring-zinc-900 dark:ring-zinc-100';
  const hairline = reader ? 'border-[var(--reader-border)]' : 'border-zinc-200 dark:border-zinc-800';
  const tile = reader ? 'border-[var(--reader-border)]' : 'border-zinc-200 dark:border-zinc-700';
  const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]';

  const triggerCls = reader
    ? `text-[var(--reader-muted)] hover:bg-[var(--reader-hover)] hover:text-[var(--reader-fg)] ${open ? 'bg-[var(--reader-hover)] text-[var(--reader-fg)]' : ''}`
    : open || active.color || active.bg || active.size || active.font
      ? 'bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50'
      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';

  const sectionTitle = `mb-1.5 text-[11px] font-medium ${muted}`;
  const idBase = `rte-ts-${useId().replace(/:/g, '')}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={t('rte_text_style')}
        aria-label={t('rte_text_style')}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={(e) => {
          if (!open && e.detail === 0) openedByKeyboard.current = true;
          toggle();
        }}
        className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${triggerCls}`}
      >
        <Baseline className="h-4 w-4" aria-hidden />
        {/* The icon's own baseline stroke, repainted in the active text colour. */}
        {active.color && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-[8.5px] right-[8.5px] top-[18px] h-[2.5px] rounded-full"
            style={{ backgroundColor: `rgb(var(--rt-c-${active.color}))` }}
          />
        )}
      </button>

      {open &&
        pos &&
        host &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t('rte_text_style')}
            // z-[100]: the StickerPicker's layer — above sticky toolbars, drawers and dialogs that host an editor.
            className={`fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border p-3 shadow-xl ${chrome}`}
            // No mousedown capture on the container itself — only the controls
            // keep the editor selection, so the panel is never a black hole for
            // a press that starts on its padding.
            style={{
              left: (placed ?? pos).left,
              top: (placed ?? pos).top,
              maxHeight: (placed ?? pos).maxHeight,
              width: `min(${PANEL_W}px, calc(100vw - 16px))`,
            }}
          >
            {/* 文字颜色 */}
            <div role="group" aria-labelledby={`${idBase}-color`}>
              <div id={`${idBase}-color`} className={sectionTitle}>
                {t('rte_text_color')}
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  title={t('rte_color_default')}
                  aria-label={t('rte_color_default')}
                  aria-pressed={active.color == null}
                  onPointerDown={notePointer}
                  onMouseDown={keepSelection}
                  onClick={pick('color', null)}
                  className={`relative flex h-8 items-center justify-center rounded-md border text-[15px] font-semibold ${tile} ${hover} ${focus} ${
                    active.color == null ? ring : ''
                  }`}
                >
                  {active.color == null ? <Check className="h-4 w-4" aria-hidden /> : <span aria-hidden>A</span>}
                </button>
                {RICH_TEXT_COLORS.map((c) => {
                  const on = active.color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      title={t(`rte_color_${c}`)}
                      aria-label={t(`rte_color_${c}`)}
                      aria-pressed={on}
                      onPointerDown={notePointer}
                      onMouseDown={keepSelection}
                      onClick={pick('color', c)}
                      className={`relative flex h-8 items-center justify-center rounded-md border text-[15px] font-semibold ${tile} ${hover} ${focus} ${
                        on ? ring : ''
                      }`}
                      style={{ color: `rgb(var(--rt-c-${c}))` }}
                    >
                      {on ? <Check className="h-4 w-4" aria-hidden /> : <span aria-hidden>A</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 背景色 */}
            <div role="group" aria-labelledby={`${idBase}-bg`} className="mt-3">
              <div id={`${idBase}-bg`} className={sectionTitle}>
                {t('rte_bg_color')}
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  title={t('rte_bg_none')}
                  aria-label={t('rte_bg_none')}
                  aria-pressed={active.bg == null}
                  onPointerDown={notePointer}
                  onMouseDown={keepSelection}
                  onClick={pick('bg', null)}
                  className={`relative flex h-8 items-center justify-center overflow-hidden rounded-md border ${tile} ${hover} ${focus} ${
                    active.bg == null ? ring : ''
                  }`}
                >
                  {active.bg == null ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    // "none": a hairline slash through an empty tile.
                    <span aria-hidden className={`h-px w-[140%] -rotate-[32deg] ${reader ? 'bg-[var(--reader-muted)]' : 'bg-zinc-400'}`} />
                  )}
                </button>
                {RICH_BG_COLORS.map((c) => {
                  const on = active.bg === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      title={t(`rte_color_${c}`)}
                      aria-label={t(`rte_color_${c}`)}
                      aria-pressed={on}
                      onPointerDown={notePointer}
                      onMouseDown={keepSelection}
                      onClick={pick('bg', c)}
                      className={`relative flex h-8 items-center justify-center rounded-md border border-transparent ${focus} ${on ? ring : ''}`}
                      style={{ backgroundColor: `rgb(var(--rt-bg-${c}) / var(--rt-bg-a))` }}
                    >
                      {on && <Check className="h-4 w-4" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>

            {full && (
              <>
                {/* 字号 */}
                <div role="group" aria-labelledby={`${idBase}-size`} className="mt-3">
                  <div id={`${idBase}-size`} className={sectionTitle}>
                    {t('rte_font_size')}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(['default', ...RICH_FONT_SIZES] as const).map((s) => {
                      const on = s === 'default' ? active.size == null : active.size === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={on}
                          onPointerDown={notePointer}
                          onMouseDown={keepSelection}
                          onClick={pick('size', s === 'default' ? null : s)}
                          className={`flex h-8 min-w-0 items-center justify-center rounded-md px-1 leading-none ${hover} ${focus} ${
                            on ? (reader ? 'bg-[var(--reader-hover)] font-semibold' : 'bg-zinc-900/[0.06] font-semibold dark:bg-white/10') : ''
                          }`}
                          style={{ fontSize: SIZE_PREVIEW[s] }}
                        >
                          <span className="truncate">{t(`rte_size_${s}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 字体 */}
                <div role="group" aria-labelledby={`${idBase}-font`} className="mt-3">
                  <div id={`${idBase}-font`} className={sectionTitle}>
                    {t('rte_font_family')}
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(['default', ...RICH_FONT_FAMILIES] as const).map((f) => {
                      const on = f === 'default' ? active.font == null : active.font === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={on}
                          onPointerDown={notePointer}
                          onMouseDown={keepSelection}
                          onClick={pick('font', f === 'default' ? null : f)}
                          className={`flex h-8 min-w-0 items-center justify-center rounded-md px-1 text-[13px] leading-none ${hover} ${focus} ${
                            on ? (reader ? 'bg-[var(--reader-hover)] font-semibold' : 'bg-zinc-900/[0.06] font-semibold dark:bg-white/10') : ''
                          }`}
                          style={{ fontFamily: FONT_PREVIEW[f] }}
                        >
                          <span className="truncate">{t(`rte_font_${f}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* 清除格式 */}
            <div className={`mt-3 border-t pt-2 ${hairline}`}>
              <button
                type="button"
                onPointerDown={notePointer}
                onMouseDown={keepSelection}
                onClick={clearAll}
                className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] ${hover} ${focus}`}
              >
                <RemoveFormatting className={`h-4 w-4 ${muted}`} aria-hidden />
                {t('rte_clear_format')}
              </button>
            </div>
          </div>,
          host,
        )}
    </>
  );
}

export default TextStyleMenu;
