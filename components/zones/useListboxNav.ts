'use client';

// Roving highlight for a listbox rendered as a `<ul role="listbox">` of
// `role="option"` rows (EmbedPickerDialog results / 附件 rows, ColumnPicker).
// ↑ / ↓ / Home / End move the highlight, Enter picks it; the owning input (or
// the list) carries `aria-activedescendant={activeId}`. Tab is never hijacked
// and scrolling is `block: 'nearest'` (never smooth — it follows a keypress).
//
// Rows must render `id={optionId(i)}` and `data-index={i}` so the hook can
// scroll the active one into view without a ref per row.

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

export interface ListboxNav {
  active: number;
  setActive: (i: number) => void;
  listRef: RefObject<HTMLUListElement>;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** DOM id of the highlighted row (undefined when the list is empty). */
  activeId: string | undefined;
  /** DOM id for row `i` — render it on every option. */
  optionId: (i: number) => string;
}

export function useListboxNav(count: number, onPick: (i: number) => void): ListboxNav {
  const base = useId();
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // A shrinking list (typing a filter) must never leave the highlight past the end.
  useEffect(() => {
    if (active > Math.max(0, count - 1)) setActive(Math.max(0, count - 1));
  }, [count, active]);

  useEffect(() => {
    if (count === 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active, count]);

  const optionId = useCallback((i: number) => `${base}-opt-${i}`, [base]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (count === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActive((i) => Math.min(count - 1, i + 1));
          return;
        case 'ArrowUp':
          e.preventDefault();
          setActive((i) => Math.max(0, i - 1));
          return;
        case 'Home':
          e.preventDefault();
          setActive(0);
          return;
        case 'End':
          e.preventDefault();
          setActive(count - 1);
          return;
        case 'Enter':
          // IME composition Enter must not pick (Chinese input commits with Enter).
          if (e.nativeEvent.isComposing) return;
          e.preventDefault();
          onPickRef.current(Math.min(active, count - 1));
          return;
        default:
      }
    },
    [count, active],
  );

  return { active, setActive, listRef, onKeyDown, activeId: count > 0 ? optionId(active) : undefined, optionId };
}
