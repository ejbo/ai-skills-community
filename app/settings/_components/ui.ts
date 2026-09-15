// 设置页 — shared monochrome class strings. Import-free so server pages and
// client editors share one look. 配色契约: every control here is ink (zinc);
// the only colour on these pages belongs to the member's own material (the
// 名片 theme swatches, the card preview, badge tokens).

export const BTN_PRIMARY =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950';

export const BTN_SECONDARY =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100/30';

export const BTN_GHOST =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100/30';

/** 32 px square icon button (row ↑/↓, remove). */
export const BTN_ICON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100/30';

export const INPUT_CLS =
  'h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-300 dark:focus:ring-zinc-100/10 dark:disabled:bg-zinc-900';

export const TEXTAREA_CLS =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-300 dark:focus:ring-zinc-100/10';

/** Invalid state appended to INPUT_CLS (danger is a status colour, not chrome). */
export const INPUT_INVALID_CLS = '!border-danger/70 focus:!ring-danger/15';

export const LABEL_CLS = 'mb-1.5 flex items-baseline justify-between gap-3 text-xs font-medium text-zinc-700 dark:text-zinc-300';
export const HINT_CLS = 'mt-1.5 text-xs leading-relaxed text-muted';

/** A settings card. `surface` paints the theme tokens; the radius matches the rest of /settings. */
export const CARD_CLS = 'surface rounded-2xl';

/** Mono counter next to a label ("12/60"). */
export const COUNTER_CLS = 'font-mono text-[11px] font-normal tabular-nums text-zinc-400 dark:text-zinc-500';

/** Segmented control (two–four mutually exclusive options). */
export const SEGMENT_GROUP_CLS =
  'inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900';

export function segmentCls(active: boolean): string {
  return `inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-100/30 ${
    active
      ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:text-zinc-50 dark:ring-white/10'
      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
  }`;
}

/** Ink range input (blur / grayscale sliders). `accent-color` keeps the native thumb, just inked. */
export const RANGE_CLS = 'h-1.5 w-full cursor-pointer accent-zinc-900 disabled:cursor-not-allowed dark:accent-zinc-100';
