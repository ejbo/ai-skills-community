'use client';

// Shared pieces of the editor toolbar (components/editor/toolbar/EditorToolbar.tsx):
// the icon button, the group divider, and ONE popover mechanism every dropdown,
// the colour palettes and the link dialog ride.
//
// Every popover here:
//   • is PORTALED and anchored through `useAnchoredPanel` (components/useAnchoredPanel.ts)
//     — the editor root is `overflow-hidden` and composers sit in transformed
//     cards / drawers; the hook flips above, clamps to the VISUAL viewport and
//     closes on an outside press or when its trigger scrolls away;
//   • keeps OFF the selection it formats (components/editor/avoid-selection.ts):
//     anchored under a sticky toolbar it would otherwise open right over the
//     first lines of the text being coloured — re-placed after every
//     transaction while open, since 字号 / 字体 grow the text under it;
//   • keeps the editor selection: its controls cancel `mousedown`, and every
//     command runs through `chain().focus()`, which restores the selection the
//     editor state still holds when focus sat in an input of the popover;
//   • closes on Esc and returns focus to the EDITOR, not to the toolbar — the
//     author opened it mid-sentence;
//   • KEEPS THE KEYBOARD. Opened with the mouse, focus is still in the text, so
//     ↑/↓ would move the caret under an open menu: the panel claims those two
//     keys and moves focus into itself instead. Once focus IS inside, Tab may
//     not walk out — it wraps in a dialog and closes a menu (APG) — because the
//     page behind a composer is often chrome that is scrolled away or held
//     hidden, and Tab used to land on an invisible nav link.
//   • inside the 知识库 reader (`tone="reader"`) is portaled into `.reader-root`
//     and wears the reader's own theme variables (its palette tokens only exist
//     inside that root).
//
// Motion: none. Menus never animate in this app (lib/motion.ts budget).

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { posToDOMRect, type Editor } from '@tiptap/core';
import { ChevronDown } from 'lucide-react';
import { useAnchoredPanel, visibleViewport, type AnchoredPanel } from '@/components/useAnchoredPanel';
import { panelAvoidingSelection, type PanelBox } from '@/components/editor/avoid-selection';
import { TOOLBAR_SHORTCUTS, ariaKeyShortcuts, formatShortcut, isApplePlatform, type ToolbarShortcut } from '@/components/editor/shortcuts';

export type ToolbarTone = 'default' | 'reader';

/** The tone of the toolbar a control sits in — set once by EditorToolbar. */
export const ToolbarToneContext = createContext<ToolbarTone>('default');
export const useToolbarTone = () => useContext(ToolbarToneContext);

/** Class sets per tone. The reader has its own theme axis, so `dark:` variants are wrong there half the time. */
export function toolbarClasses(tone: ToolbarTone) {
  const reader = tone === 'reader';
  return {
    panel: reader
      ? 'border-[var(--reader-border)] bg-[var(--reader-surface)] text-[var(--reader-fg)]'
      : 'border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100',
    muted: reader ? 'text-[var(--reader-muted)]' : 'text-zinc-500 dark:text-zinc-400',
    hover: reader ? 'hover:bg-[var(--reader-hover)]' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
    selected: reader ? 'bg-[var(--reader-hover)] font-semibold' : 'bg-zinc-900/[0.06] font-semibold dark:bg-white/10',
    hairline: reader ? 'border-[var(--reader-border)]' : 'border-zinc-200 dark:border-zinc-800',
    field: reader
      ? 'border-[var(--reader-border)] bg-transparent text-[var(--reader-fg)]'
      : 'border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100',
    ring: reader ? 'ring-2 ring-[var(--reader-fg)]' : 'ring-2 ring-zinc-900 dark:ring-zinc-100',
    idle: reader
      ? 'text-[var(--reader-muted)] hover:bg-[var(--reader-hover)] hover:text-[var(--reader-fg)]'
      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
    on: reader ? 'bg-[var(--reader-hover)] text-[var(--reader-fg)]' : 'bg-zinc-900/[0.06] text-zinc-900 dark:bg-white/10 dark:text-zinc-50',
    primary: reader
      ? 'bg-[var(--reader-fg)] text-[var(--reader-surface)] hover:opacity-90'
      : 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
    focus: 'outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]',
  };
}

/** mousedown (not pointerdown) is what moves focus out of the editor. */
export const keepEditorSelection = (e: ReactMouseEvent) => e.preventDefault();

/** The tooltip + aria-keyshortcuts of a control. Client-only: the toolbar never renders on the server. */
export function useShortcutTitle(title: string, shortcut?: ToolbarShortcut, hint?: string) {
  const mac = isApplePlatform();
  const combo = shortcut ? TOOLBAR_SHORTCUTS[shortcut] : null;
  const base = combo ? `${title} (${formatShortcut(combo, mac)})` : title;
  return { tooltip: hint ? `${base}\n${hint}` : base, keys: combo ? ariaKeyShortcuts(combo, mac) : undefined };
}

export interface ToolbarButtonProps {
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** A toggle's state — rendered as aria-pressed. Leave undefined for plain actions. */
  active?: boolean;
  disabled?: boolean;
  /** Accessible name (also the tooltip). */
  title: string;
  /** tiptap keymap combo (components/editor/shortcuts.ts) — shown in the tooltip, announced via aria-keyshortcuts. */
  shortcut?: ToolbarShortcut;
  /** A second tooltip line (e.g. how the 格式刷 double-click works). */
  hint?: string;
  children: ReactNode;
  className?: string;
  /** Stable id of the control (`data-rte-control`) — tests and the live probes find controls by it, not by translated text. */
  control?: string;
  'aria-haspopup'?: 'menu' | 'dialog' | 'listbox';
  'aria-expanded'?: boolean;
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { onClick, active, disabled, title, shortcut, hint, children, className, control, ...aria },
  ref,
) {
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  const { tooltip, keys } = useShortcutTitle(title, shortcut, hint);
  return (
    <button
      ref={ref}
      type="button"
      title={tooltip}
      aria-label={title}
      aria-keyshortcuts={keys}
      aria-pressed={active}
      data-rte-control={control}
      disabled={disabled}
      onMouseDown={keepEditorSelection}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active || aria['aria-expanded'] ? cls.on : cls.idle
      } ${className ?? ''}`}
      {...aria}
    >
      {children}
    </button>
  );
});

/** `className` carries the phone-only `order` (EditorToolbar) — nothing else. */
export function ToolbarDivider({ className }: { className?: string }) {
  const tone = useToolbarTone();
  return (
    <span
      aria-hidden
      className={`rte-toolbar-divider mx-0.5 h-5 w-px self-center ${tone === 'reader' ? 'bg-[var(--reader-border)]' : 'bg-zinc-200 dark:bg-zinc-700'} ${className ?? ''}`}
    />
  );
}

/** A labelled cluster of controls. The row wraps BETWEEN groups, never inside one. */
export function ToolbarGroup({ id, label, className, children }: { id: string; label: string; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} data-rte-group={id} className={`rte-toolbar-group flex items-center gap-0.5 [&>*]:shrink-0 ${className ?? ''}`}>
      {children}
    </div>
  );
}

// ─── the popover mechanism ───────────────────────────────────────────────────

export interface ToolbarPanel<T extends HTMLElement> extends AnchoredPanel<T> {
  /** Where the panel paints: the anchored spot moved off the selection. */
  box: PanelBox | { left: number; top: number; maxHeight: number } | null;
  /** Portal target (reader root for tone="reader"). */
  portalHost: Element | null;
  /** Open / close from a click; a keyboard click (detail 0) moves focus into the panel. */
  toggleFrom: (event: ReactMouseEvent) => void;
  /** Open programmatically, optionally moving focus inside. */
  openWith: (focusInside: boolean) => void;
  /** Close and put focus back into the editor (its selection intact). */
  closeToEditor: () => void;
}

/** Everything a Tab can reach inside a panel, in DOM order (the grid's roving stop is one). */
function tabbableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')).filter((el) => el.tabIndex !== -1);
}

/** `[data-autofocus]` first, else the checked option, else the first control. */
function focusFirstIn(root: HTMLElement): void {
  const target =
    root.querySelector<HTMLElement>('[data-autofocus]') ??
    root.querySelector<HTMLElement>('[aria-checked="true"]') ??
    root.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])');
  target?.focus();
}

export function useToolbarPanel<T extends HTMLElement>({
  editor,
  tone,
  width,
  height,
  disabled = false,
  align = 'left',
  focusOnOpen = false,
  onClose,
}: {
  editor: Editor;
  tone: ToolbarTone;
  width: number;
  height: number;
  disabled?: boolean;
  align?: 'left' | 'right';
  /** Always move focus into the panel on open (a dialog with inputs), not only for keyboard opens. */
  focusOnOpen?: boolean;
  onClose?: () => void;
}): ToolbarPanel<T> {
  const panel = useAnchoredPanel<T>({ width, height, align, onClose });
  const { open, pos, panelRef, close, openPanel, host } = panel;

  // Moved off the selection it formats. The editor host does NOT re-render per
  // transaction (EditorToolbar#useToolbarState), so an open panel follows the
  // selection itself — and only while it is open, which is also the only time
  // anything inside it reads the document (行高's scope hint).
  const [placed, setPlaced] = useState<PanelBox | null>(null);
  const [selection, setSelection] = useState(() => editor.state.selection);
  useEffect(() => {
    if (!open) return;
    const sync = () => setSelection((prev) => (prev === editor.state.selection ? prev : editor.state.selection));
    sync();
    editor.on('transaction', sync);
    return () => {
      editor.off('transaction', sync);
    };
  }, [open, editor]);
  useLayoutEffect(() => {
    if (!open || !pos) {
      setPlaced(null);
      return;
    }
    const el = panelRef.current;
    let rect: DOMRect | null = null;
    if (!selection.empty && !editor.isDestroyed) {
      try {
        rect = posToDOMRect(editor.view, selection.from, selection.to);
      } catch {
        rect = null; // no layout (a detached view)
      }
    }
    const base: PanelBox = { left: pos.left, top: pos.top, width: el?.offsetWidth || width, height: el?.offsetHeight || height, maxHeight: pos.maxHeight };
    const next = panelAvoidingSelection(base, rect && rect.width + rect.height > 0 ? rect : null, visibleViewport());
    setPlaced((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight ? prev : next));
  }, [open, pos, selection, editor, panelRef, width, height]);

  // Portal target: the reader root for tone="reader", else what the hook picked
  // (the fullscreen element, or <body>).
  // Read from the EDITOR's element, not the trigger: the link dialog opened from
  // the caret bubble anchors to a stand-in that lives on <body>. Decided before
  // the first open, so a keyboard-opened panel is never re-mounted into another
  // host (and loses focus) a frame after it appeared.
  const [readerHost, setReaderHost] = useState<Element | null>(null);
  useEffect(() => {
    if (tone !== 'reader' || editor.isDestroyed) return;
    try {
      setReaderHost(editor.view.dom.closest('.reader-root'));
    } catch {
      setReaderHost(null); // no view yet
    }
  }, [tone, editor]);
  const portalHost = (tone === 'reader' && readerHost) || host;

  const closeToEditor = useCallback(() => {
    close(false);
    if (!editor.isDestroyed) editor.commands.focus();
  }, [close, editor]);

  // The editor became read-only (submitting, permission lost) while open.
  useEffect(() => {
    if (disabled && open) close(false);
  }, [disabled, open, close]);

  // Esc returns to the EDITOR; ↑/↓ with focus still outside move INTO the panel
  // (a mouse-opened menu left the caret in the text). Capture on window so this
  // runs before the hook's own document listener (which would focus the toolbar
  // button) and before ProseMirror sees the arrow.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        closeToEditor();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const root = panelRef.current;
      const active = root?.ownerDocument.activeElement ?? null;
      if (!root || (active && root.contains(active))) return; // the panel's own handler owns it
      e.stopPropagation();
      e.preventDefault();
      focusFirstIn(root);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, closeToEditor, panelRef]);

  // Focus inside once the panel is positioned.
  const focusInside = useRef(false);
  useEffect(() => {
    if (!open || !pos || !focusInside.current) return;
    focusInside.current = false;
    if (panelRef.current) focusFirstIn(panelRef.current);
  }, [open, pos, panelRef]);

  const openWith = useCallback(
    (inside: boolean) => {
      focusInside.current = inside || focusOnOpen;
      openPanel();
    },
    [focusOnOpen, openPanel],
  );

  const toggleFrom = useCallback(
    (event: ReactMouseEvent) => {
      if (open) {
        close(false);
        return;
      }
      openWith(event.detail === 0);
    },
    [open, close, openWith],
  );

  return { ...panel, box: placed ?? pos, portalHost, toggleFrom, openWith, closeToEditor };
}

/** The portaled panel shell. */
export function ToolbarPanelShell<T extends HTMLElement>({
  panel,
  label,
  role = 'dialog',
  width,
  className,
  children,
  onKeyDown,
}: {
  panel: ToolbarPanel<T>;
  label: string;
  role?: 'dialog' | 'menu';
  width: number;
  className?: string;
  children: ReactNode;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  // Tab never leaves an open panel: a menu closes back into the text (APG), a
  // dialog wraps. Without this, Tab walked out of the portal — which sits at the
  // END of <body> — onto whatever the page had there, including a navbar the
  // composer is holding hidden.
  const onShellKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab' && !event.defaultPrevented) {
      if (role === 'menu') {
        event.preventDefault();
        panel.closeToEditor();
        return;
      }
      const items = tabbableIn(event.currentTarget);
      const active = event.currentTarget.ownerDocument.activeElement;
      if (items.length > 0) {
        const edge = event.shiftKey ? items[0] : items[items.length - 1];
        if (active === edge) {
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0]).focus();
          return;
        }
      }
    }
    onKeyDown?.(event);
  };
  if (!panel.open || !panel.box || !panel.portalHost) return null;
  const style: CSSProperties = {
    left: panel.box.left,
    top: panel.box.top,
    maxHeight: panel.box.maxHeight,
    width: `min(${width}px, calc(100vw - 16px))`,
  };
  return createPortal(
    <div
      ref={panel.panelRef}
      role={role}
      aria-label={label}
      // z-[100]: the StickerPicker's layer — above sticky toolbars, drawers and dialogs that host an editor.
      className={`rte-toolbar-panel fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border shadow-xl ${cls.panel} ${className ?? ''}`}
      style={style}
      onKeyDown={onShellKeyDown}
    >
      {children}
    </div>,
    panel.portalHost,
  );
}

/** Arrow / Home / End between the menu's options (roles `menuitemradio`). */
export function menuKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const root = event.currentTarget;
  const items = Array.from(root.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([disabled])'));
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (at + 1 + items.length) % items.length
          : at < 0
            ? items.length - 1
            : (at - 1 + items.length) % items.length;
  items[next].focus();
}

/** One option of a dropdown menu. */
export function MenuOption({
  checked,
  onPick,
  children,
  style,
  className,
  value,
}: {
  checked: boolean;
  onPick: () => void;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  value?: string;
}) {
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      data-value={value}
      onMouseDown={keepEditorSelection}
      onClick={onPick}
      className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] ${cls.hover} ${cls.focus} ${checked ? cls.selected : ''} ${className ?? ''}`}
      style={style}
    >
      {children}
    </button>
  );
}

/** A dropdown trigger that shows its current value (字体 / 字号 / 行高). */
export const SelectTrigger = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    valueText: string;
    /**
     * What the value IS, when the visible text is a placeholder that names the
     * control instead (字号 shows 「字号」 while nothing is set — 「默认」 alone
     * was indistinguishable from the 字体 box beside it). Defaults to `valueText`.
     */
    ariaValue?: string;
    open: boolean;
    disabled?: boolean;
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
    className?: string;
    icon?: ReactNode;
    control: string;
  }
>(function SelectTrigger({ label, valueText, ariaValue, open, disabled, onClick, className, icon, control }, ref) {
  const spoken = ariaValue ?? valueText;
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={spoken ? `${label}: ${spoken}` : label}
      aria-haspopup="menu"
      aria-expanded={open}
      data-rte-control={control}
      disabled={disabled}
      onMouseDown={keepEditorSelection}
      onClick={onClick}
      className={`flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[12.5px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        open ? cls.on : cls.idle
      } ${className ?? ''}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{valueText}</span>
      <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
    </button>
  );
});
