'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { EASE_OUT } from '@/lib/motion';

export type Step = { key: string; title: ReactNode; content: ReactNode };

type Props = {
  steps: Step[];
  /** Index of the current step (controlled). */
  step: number;
  onStepChange: (index: number) => void;
  className?: string;
};

const slide = {
  enter: (d: number) => ({ x: 24 * d, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: -24 * d, opacity: 0 }),
};

// Controlled multi-step wizard: the parent owns `step` and the draft (Back /
// Next / 发布 buttons live there, next to validation), and step inputs must
// stay mounted state-wise in the parent — an unmounted step's uncontrolled
// inputs would be wiped. `AnimatePresence mode="wait"` avoids reactbits'
// absolutely positioned slides + measured height; content height changes
// naturally. `initial={false}` on the presence suppresses the enter state on
// first mount, so SSR is visible. Reduced motion: `custom={0}` turns the slide
// into an instant crossfade. Only completed steps are clickable in the rail.
export function Stepper({ steps, step, onStepChange, className = '' }: Props) {
  const [dir, setDir] = useState(1);
  const reduce = useReducedMotion();
  const current = Math.min(Math.max(step, 0), Math.max(steps.length - 1, 0));
  const go = (i: number) => {
    setDir(i > current ? 1 : -1);
    onStepChange(i);
  };
  const t = { duration: reduce ? 0 : 0.22, ease: EASE_OUT };
  const active = steps[current];

  return (
    <div className={className}>
      <ol className="mb-6 flex items-center">
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'todo';
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                onClick={() => i < current && go(i)}
                disabled={i >= current}
                aria-current={state === 'active' ? 'step' : undefined}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs tabular-nums transition-colors ${
                  state === 'todo'
                    ? 'cursor-default border-zinc-300 text-zinc-400 dark:border-zinc-700'
                    : 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900'
                } ${state === 'active' ? 'cursor-default' : ''}`}
              >
                {state === 'done' ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {/* mounts only once a step is completed (client-side), so the draw never starts hidden on SSR */}
                    <motion.path d="M5 13l4 4L19 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={t} />
                  </svg>
                ) : (
                  i + 1
                )}
              </button>
              <span className={`text-sm ${state === 'todo' ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-50'}`}>
                {s.title}
              </span>
              {i < steps.length - 1 && (
                <span className="relative mx-3 h-px flex-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                  <motion.span
                    className="absolute inset-y-0 left-0 bg-zinc-900 dark:bg-zinc-50"
                    initial={false}
                    animate={{ width: i < current ? '100%' : '0%' }}
                    transition={{ ...t, duration: reduce ? 0 : 0.35 }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" custom={reduce ? 0 : dir} initial={false}>
          {active && (
            <motion.div
              key={active.key}
              custom={reduce ? 0 : dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={t}
            >
              {active.content}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
