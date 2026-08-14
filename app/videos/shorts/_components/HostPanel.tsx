'use client';

// In-host sliding panel shell shared by the shorts overlays (评论 sheet,
// TA 的作品). Design contract from user feedback:
//   - NO scrim: the click-catcher is TRANSPARENT, so the video never grays out
//     and keeps playing; clicking the video area closes the panel (抖音-style).
//   - It slides from INSIDE the player container (absolute within the host's
//     rounded overflow-hidden box), so panel and video read as one unit.
// Exit animation requires the HOST to wrap the conditional render in
// <AnimatePresence>.

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

export const PANEL_SCROLL_CLS =
  'min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.5)_transparent] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400/50 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5';

interface Props {
  /** 'panel' slides in from the right (desktop/embeds); 'sheet' from the bottom (mobile). */
  variant: 'panel' | 'sheet';
  title: React.ReactNode;
  /** Optional right-side header extra (e.g. 进入主页 link). */
  headerExtra?: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function HostPanel({ variant, title, headerExtra, closeLabel, onClose, children }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-[15]" onClick={onClose} role="presentation">
      <motion.div
        role="dialog"
        initial={variant === 'panel' ? { x: '100%' } : { y: '100%' }}
        animate={{ x: 0, y: 0 }}
        exit={variant === 'panel' ? { x: '100%' } : { y: '100%' }}
        transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        className={
          variant === 'panel'
            ? 'absolute inset-y-0 right-0 flex w-full max-w-[400px] flex-col border-l border-zinc-200 bg-white text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100'
            : 'absolute inset-x-0 bottom-0 flex h-[72dvh] flex-col rounded-t-2xl bg-white text-zinc-900 shadow-2xl dark:bg-zinc-950 dark:text-zinc-100'
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0 text-sm font-semibold">{title}</div>
          <div className="flex shrink-0 items-center gap-3">
            {headerExtra}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label={closeLabel}
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
