// 技术专区 — the ONE place a name becomes a hue.
//
// 配色契约 (CLAUDE.md): *the page has no colour of its own; colour belongs to
// the material.* These pages went grey because almost nothing on them was
// treated as material. Three things here are: a 栏目 (the taxonomy the reader
// scans for), a post's own #tag, and a 版块 (a place, which should be as
// recognisable as a person's avatar). Everything around them — buttons, tabs,
// filter chips, borders, backgrounds, focus rings — stays ink, and NOTHING in
// this module may be used on a control.
//
// Both hashes are BORROWED, not invented, so a 栏目 or a 版块 looks the same
// here as the same idea does elsewhere in the app:
//   • 栏目  → `tagColorIndex` (lib/discussion-tags.ts) over the same tailwind
//     hue family 讨论区's member-created tags use
//     (app/discussion/_components/badges.tsx: solid `bg-x-100 text-x-700` /
//     dark `bg-x-500/15 text-x-300`, outlined `border-x-200 text-x-700`).
//   • 版块  → `identityColor` (components/Avatar.tsx), the 12-hue identity
//     palette the avatar fallback uses — NavMegaPanel already borrows it to
//     give a 研究所 a face, and a 版块 is the same kind of thing.
//
// Hashing key: a 栏目 hashes on its NAME, never its slug. A CJK name gets a
// hash slug (`column-3f2a…`) that differs from the cross-zone facet's key, so
// slugs would paint the same 栏目 two colours between the hub rail and the zone
// home. The name is what the reader sees and what `getOrCreateColumn` dedupes
// on, so it is the identity here too.

import { identityColor } from '@/components/Avatar';
import { tagColorIndex } from '@/lib/discussion-tags';

export interface ColumnHue {
  /** Soft filled chip — an official 栏目 (the zone's own curated taxonomy). */
  chip: string;
  /** Outlined chip — a member-created 栏目 (pair with `border-dashed`). */
  outline: string;
  /** 8 px dot for rail rows and filter chips, where the chip itself stays ink. */
  dot: string;
  /** Text-only — a post's `#tag`, which has no chip of its own. */
  text: string;
}

const COLUMN_PALETTE: readonly ColumnHue[] = [
  {
    chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    outline: 'border-indigo-300 text-indigo-700 dark:border-indigo-500/40 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    outline: 'border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    outline: 'border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  {
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    outline: 'border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-300',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
  },
  {
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    outline: 'border-sky-300 text-sky-700 dark:border-sky-500/40 dark:text-sky-300',
    dot: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
  },
  {
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    outline: 'border-violet-300 text-violet-700 dark:border-violet-500/40 dark:text-violet-300',
    dot: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
  },
  {
    chip: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
    outline: 'border-cyan-300 text-cyan-700 dark:border-cyan-500/40 dark:text-cyan-300',
    dot: 'bg-cyan-500',
    text: 'text-cyan-600 dark:text-cyan-400',
  },
  {
    chip: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
    outline: 'border-orange-300 text-orange-700 dark:border-orange-500/40 dark:text-orange-300',
    dot: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
  },
];

/** Stable hue for a 栏目, keyed on the display name (see the module note). */
export function columnHue(name: string): ColumnHue {
  return COLUMN_PALETTE[tagColorIndex(name.trim().toLowerCase(), COLUMN_PALETTE.length)];
}

/**
 * The 栏目 chip as it appears on a post row / card: soft fill for an official
 * column, dashed outline for a member-created one — the same official/member
 * grammar 讨论区 uses, now carrying the column's own hue instead of grey.
 */
export function columnPillCls(name: string, official: boolean): string {
  const hue = columnHue(name);
  const base =
    'inline-flex max-w-[12rem] shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition';
  return official
    ? `${base} ${hue.chip} hover:opacity-80`
    : `${base} border border-dashed bg-transparent ${hue.outline} hover:opacity-80`;
}

/** The dot that marks a 栏目 in ink chrome (rail rows, filter chips, band header). */
export function columnDotCls(name: string): string {
  return columnHue(name).dot;
}

/**
 * A post's own `#tag` — the author's label, the same species as a
 * member-created 讨论区 tag, so the same hashed palette. Text only: a metadata
 * row that already carries a 栏目 chip cannot take a second filled pill.
 */
export function tagTextCls(name: string): string {
  return columnHue(name).text;
}

/**
 * A 版块's own colour, from the identity palette. Used for the monogram a zone
 * with no icon falls back to (a wall of flat black squares is what made the hub
 * unreadable) and, at low alpha, for the cover strip behind the hairline grid.
 */
export function zoneHue(name: string): string {
  return identityColor(name);
}

/** `zoneHue` at ~10% — a flat wash, never a gradient. */
export function zoneWash(name: string): string {
  return `${identityColor(name)}1A`;
}

/**
 * A 研究所 is a place too, so the section headers that group 版块 by lab take
 * the same palette — exactly what NavMegaPanel's LabTile already does when a
 * 研究所 has no artwork.
 */
export function orgHue(lab: string): string {
  return identityColor(lab);
}
