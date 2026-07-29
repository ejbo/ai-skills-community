'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

/** Slide-over panel inside the reader shell (absolute within the fixed root). */
export function Drawer({
  open,
  side,
  title,
  onClose,
  children,
  widthClass = 'w-[320px]',
}: {
  open: boolean;
  side: 'left' | 'right';
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // aria-modal promises the background is inert — move focus into the panel on
  // open, keep Tab inside it, and hand focus back to the opener on close.
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      const t = window.setTimeout(() => panelRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    const prev = returnFocusRef.current;
    returnFocusRef.current = null;
    if (prev && document.contains(prev)) prev.focus();
    return undefined;
  }, [open]);

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-30 bg-black/30"
            onClick={onClose}
          />
          <motion.aside
            key="panel"
            ref={panelRef}
            tabIndex={-1}
            onKeyDown={trapTab}
            initial={{ x: side === 'left' ? '-100%' : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'left' ? '-100%' : '100%' }}
            transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
            role="dialog"
            aria-modal="true"
            className={`reader-panel absolute inset-y-0 z-40 flex max-w-[85vw] flex-col shadow-2xl outline-none ${widthClass} ${
              side === 'left' ? 'left-0 border-r rborder' : 'right-0 border-l rborder'
            }`}
          >
            <div className="rborder flex shrink-0 items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="r-muted grid h-7 w-7 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
