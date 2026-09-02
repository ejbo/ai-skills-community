'use client';

// 技术专区 — the ⋯ menu on a member card. Management (role / 头衔 / 移除) sits
// BEHIND this trigger so the directory reads as people first and controls
// second; MemberCard owns the mutations and passes the panel content in as a
// render function that receives `close`.
//
// Portaled + anchored through `useAnchoredPanel` (the same placement the zone
// header menus use): a card is `card-hover`, whose transform would trap an
// absolutely positioned panel, and a grid of cards clips it anyway.

import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Ellipsis } from 'lucide-react';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';
import { TWEEN_FAST } from '@/lib/motion';
import { BTN_ICON } from './ui';

const PANEL_W = 240;

export function MemberMenu({
  label,
  disabled = false,
  estimatedHeight = 160,
  onClose,
  children,
}: {
  /** Accessible name of the trigger and the panel (`members_menu`). */
  label: string;
  disabled?: boolean;
  /** First-paint height estimate; the hook measures the real panel once mounted. */
  estimatedHeight?: number;
  /** Fires whenever the panel closes (outside click, Escape, an item) — reset transient state here. */
  onClose?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const reduce = useReducedMotion();
  const panelId = useId();
  const { open, openPanel, close, pos, triggerRef, panelRef, host } = useAnchoredPanel<HTMLButtonElement>({
    width: PANEL_W,
    height: estimatedHeight,
    onClose,
  });

  // Portaling drops the panel out of the tab order: move focus in on open.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('select, button, input, a[href]');
      first?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, panelRef]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openPanel())}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        title={label}
        className={BTN_ICON}
      >
        <Ellipsis className="h-4 w-4" />
      </button>
      {host &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={panelRef}
                id={panelId}
                role="group"
                aria-label={label}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') close(true);
                }}
                initial={{ opacity: 0, y: reduce ? 0 : pos.up ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : pos.up ? 4 : -4 }}
                transition={reduce ? { duration: 0 } : TWEEN_FAST}
                // z-[70]: matches the zone header menus — above the sticky NavBar, below dialogs.
                className="surface fixed z-[70] w-60 overflow-y-auto overscroll-contain rounded-xl p-2 shadow-lg"
                style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
              >
                {children(() => close(true))}
              </motion.div>
            )}
          </AnimatePresence>,
          host,
        )}
    </>
  );
}
