'use client';

// Aceternity-style stateful button, ink: idle → busy (spinner) → done (✓ drawn
// with `pathLength`, held 900 ms) → idle. The three layers are stacked in one
// grid cell so the button NEVER changes width — the label keeps its box while
// invisible. `skipDone` = stay busy until unmount (a navigation follows the
// action). `disabled` while busy, `aria-busy` for readers. Reduced motion:
// crossfades at 0 s and the ✓ is pre-drawn.

import { motion, useReducedMotion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EASE_OUT } from '@/lib/motion';

type Phase = 'idle' | 'busy' | 'done';

const DONE_HOLD_MS = 900;

export interface StatefulButtonProps {
  /** Resolves true on success (→ ✓), false to return to idle silently (the caller toasts). */
  onAction: () => Promise<boolean>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** Stay busy after success until unmount (a route change follows). */
  skipDone?: boolean;
  type?: 'button';
}

export function StatefulButton({ onAction, children, className = '', disabled = false, skipDone = false, type = 'button' }: StatefulButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const reduce = useReducedMotion();
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function run() {
    if (phase !== 'idle' || disabled) return;
    setPhase('busy');
    let ok = false;
    try {
      ok = await onAction();
    } catch {
      ok = false;
    }
    if (!mounted.current) return;
    if (ok && skipDone) return; // the navigation unmounts us
    if (!ok) {
      setPhase('idle');
      return;
    }
    setPhase('done');
    timer.current = setTimeout(() => {
      if (mounted.current) setPhase('idle');
    }, DONE_HOLD_MS);
  }

  const fade = reduce ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT };
  const layer = 'col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5';

  return (
    <button type={type} onClick={run} disabled={disabled || phase !== 'idle'} aria-busy={phase === 'busy'} className={`grid place-items-center ${className}`}>
      <motion.span
        className={layer}
        initial={false}
        animate={{ opacity: phase === 'idle' ? 1 : 0, y: phase === 'idle' || reduce ? 0 : -6 }}
        transition={fade}
      >
        {children}
      </motion.span>
      <motion.span className={layer} aria-hidden initial={false} animate={{ opacity: phase === 'busy' ? 1 : 0 }} transition={fade}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </motion.span>
      <motion.span className={layer} aria-hidden initial={false} animate={{ opacity: phase === 'done' ? 1 : 0 }} transition={fade}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <motion.path
            d="M4 12.5l5 5L20 6.5"
            initial={false}
            animate={{ pathLength: reduce || phase === 'done' ? 1 : 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.3, ease: EASE_OUT }}
          />
        </svg>
      </motion.span>
    </button>
  );
}
