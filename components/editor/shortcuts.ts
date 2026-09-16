// Keyboard-shortcut hints for the editor toolbar. The combos are tiptap's own
// keymap spellings (`Mod-Shift-s`), so a hint can only name a binding that
// really runs — see TOOLBAR_SHORTCUTS below, pinned by tests/rte-stack.test.ts
// against the live keymap. `link` is the one binding that is NOT in the
// extension list: it opens a React dialog, so the toolbar's LinkControls
// registers it on the editor while it is mounted
// (components/editor/toolbar/LinkControls.tsx), which is exactly where the
// hint is rendered too.
//
// Shown in the platform's own notation: ⌘⇧S on Apple devices (modifier glyphs
// in Apple's fixed order ⌃⌥⇧⌘, no separators), Ctrl+Shift+S elsewhere. Key
// names are not translated — they are printed on the keyboard.
//
// Import-free and React-free: the toolbar renders client-side only (the editor
// is created with immediatelyRender:false), so reading `navigator` at render is
// safe, and the pure formatters are unit-testable.

/** tiptap keymap combos of the toolbar actions that have one. */
export const TOOLBAR_SHORTCUTS = {
  bold: 'Mod-b',
  italic: 'Mod-i',
  strike: 'Mod-Shift-s',
  code: 'Mod-e',
  superscript: 'Mod-.',
  subscript: 'Mod-,',
  h1: 'Mod-Alt-1',
  h2: 'Mod-Alt-2',
  h3: 'Mod-Alt-3',
  bulletList: 'Mod-Shift-8',
  orderedList: 'Mod-Shift-7',
  blockquote: 'Mod-Shift-b',
  codeBlock: 'Mod-Alt-c',
  // Word / 飞书 / Docs all open 插入链接 on ⌘K. The editor takes it only while it
  // has focus; elsewhere on the page it still opens the site search palette.
  link: 'Mod-k',
  undo: 'Mod-z',
  redo: 'Mod-Shift-z',
} as const;

export type ToolbarShortcut = keyof typeof TOOLBAR_SHORTCUTS;

const MAC_GLYPH: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' };
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];
const PC_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'];
const PC_NAME: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
const ARIA_NAME: Record<string, (mac: boolean) => string> = {
  Mod: (mac) => (mac ? 'Meta' : 'Control'),
  Ctrl: () => 'Control',
  Alt: () => 'Alt',
  Shift: () => 'Shift',
};

function split(combo: string): { mods: Set<string>; key: string } {
  const parts = combo.split('-');
  const key = parts.pop() ?? '';
  return { mods: new Set(parts), key: key.length === 1 ? key.toUpperCase() : key };
}

/** `Mod-Shift-s` → `⇧⌘S` (mac) / `Ctrl+Shift+S` (others). */
export function formatShortcut(combo: string, mac: boolean): string {
  const { mods, key } = split(combo);
  if (mac) return `${MAC_ORDER.filter((m) => mods.has(m)).map((m) => MAC_GLYPH[m]).join('')}${key}`;
  return [...PC_ORDER.filter((m) => mods.has(m)).map((m) => PC_NAME[m]), key].join('+');
}

/** The `aria-keyshortcuts` value: `Meta+Shift+S` / `Control+Shift+S`. */
export function ariaKeyShortcuts(combo: string, mac: boolean): string {
  const { mods, key } = split(combo);
  return [...PC_ORDER.filter((m) => mods.has(m)).map((m) => ARIA_NAME[m](mac)), key].join('+');
}

/**
 * Apple platforms, where `Mod` is ⌘. Client-only (false on the server).
 * Answered once per document: ~40 toolbar buttons ask on every render, and the
 * platform cannot change under a loaded page. The cache is filled only once
 * `navigator` exists, so an SSR evaluation can never pin it to false.
 */
let applePlatform: boolean | undefined;
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (applePlatform === undefined) {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
    applePlatform = /mac|iphone|ipad|ipod/i.test(platform);
  }
  return applePlatform;
}
