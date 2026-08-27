'use client';

// Navbar overflow menu — the "收纳" button.
//
// Motion is the React Bits <BubbleMenu /> idea (staggered bubbles that pop in
// past their final size, labels sliding up a beat later, hamburger morphing
// into an X), re-implemented on framer-motion, which this app already ships.
// The original is a GSAP full-viewport takeover with 4rem rotated pills — the
// right shape for a landing-page hero, the wrong one for three utility links
// on a 56px product bar, and it would have cost a second animation library.
// What survives is the feel: `back.out`-style overshoot, per-item stagger, an
// alternating tilt that settles straight, and a fill-on-hover pill.
//
// The panel is PORTALED (useAnchoredPanel): NavBarShell animates
// `transition-transform`, which makes it a containing block for `position:
// fixed`, so a panel rendered in place would be trapped inside the bar.

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';
import type { NavItem } from '@/components/nav-items';

/** Matches BubbleMenu's `back.out(1.5)`: settles past 1, then eases back. */
const BACK_OUT = [0.34, 1.4, 0.64, 1] as const;
const STAGGER = 0.045;
const DURATION = 0.34;

const ROW_H = 44;
const PANEL_W = 232;

export function NavMoreMenu({ items }: { items: NavItem[] }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const panel = useAnchoredPanel<HTMLButtonElement>({
    width: PANEL_W,
    height: items.length * ROW_H + 16,
  });

  // Nothing to stash (should not happen — STASHED_NAV is never empty — but a
  // button that opens an empty sheet is worse than no button).
  if (items.length === 0) return null;

  const label = t('more');

  return (
    <>
      <button
        ref={panel.triggerRef}
        type="button"
        onClick={panel.toggle}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={panel.open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100"
      >
        {/* Two lines that rotate into an X — the BubbleMenu toggle, at navbar scale. */}
        <span className="flex h-4 w-4 flex-col items-center justify-center gap-[5px]">
          <span
            className={`h-[1.5px] w-4 rounded-full bg-current transition-transform duration-300 ${
              panel.open ? 'translate-y-[3.25px] rotate-45' : ''
            }`}
          />
          <span
            className={`h-[1.5px] w-4 rounded-full bg-current transition-transform duration-300 ${
              panel.open ? '-translate-y-[3.25px] -rotate-45' : ''
            }`}
          />
        </span>
      </button>

      {panel.host &&
        createPortal(
          <AnimatePresence>
            {panel.open && panel.pos && (
              <motion.div
                ref={panel.panelRef}
                role="menu"
                aria-label={label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                style={{
                  left: panel.pos.left,
                  top: panel.pos.top,
                  width: PANEL_W,
                  maxHeight: panel.pos.maxHeight,
                }}
                className="scroll-thin fixed z-[70] overflow-y-auto overflow-x-hidden rounded-2xl border border-zinc-200/80 bg-white/95 p-2 shadow-xl shadow-black/10 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/95 dark:shadow-black/50"
              >
                <ul className="flex flex-col gap-1.5">
                  {items.map((item, i) => {
                    const active =
                      pathname === item.href || pathname.startsWith(`${item.href}/`);
                    // The original leaves its pills permanently tilted ±8°,
                    // which works for three 4rem bubbles across a hero and
                    // reads as sloppy alignment in a 9-row stack at 13px. Keep
                    // the tilt as the ENTRANCE — each bubble pops in askew and
                    // settles straight — so the motion stays playful and the
                    // resting menu stays a menu.
                    const rot = reduce ? 0 : i % 2 === 0 ? -6 : 6;
                    return (
                      <motion.li
                        key={item.href}
                        role="none"
                        initial={reduce ? { opacity: 0 } : { scale: 0, opacity: 0, rotate: rot }}
                        animate={
                          reduce
                            ? { opacity: 1 }
                            : {
                                scale: 1,
                                opacity: 1,
                                rotate: 0,
                                transition: {
                                  duration: DURATION,
                                  ease: BACK_OUT,
                                  delay: i * STAGGER,
                                },
                              }
                        }
                        exit={
                          reduce
                            ? { opacity: 0 }
                            : { scale: 0, opacity: 0, rotate: rot, transition: { duration: 0.13 } }
                        }
                        style={{ originX: 0.5, originY: 0.5 }}
                      >
                        <Link
                          role="menuitem"
                          href={item.href}
                          onClick={() => panel.close()}
                          aria-current={active ? 'page' : undefined}
                          className={`group flex h-10 items-center gap-2.5 rounded-full px-3.5 text-sm font-medium transition-colors ${
                            active
                              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                              : 'bg-zinc-100/80 text-zinc-700 hover:bg-zinc-900 hover:text-white dark:bg-white/[0.07] dark:text-zinc-200 dark:hover:bg-zinc-100 dark:hover:text-zinc-900'
                          }`}
                        >
                          <item.Icon className="h-4 w-4 shrink-0" aria-hidden />
                          {/* Labels slide up a beat behind their bubble, as in
                              the original — the two-part reveal is the effect. */}
                          <motion.span
                            className="truncate"
                            initial={reduce ? false : { y: 10, opacity: 0 }}
                            animate={
                              reduce
                                ? {}
                                : {
                                    y: 0,
                                    opacity: 1,
                                    transition: {
                                      duration: DURATION,
                                      ease: 'easeOut',
                                      delay: i * STAGGER + DURATION * 0.25,
                                    },
                                  }
                            }
                          >
                            {t(item.key)}
                          </motion.span>
                        </Link>
                      </motion.li>
                    );
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>,
          panel.host,
        )}
    </>
  );
}
