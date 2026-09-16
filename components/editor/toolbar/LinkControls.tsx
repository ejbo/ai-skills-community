'use client';

// 插入/编辑链接 — the toolbar button, its dialog, and the bubble that appears
// while the caret sits in a link. The document work is link-edit.ts; this file
// is placement, focus and the form.
//
// The dialog (display text + link address, 确定 / 取消 / 移除链接) opens from the
// toolbar button, from ⌘K / Ctrl+K, or from the bubble's 编辑. It reads its draft from the live
// selection when it opens (linkDraftFor) and MAPS the edited range through
// every transaction that lands while it is open — an image upload finishing in
// the background must not make 确定 re-link the wrong words. Enter submits
// (a real <form>), Esc cancels back into the editor.
//
// The bubble (打开 / 编辑 / 取消链接) follows the caret, never the mouse: it is
// shown while the editor has focus and the caret is inside a link, placed under
// the caret line, and hidden while it would sit over the sticky toolbar, outside
// the editor's own scroll box or off screen. An @mention gets 打开 only — its
// label and href are the notification contract (lib/mentions.ts).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ExternalLink, Link as LinkIcon, Pencil, Unlink } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { visibleViewport } from '@/components/useAnchoredPanel';
import {
  applyLinkEdit,
  linkDraftFor,
  normalizeLinkHref,
  removeLinkAt,
  type LinkDraft,
  type LinkRange,
} from '@/components/editor/toolbar/link-edit';
import {
  ToolbarButton,
  ToolbarPanelShell,
  keepEditorSelection,
  toolbarClasses,
  useToolbarPanel,
  useToolbarTone,
  type ToolbarPanel,
} from '@/components/editor/toolbar/primitives';

const PANEL_W = 320;
const PANEL_H = 236;

/** The ⌘K keymap, registered on the live editor while the toolbar is mounted. */
const LinkShortcutPluginKey = new PluginKey('rteLinkShortcut');

export function LinkControls({
  editor,
  active,
  disabled,
  editorDisabled,
  link,
  suppressBubble,
}: {
  editor: Editor;
  /** The selection is in / on a link (toolbar pressed state). */
  active: boolean;
  /** The toolbar button cannot run here (a mention, code). */
  disabled: boolean;
  /** The whole editor is read-only. */
  editorDisabled: boolean;
  /** The link the focused caret is in (the bubble's subject), or null. */
  link: LinkRange | null;
  /** Another mode owns the pointer (格式刷 armed). */
  suppressBubble: boolean;
}) {
  const t = useTranslations('ui');
  const tone = useToolbarTone();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  const panel = useToolbarPanel<HTMLElement>({
    editor,
    tone,
    width: PANEL_W,
    height: PANEL_H,
    disabled: editorDisabled,
    focusOnOpen: true,
    onClose: () => setDraft(null),
  });
  const { open, triggerRef, openWith, close } = panel;

  // The bubble unmounts as soon as the dialog takes focus, so a dialog opened
  // from its 编辑 button cannot stay anchored to that button (a detached node
  // measures 0,0). It anchors to this page-positioned stand-in instead, placed
  // over the button's box at open time — it scrolls with the text like the
  // bubble did.
  const standInRef = useRef<HTMLSpanElement | null>(null);
  useEffect(
    () => () => {
      standInRef.current?.remove();
      standInRef.current = null;
    },
    [],
  );
  const standInFor = useCallback((el: HTMLElement): HTMLElement => {
    let span = standInRef.current;
    if (!span) {
      span = document.createElement('span');
      span.setAttribute('aria-hidden', 'true');
      span.dataset.rteLinkAnchor = '';
      span.style.cssText = 'position:absolute;pointer-events:none;visibility:hidden;';
      document.body.appendChild(span);
      standInRef.current = span;
    }
    const r = el.getBoundingClientRect();
    span.style.left = `${r.left + window.scrollX}px`;
    span.style.top = `${r.top + window.scrollY}px`;
    span.style.width = `${r.width}px`;
    span.style.height = `${r.height}px`;
    return span;
  }, []);

  const openAt = useCallback(
    (anchor: HTMLElement | null, detached = false) => {
      if (!anchor || editor.isDestroyed) return;
      const next = linkDraftFor(editor.state);
      rangeRef.current = next.range;
      setDraft(next);
      triggerRef.current = detached ? standInFor(anchor) : anchor;
      openWith(true);
    },
    [editor, triggerRef, openWith, standInFor],
  );

  // ⌘K / Ctrl+K. It is a plugin on the LIVE editor, not an entry in the shared
  // extension list, because what it opens is this component — a headless editor
  // has no dialog to show. Kept off the effect's deps through a ref: re-running
  // registerPlugin reconfigures the editor state, which is not something a
  // render should do.
  const openShortcutRef = useRef<() => void>(() => {});
  openShortcutRef.current = () => {
    if (!disabled && !open) openAt(buttonRef.current);
  };
  useEffect(() => {
    if (editorDisabled || editor.isDestroyed) return;
    editor.registerPlugin(
      new Plugin({
        key: LinkShortcutPluginKey,
        props: {
          handleKeyDown: (_view, event) => {
            if (event.altKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return false;
            // The site-wide ⌘K search palette listens on `window`
            // (components/SearchTrigger.tsx) and does not look at
            // defaultPrevented — it must not open on top of the dialog.
            event.stopPropagation();
            openShortcutRef.current();
            return true;
          },
        },
      }),
    );
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(LinkShortcutPluginKey);
    };
  }, [editor, editorDisabled]);

  // Keep the edited range on the same words while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map(pos: number, assoc?: number): number } } }) => {
      const range = rangeRef.current;
      if (!transaction.docChanged || !range) return;
      const from = transaction.mapping.map(range.from, 1);
      rangeRef.current = { from, to: Math.max(from, transaction.mapping.map(range.to, -1)) };
    };
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [open, editor]);

  return (
    <>
      <ToolbarButton
        ref={buttonRef}
        control="link"
        title={t('rte_link_edit')}
        shortcut="link"
        active={active}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) close(false);
          else openAt(buttonRef.current);
        }}
      >
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      {open && draft && <LinkForm panel={panel} editor={editor} draft={draft} rangeRef={rangeRef} />}
      <LinkBubble
        editor={editor}
        link={open || suppressBubble || editorDisabled ? null : link}
        onEdit={(anchor) => openAt(anchor, true)}
      />
    </>
  );
}

function LinkForm({
  panel,
  editor,
  draft,
  rangeRef,
}: {
  panel: ToolbarPanel<HTMLElement>;
  editor: Editor;
  draft: LinkDraft;
  rangeRef: React.MutableRefObject<{ from: number; to: number } | null>;
}) {
  const t = useTranslations('ui');
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  const [text, setText] = useState(draft.text);
  const [href, setHref] = useState(draft.href);
  const [invalid, setInvalid] = useState(false);

  const submit = () => {
    if (!normalizeLinkHref(href)) {
      setInvalid(true);
      return;
    }
    applyLinkEdit(editor, { range: draft.range ? rangeRef.current : null, text, originalText: draft.text, href, textEditable: draft.textEditable });
    panel.closeToEditor();
  };

  const remove = () => {
    if (rangeRef.current) removeLinkAt(editor, rangeRef.current);
    panel.closeToEditor();
  };

  const field = `h-8 w-full rounded-md border px-2 text-[13px] ${cls.field} ${cls.focus}`;
  const label = `mb-1 block text-[11px] font-medium ${cls.muted}`;
  const btn = `h-8 rounded-md px-3 text-[13px] font-medium ${cls.focus}`;

  return (
    <ToolbarPanelShell panel={panel} label={t('rte_link_edit')} width={PANEL_W} className="p-3">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={label} htmlFor="rte-link-text">
          {t('rte_link_text')}
        </label>
        <input
          id="rte-link-text"
          type="text"
          value={text}
          disabled={!draft.textEditable}
          placeholder={t('rte_link_text_placeholder')}
          onChange={(e) => setText(e.target.value)}
          className={`${field} disabled:opacity-60`}
          autoComplete="off"
        />
        <label className={`${label} mt-2.5`} htmlFor="rte-link-url">
          {t('rte_link_url')}
        </label>
        <input
          id="rte-link-url"
          data-autofocus
          type="text"
          inputMode="url"
          value={href}
          placeholder={t('rte_link_url_placeholder')}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'rte-link-url-err' : undefined}
          onChange={(e) => {
            setHref(e.target.value);
            if (invalid) setInvalid(false);
          }}
          className={`${field} font-mono text-[12.5px] ${invalid ? 'border-red-500' : ''}`}
        />
        {invalid && (
          <p id="rte-link-url-err" role="alert" className="mt-1 text-[11px] leading-4 text-red-600 dark:text-red-400">
            {t('rte_link_invalid')}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          {draft.existing && (
            <button type="button" onClick={remove} className={`${btn} mr-auto px-2 ${cls.muted} ${cls.hover}`}>
              {t('rte_link_remove')}
            </button>
          )}
          <button type="button" onClick={() => panel.closeToEditor()} className={`${btn} ${draft.existing ? '' : 'ml-auto'} ${cls.hover}`}>
            {t('rte_link_cancel')}
          </button>
          <button type="submit" disabled={href.trim() === ''} className={`${btn} ${cls.primary} disabled:cursor-not-allowed disabled:opacity-40`}>
            {t('rte_link_ok')}
          </button>
        </div>
      </form>
    </ToolbarPanelShell>
  );
}

const BUBBLE_GAP = 6;
const EDGE = 8;

function LinkBubble({ editor, link, onEdit }: { editor: Editor; link: LinkRange | null; onEdit: (anchor: HTMLElement) => void }) {
  const t = useTranslations('ui');
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  const [host, setHost] = useState<Element | null>(null);

  useEffect(() => {
    if (!link || editor.isDestroyed) return;
    const reader = tone === 'reader' ? editor.view.dom.closest('.reader-root') : null;
    setHost(reader ?? document.fullscreenElement ?? document.body);
  }, [link, tone, editor]);

  // The bubble follows the CARET, and the editor host no longer re-renders per
  // transaction (EditorToolbar#useToolbarState) — nor would it for a caret that
  // merely moves inside the same link. While a bubble is on screen this watches
  // the selection itself.
  const [selection, setSelection] = useState(() => editor.state.selection);
  useEffect(() => {
    if (!link) return;
    const sync = () => setSelection((prev) => (prev === editor.state.selection ? prev : editor.state.selection));
    sync();
    editor.on('transaction', sync);
    return () => {
      editor.off('transaction', sync);
    };
  }, [link, editor]);

  const place = useCallback(() => {
    if (!link || editor.isDestroyed) {
      setBox(null);
      return;
    }
    const view = editor.view;
    let start: { left: number; top: number };
    let caret: { left: number; top: number; bottom: number };
    try {
      start = view.coordsAtPos(link.from, 1);
      caret = view.coordsAtPos(view.state.selection.from);
    } catch {
      setBox(null);
      return;
    }
    const vp = visibleViewport();
    const scroller = view.dom.parentElement?.getBoundingClientRect();
    const toolbar = view.dom.closest('.rte')?.querySelector('.rte-toolbar')?.getBoundingClientRect();
    const topLimit = Math.max(vp.top, scroller?.top ?? -Infinity, toolbar?.bottom ?? -Infinity);
    const bottomLimit = Math.min(vp.top + vp.height, scroller?.bottom ?? Infinity);
    if (caret.bottom <= topLimit || caret.top >= bottomLimit) {
      setBox(null);
      return;
    }
    const w = bubbleRef.current?.offsetWidth || 220;
    const h = bubbleRef.current?.offsetHeight || 34;
    // Under the link's first character when it starts on the caret's line, else under the caret.
    const anchorLeft = Math.abs(start.top - caret.top) < 4 ? start.left : caret.left;
    const left = Math.round(Math.min(Math.max(anchorLeft, vp.left + EDGE), Math.max(vp.left + EDGE, vp.left + vp.width - EDGE - w)));
    let top = caret.bottom + BUBBLE_GAP;
    if (top + h > vp.top + vp.height - EDGE) top = caret.top - BUBBLE_GAP - h;
    top = Math.round(top);
    setBox((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [link, editor]);

  useLayoutEffect(() => {
    place();
  }, [place, selection, host]);

  useEffect(() => {
    if (!link) return;
    let frame = 0;
    const reposition = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [link, place]);

  if (!link || !box || !host) return null;
  const openHref = link.href.startsWith('/') ? withBasePath(link.href) : link.href;
  const iconBtn = `flex h-6 w-6 items-center justify-center rounded-md ${cls.hover} ${cls.focus}`;

  return createPortal(
    <div
      ref={bubbleRef}
      role="group"
      aria-label={t('rte_link_bubble')}
      data-rte-link-bubble
      className={`fixed z-[90] flex max-w-[calc(100vw-16px)] items-center gap-0.5 rounded-lg border px-1 py-1 text-[12px] shadow-lg ${cls.panel}`}
      style={{ left: box.left, top: box.top }}
    >
      <a
        href={openHref}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={link.href}
        aria-label={t('rte_link_open_url', { url: link.href })}
        onMouseDown={keepEditorSelection}
        className={`flex h-6 min-w-0 max-w-[15rem] items-center gap-1.5 rounded-md px-1.5 ${cls.hover} ${cls.focus}`}
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="shrink-0 font-medium">{t('rte_link_open')}</span>
        <span className={`min-w-0 truncate ${cls.muted}`}>{link.href}</span>
      </a>
      {!link.mention && (
        <>
          <span aria-hidden className={`mx-0.5 h-4 w-px ${tone === 'reader' ? 'bg-[var(--reader-border)]' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
          <button
            ref={editRef}
            type="button"
            title={t('rte_link_edit_short')}
            aria-label={t('rte_link_edit_short')}
            onMouseDown={keepEditorSelection}
            onClick={() => editRef.current && onEdit(editRef.current)}
            className={iconBtn}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            title={t('rte_link_unlink')}
            aria-label={t('rte_link_unlink')}
            onMouseDown={keepEditorSelection}
            onClick={() => removeLinkAt(editor, { from: link.from, to: link.to })}
            className={iconBtn}
          >
            <Unlink className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      )}
    </div>,
    host,
  );
}
