'use client';

// The navbar's bubble-menu motion, shared by every dropdown on the bar.
//
// This is the React Bits <BubbleMenu /> *motion* on framer-motion — bubbles
// popping in past their final size on a stagger, labels sliding up a beat
// behind them, an alternating tilt that settles straight, fill-on-hover pills.
// It is deliberately NOT the React Bits component: that one is a GSAP
// full-viewport takeover with 4rem rotated pills, which is the right shape for
// a landing-page hero and the wrong one for a 56px product bar — and it would
// have added a second animation library to animate a handful of utility links.
// See CLAUDE.md 收纳菜单.
//
// Extracted from NavMoreMenu so 收纳 / 语言 / 用户 cannot drift apart: the
// timing constants, the entrance tilt, the pill vocabulary, the panel chrome
// AND the keyboard contract all live here once.
//
// Panels are PORTALED (useAnchoredPanel). NavBarShell animates
// `transition-transform`, which makes it a containing block for
// `position: fixed`, so a panel rendered in place would be trapped inside the
// bar. The hook owns outside-click, Escape, scroll re-anchoring and the
// flip-above-the-trigger fallback — but it explicitly does NOT own focus, and
// portaling moves the items to the end of <body>, out of the trigger's tab
// order. This component therefore implements the ARIA menu-button pattern
// (focus in on open, roving arrows, Tab hands focus back to the trigger), the
// same way app/zones/_components/ZoneManageMenu.tsx does for the other consumer
// of the hook. Without it the menu is visible but unreachable by keyboard.

import { useCallback, useEffect, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { AnchoredPanel } from '@/components/useAnchoredPanel';

/** Matches BubbleMenu's `back.out(1.5)`: settles past 1, then eases back. */
export const BACK_OUT = [0.34, 1.4, 0.64, 1] as const;
export const BUBBLE_STAGGER = 0.045;
export const BUBBLE_DURATION = 0.34;
/** Pill height + gap — used to pre-size a panel before it is measured. */
export const BUBBLE_ROW_H = 44;

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"]';

/** First-paint height estimate for a panel of `rows` pills. */
export function bubblePanelHeight(rows: number, extra = 0): number {
  return rows * BUBBLE_ROW_H + 16 + extra;
}

/**
 * Only what the panel itself needs. Deliberately not `AnchoredPanel<T>`: the
 * trigger ref is invariant, so a caller holding an `AnchoredPanel<HTMLButtonElement>`
 * could not pass it as `AnchoredPanel<HTMLElement>`.
 */
type PanelSlice = Pick<AnchoredPanel<HTMLElement>, 'open' | 'pos' | 'panelRef' | 'host' | 'close'>;

function itemsIn(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
}

/**
 * The floating sheet: portaled, anchored, fading as one while its rows pop.
 *
 * `header` renders above the list — it is a sibling of the `role="menu"`
 * element, never inside it, because a menu may only own menuitems.
 */
export function BubblePanel({
  panel,
  label,
  width,
  header,
  children,
}: {
  panel: PanelSlice;
  label: string;
  width: number;
  header?: ReactNode;
  children: ReactNode;
}) {
  const { open, panelRef, close } = panel;

  // Portaling drops the panel out of the tab order, so opening moves focus into
  // it explicitly. Prefer the checked/current row (the current locale, the page
  // you are on) — that is where a menu-button is meant to land.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      const els = itemsIn(panelRef.current);
      // Roving focus: only one item is tabbable, the arrows do the rest.
      els.forEach((el) => el.setAttribute('tabindex', '-1'));
      const active = els.find(
        (el) => el.getAttribute('aria-checked') === 'true' || el.hasAttribute('aria-current'),
      );
      (active ?? els[0])?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, panelRef]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const els = itemsIn(panelRef.current);
      if (els.length === 0) return;
      const i = els.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        els[(i + 1) % els.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        els[(i <= 0 ? els.length : i) - 1]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        els[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        els[els.length - 1]?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab') {
        // No preventDefault: focus returns to the trigger synchronously, so the
        // browser carries on tabbing from there and natural order is preserved.
        close(true);
      }
    },
    [close, panelRef],
  );

  if (!panel.host) return null;

  return createPortal(
    <AnimatePresence>
      {open && panel.pos && (
        <motion.div
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          style={{
            left: panel.pos.left,
            top: panel.pos.top,
            width,
            maxHeight: panel.pos.maxHeight,
          }}
          className="scroll-thin fixed z-[70] overflow-y-auto overflow-x-hidden rounded-2xl border border-zinc-200/80 bg-white/95 p-2 shadow-xl shadow-black/10 outline-none backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/95 dark:shadow-black/50"
        >
          {header}
          {/* role="menu" sits on the <ul> itself: an element between a menu and
              its menuitems has an implicit `list` role, which breaks the
              ownership a screen reader needs to announce "3 items, 1 of 3". */}
          <ul role="menu" aria-label={label} className="flex flex-col gap-1.5">
            {children}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>,
    panel.host,
  );
}

/**
 * Trigger keyboard contract: ArrowDown/ArrowUp open the menu (which then focuses
 * a row), Escape closes it. Wire it as `onKeyDown` on the trigger button.
 */
export function bubbleTriggerKeyDown(panel: Pick<AnchoredPanel<HTMLElement>, 'open' | 'openPanel' | 'close'>) {
  return (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!panel.open) panel.openPanel();
    } else if (e.key === 'Escape' && panel.open) {
      e.preventDefault();
      panel.close(true);
    }
  };
}

/**
 * One bubble. The original leaves its pills permanently tilted ±8°, which works
 * for three 4rem bubbles across a hero and reads as sloppy alignment in a stack
 * of 13px rows. So the tilt is the ENTRANCE only — each bubble pops in askew and
 * settles straight — and the resting menu stays a menu.
 */
export function BubbleRow({ index, children }: { index: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const rot = reduce ? 0 : index % 2 === 0 ? -6 : 6;
  return (
    <motion.li
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
                duration: BUBBLE_DURATION,
                ease: BACK_OUT,
                delay: index * BUBBLE_STAGGER,
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
      {children}
    </motion.li>
  );
}

/**
 * The label inside a bubble, sliding up a beat behind it. The two-part reveal —
 * bubble first, then its text — is the whole effect; a pill that arrives with
 * its label already in place just looks like a fade.
 *
 * Both branches render the same element with the same attributes: `initial={false}`
 * tells framer-motion to adopt the animate target as the first frame, so a
 * reduced-motion user gets a fully opaque label rather than a blank pill.
 */
export function BubbleLabel({
  index,
  className = '',
  children,
}: {
  index: number;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      className={className}
      initial={reduce ? false : { y: 10, opacity: 0 }}
      animate={
        reduce
          ? { y: 0, opacity: 1 }
          : {
              y: 0,
              opacity: 1,
              transition: {
                duration: BUBBLE_DURATION,
                ease: 'easeOut',
                delay: index * BUBBLE_STAGGER + BUBBLE_DURATION * 0.25,
              },
            }
      }
    >
      {children}
    </motion.span>
  );
}

/**
 * Pill vocabulary. Ink chrome per the 配色契约 — `active` is the filled state
 * (current page, current language), hover fills the same way so the menu reads
 * as one control rather than a list of links. Both branches are complete class
 * literals so Tailwind's scanner emits them.
 */
export function bubblePill(active = false): string {
  return `group flex h-10 w-full items-center gap-2.5 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${
    active
      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
      : 'bg-zinc-100/80 text-zinc-700 hover:bg-zinc-900 hover:text-white dark:bg-white/[0.07] dark:text-zinc-200 dark:hover:bg-zinc-100 dark:hover:text-zinc-900'
  }`;
}

/**
 * The two-line toggle that morphs into an X — BubbleMenu's hamburger at navbar
 * scale. Exported so a trigger that wants it does not re-derive the offsets.
 */
export function BubbleToggleIcon({ open }: { open: boolean }) {
  return (
    <span className="flex h-4 w-4 flex-col items-center justify-center gap-[5px]">
      <span
        className={`h-[1.5px] w-4 rounded-full bg-current transition-transform duration-300 ${
          open ? 'translate-y-[3.25px] rotate-45' : ''
        }`}
      />
      <span
        className={`h-[1.5px] w-4 rounded-full bg-current transition-transform duration-300 ${
          open ? '-translate-y-[3.25px] -rotate-45' : ''
        }`}
      />
    </span>
  );
}
