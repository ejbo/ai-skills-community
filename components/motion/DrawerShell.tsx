'use client';

import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { SPRING_DRAWER } from '@/lib/motion';

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Panel width cap in px (overrides the default `min(720px, 92vw)`; still capped at 92vw). */
  width?: number;
  side?: 'right' | 'left';
  footer?: ReactNode;
  /** Rendered between the title and the close button (tabs, actions). */
  headerExtra?: ReactNode;
  /** Accessible name of the close control (defaults to the translated common.dismiss). */
  closeLabel?: string;
  className?: string;
  /** Extra classes on the scrolling body. */
  bodyClassName?: string;
};

// Elements that must keep their own pointer behaviour — a drag never starts on them.
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="tab"], [data-no-drag]';

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE));
}

// Right-side preview/detail drawer. Portals to <body> (hub cards wear
// `.card-hover` / TiltCard transforms that would trap a fixed aside), scrim at
// z-[90] and panel at z-[95] — below ImageLightbox (z-100) and the Toaster
// (z-120). Client-only mount, so `initial` is fine here. Spring slide,
// swipe-to-close (touch anywhere on the panel, any pointer on the header),
// ESC, body scroll lock, focus moved into the panel and returned on close.
// A light scrim is right here (the drawer sits over a list, not over a video —
// the "no scrim" rule is specific to the shorts HostPanel).
export function DrawerShell({
  open,
  onClose,
  title,
  children,
  width,
  side = 'right',
  footer,
  headerExtra,
  closeLabel,
  className = '',
  bodyClassName = '',
}: Props) {
  const t = useTranslations('common');
  const reduce = useReducedMotion();
  const controls = useDragControls();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);
  const closeText = closeLabel ?? t('dismiss');
  const left = side === 'left';
  const offscreen = left ? '-100%' : '100%';

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC + body scroll lock + focus management, keyed on `open` only (an
  // unstable onClose must not re-run the lock or yank focus while open).
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
    };
  }, [open]);

  const startDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (reduce || isInteractive(e.target)) return;
    controls.start(e);
  };
  const startTouchDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') startDrag(e);
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.button
          key="scrim"
          type="button"
          aria-label={closeText}
          onClick={onClose}
          className="fixed inset-0 z-[90] cursor-default bg-zinc-900/20 dark:bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
        />
      )}
      {open && (
        <motion.div
          key="panel"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`fixed inset-y-0 z-[95] flex w-full max-w-[min(720px,92vw)] flex-col border-zinc-200 bg-white shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-950 ${
            left ? 'left-0 border-r' : 'right-0 border-l'
          } ${className}`}
          style={{ touchAction: 'pan-y', maxWidth: width ? `min(${width}px, 92vw)` : undefined }}
          initial={reduce ? { opacity: 0 } : { x: offscreen }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: offscreen }}
          transition={reduce ? { duration: 0.15 } : SPRING_DRAWER}
          drag={reduce ? false : 'x'}
          dragListener={false}
          dragControls={controls}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={left ? { left: 0.35, right: 0 } : { left: 0, right: 0.35 }}
          dragMomentum={false}
          onDragEnd={(_, info) => {
            const dir = left ? -1 : 1;
            if (info.offset.x * dir > 120 || info.velocity.x * dir > 600) onCloseRef.current();
          }}
          onPointerDown={startTouchDrag}
        >
          <div
            className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800"
            onPointerDown={startDrag}
          >
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {title}
            </h2>
            {headerExtra != null && <div className="flex min-w-0 shrink-0 items-center gap-2">{headerExtra}</div>}
            <button
              type="button"
              onClick={onClose}
              aria-label={closeText}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className={`min-h-0 flex-1 overflow-y-auto scroll-thin ${bodyClassName}`}>{children}</div>
          {footer != null && (
            <div className="shrink-0 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">{footer}</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
