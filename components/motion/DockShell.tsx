'use client';

// Non-modal docked aside for the 技术专区 reading panel — the counterpart of
// DrawerShell for a surface that must stay side-by-side with the page:
//   - sticky `h-dvh` column in the host's flex row (NOT fixed: sticky needs no
//     padding bookkeeping on <main>, is unaffected by NavBarShell's transform,
//     and keeps the document scroll for the article); `z-30`, UNDER the navbar
//     (z-40). It starts `-NAV_BAR_HEIGHT_PX` above its row so it fills the
//     viewport from y=0 at every scroll position, with `paddingTop` reserving
//     the bar's strip while the bar is held visible (0 in expand / maximize);
//   - no scrim, no body scroll lock, no `aria-modal`, no focus trap
//     (`role="complementary"`) — the page beside it stays fully usable;
//   - open / close tween the aside's WIDTH (`0 ↔ W`, TWEEN_PANE) while the inner
//     column stays pinned at the committed width, so the tween only clips and
//     the PDF iframe inside never reflows 60×; a drag writes the width straight
//     to the DOM through the bound MotionValue (useSplitResize) — no tween;
//   - the sash is a zero-width sticky SIBLING straddling the aside's left
//     border (the aside is overflow-hidden, so an inner sash would lose the
//     half of its hit area that sits over the page); while dragging a
//     transparent shield covers the page so the PDF plugin cannot swallow
//     `pointermove`, and the iframe is hidden (visibility, never
//     pointer-events:none — Chrome leaves wheel scrolling broken afterwards);
//   - expand mode (`expanded`): the aside takes 100% of the row, the sash hides,
//     the host makes the page `inert`.
// Generic on purpose — every label comes in as a prop, translated by the host.

import { AnimatePresence, motion, useMotionValue } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { BTN_ICON } from '@/app/zones/_components/ui';
import { useSplitResize } from '@/components/zones/preview/useSplitResize';
import { TWEEN_FAST, TWEEN_PANE } from '@/lib/motion';
import { NAV_BAR_HEIGHT_PX } from '@/lib/nav-chrome';

export interface DockShellProps {
  /** aria-controls target of the separator and of openers. */
  id: string;
  /** Committed px; the aside rests at `style={{ width }}`. */
  width: number;
  onWidthCommit: (w: number) => void;
  onClose: () => void;
  title: ReactNode;
  /** 16 px lucide icon, left of the title. */
  kindIcon?: ReactNode;
  /** Host slots after the title: ↑/↓ n/N · ⤢ · ⛶ · ↗. */
  headerExtra?: ReactNode;
  bodyMode: 'scroll' | 'fill';
  footer?: ReactNode;
  /** ⤢ mode: the aside grows to 100% of the flex row; the sash is hidden. */
  expanded?: boolean;
  /** px reserved for the navbar (68 while the bar is REALLY on screen; 0 in expand / maximize, and whenever a hidden hold beats the dock's visible hold — the composer). */
  topOffset: number;
  /** Host slot BEFORE the icon (← back). */
  headerStart?: ReactNode;
  /** Keyboard-opened frames: focus the ✕ in a rAF on mount. */
  autoFocusClose?: boolean;
  /** Translated by the host (panel_close / panel_resize / panel_aria / panel_keyboard_hint). */
  labels: { close: string; resize: string; region: string; keyboardHint?: string };
  /** `useReducedMotion()` from the host — config only. */
  reduce: boolean;
  children: ReactNode;
}

// Chrome's out-of-process PDF plugin can still eat `pointermove` under the
// shield; hiding the iframe (layout kept) for the drag's duration is the
// documented last resort (ref-tech §1.3) and stays ON.
const HIDE_IFRAME_WHILE_DRAGGING = true;

const SASH_RULE =
  'absolute inset-y-0 left-[5px] w-px bg-transparent transition-[width,background-color] delay-200 duration-150 motion-reduce:transition-none ' +
  'group-hover:w-[2px] group-hover:bg-zinc-900 group-focus-visible:w-[2px] group-focus-visible:bg-zinc-900 ' +
  'group-data-[dragging]:w-[2px] group-data-[dragging]:bg-zinc-900 group-data-[dragging]:delay-0 ' +
  'dark:group-hover:bg-zinc-100 dark:group-focus-visible:bg-zinc-100 dark:group-data-[dragging]:bg-zinc-100';

export function DockShell({
  id,
  width,
  onWidthCommit,
  onClose,
  title,
  kindIcon,
  headerExtra,
  bodyMode,
  footer,
  expanded = false,
  topOffset,
  headerStart,
  autoFocusClose = false,
  labels,
  reduce,
  children,
}: DockShellProps) {
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Bound to the aside's width so the drag, the snap-back spring and the
  // open / close / expand tweens all move ONE value (no drift between them).
  const widthValue = useMotionValue(width);
  const { dragging, separatorProps } = useSplitResize(asideRef, {
    reduce,
    onCommit: onWidthCommit,
    initial: width,
    value: widthValue,
  });

  useEffect(() => {
    if (!autoFocusClose) return;
    const raf = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [autoFocusClose]);

  const paneTransition = reduce ? { duration: 0 } : TWEEN_PANE;
  const titleKey = typeof title === 'string' ? title : '';
  const restWidth = expanded ? '100%' : width;

  return (
    <>
      {!expanded && (
        <div className="sticky top-0 z-[31] h-dvh w-0 shrink-0" style={{ marginTop: -NAV_BAR_HEIGHT_PX }}>
          <div
            {...separatorProps}
            aria-controls={id}
            aria-label={labels.resize}
            title={labels.keyboardHint}
            data-dragging={dragging || undefined}
            className="group absolute inset-y-0 -left-[5px] w-[10px] cursor-col-resize touch-none outline-none"
          >
            <span aria-hidden className={SASH_RULE} />
          </div>
        </div>
      )}
      {dragging && <div className="fixed inset-0 z-[96] cursor-col-resize" aria-hidden />}
      <motion.aside
        ref={asideRef}
        id={id}
        role="complementary"
        aria-label={labels.region}
        data-dragging={dragging || undefined}
        className={`sticky top-0 z-30 h-dvh shrink-0 overflow-hidden border-l border-zinc-200 bg-white transition-[padding-top] duration-300 ease-out data-[dragging]:transition-none dark:border-zinc-800 dark:bg-zinc-950 ${
          HIDE_IFRAME_WHILE_DRAGGING ? '[&[data-dragging]_iframe]:invisible' : ''
        }`}
        style={{ width: widthValue, paddingTop: topOffset, marginTop: -NAV_BAR_HEIGHT_PX }}
        initial={{ width: 0 }}
        animate={{ width: restWidth }}
        exit={{ width: 0 }}
        transition={paneTransition}
      >
        {/* Inner column pinned at the committed width: the width tween only clips. */}
        <div className="flex h-full flex-col" style={{ width: restWidth }}>
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-zinc-200 px-2 dark:border-zinc-800">
            {headerStart}
            {kindIcon != null && (
              <span className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-400" aria-hidden>
                {kindIcon}
              </span>
            )}
            <div className="min-w-0 flex-1 px-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.h2
                  key={titleKey}
                  className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={reduce ? { duration: 0 } : TWEEN_FAST}
                >
                  {title}
                </motion.h2>
              </AnimatePresence>
            </div>
            {headerExtra}
            <button ref={closeRef} type="button" onClick={onClose} aria-label={labels.close} title={labels.close} className={BTN_ICON}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {bodyMode === 'fill' ? (
            <div data-dock-body className="flex min-h-0 flex-1 flex-col">
              {children}
            </div>
          ) : (
            <div data-dock-body className="min-h-0 flex-1 overflow-y-auto scroll-thin">
              {children}
            </div>
          )}
          {footer != null && <div className="shrink-0 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">{footer}</div>}
        </div>
      </motion.aside>
    </>
  );
}
