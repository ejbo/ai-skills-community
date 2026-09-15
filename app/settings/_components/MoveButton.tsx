'use client';

// ↑ / ↓ for the settings lists (主页板块, 外链) that never drop keyboard focus.
//
//   - At a list end the button is `aria-disabled`, not `disabled`: the native
//     attribute on the FOCUSED button (↑ just moved its row to the top) sends
//     focus to <body>, and the member has to tab back through the navbar.
//   - A keyed reorder MOVES some row's DOM node, and moving a node blurs whatever
//     is focused inside it (React relocates the pressed row on a ↓), so the
//     pressed button is re-focused after the commit — only when focus fell to
//     <body>, never stolen from wherever the member went next.

import type { ReactNode } from 'react';
import { BTN_ICON } from './ui';

/** After an action that may have removed / moved the focused node, put focus back on `el` if it fell to <body>. */
export function refocusIfLost(el: HTMLElement | null | undefined): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (el && el.isConnected && (!active || active === document.body)) el.focus({ preventScroll: true });
  });
}

export function MoveButton({
  atEnd,
  onMove,
  label,
  className = '',
  children,
}: {
  /** The row cannot move further this way (first row's ↑, last row's ↓). */
  atEnd: boolean;
  onMove: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-disabled={atEnd || undefined}
      aria-label={label}
      onClick={(e) => {
        if (atEnd) return;
        const btn = e.currentTarget;
        onMove();
        refocusIfLost(btn);
      }}
      className={`${BTN_ICON} aria-disabled:cursor-not-allowed aria-disabled:opacity-30 aria-disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  );
}
