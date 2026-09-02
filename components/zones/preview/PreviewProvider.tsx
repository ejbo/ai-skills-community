'use client';

// 技术专区 preview host. Mounted ONCE by app/zones/layout.tsx (mode="dock")
// and app/discussion/layout.tsx (default mode="modal") around every page of
// the section; any embed card / attachment card / picker row calls
// `usePreview().open({ kind, ref, title, data?, siblings?, via? })`.
//
// Two hosts, one state:
//   - DOCK (mode='dock' on a desktop pointer ≥ lg): a non-modal, drag-resizable
//     `DockShell` aside on the right of the page — the article and the global
//     navbar stay fully usable (no scrim, no scroll lock, no aria-modal), the
//     navbar is HELD VISIBLE so the panel's top offset is a constant 68 px —
//     unless a hidden hold wins (the composer replaces the bar with its own),
//     in which case the offset follows the bar's RESOLVED state and is 0;
//     ESC is two-stage (fullscreen → panel), ⤢ expands the panel to the full
//     row (page `inert`, navbar hidden), ⛶ fullscreens the preview wrapper
//     (native, or the maximize fallback), ↑/↓ step through `siblings`, a
//     route change closes it (the width is a user preference and survives).
//   - MODAL (讨论区, and < lg / coarse pointer under zones): today's
//     `DrawerShell` (portal, scrim, spring slide, swipe-to-close, ESC, body
//     scroll lock) — unchanged behaviour.
// Targets STACK: a post preview may open one of its own embeds; ← pops one
// level, close / ESC / scrim clear the stack. A target that carries `data`
// (resolved on the page already) opens with no spinner.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ChevronDown, ChevronUp, Expand, ExternalLink, Maximize2, Minimize2, Shrink } from 'lucide-react';
import { BTN_ICON } from '@/app/zones/_components/ui';
import { DrawerShell } from '@/components/motion';
import { DockShell } from '@/components/motion/DockShell';
import { EMBED_KIND_ICONS } from '@/components/zones/embeds/EmbedCard';
import { TWEEN } from '@/lib/motion';
import { holdNavBarHidden, holdNavBarVisible, useNavBarVisible } from '@/lib/nav-chrome';
import type { EmbedKind } from '@/lib/zones/shared';
import type { EmbedData } from '@/lib/zones/types';
import { PreviewBody, type PreviewResolvedInfo } from './PreviewBody';
import { FilePreviewFooter } from './kinds/FilePreview';
import { pageBandFor, type PageBand } from './page-band';
import { dockTopOffset, isDockSash } from './panel-shared';
import { DOCK_DEFAULT, DOCK_STORAGE_KEY, readStoredWidth } from './split-shared';
import { useFullscreen } from './useFullscreen';

export type { PageBand } from './page-band';

export interface PreviewTarget {
  kind: EmbedKind;
  ref: string;
  title?: string;
  /** Pre-resolved embed for kind+ref: the body renders instantly and skips /api/zones/embed. */
  data?: EmbedData;
  /** Ordered neighbours for ↑/↓ in the panel header (a post's attachments). The current index is found by kind+ref. */
  siblings?: PreviewTarget[];
  /** 'keyboard' ⇒ focus moves to the panel's ✕ on open and returns to the opener on close; 'pointer' (default) leaves focus alone. */
  via?: 'pointer' | 'keyboard';
}

export interface PreviewApi {
  /** Pushes on the stack; `replace` semantics for ↑/↓ are internal. */
  open: (target: PreviewTarget) => void;
  close: () => void;
  /** Top of the stack (kind / ref / title are the stable part). */
  current: PreviewTarget | null;
  /** True when the non-modal docked host is active (mode='dock' on a desktop pointer) and open. */
  isDocked: boolean;
}

const NOOP_API: PreviewApi = { open: () => {}, close: () => {}, current: null, isDocked: false };
const PreviewContext = createContext<PreviewApi>(NOOP_API);

/** Safe outside the provider (returns no-ops) so cards render anywhere. */
export function usePreview(): PreviewApi {
  return useContext(PreviewContext);
}

const PageBandContext = createContext<PageBand>('wide');
/** 'wide' outside a provider, on the server and before measurement. */
export function usePageBand(): PageBand {
  return useContext(PageBandContext);
}

/** The aside's DOM id — `aria-controls` target of the sash and of openers. */
export const DOCK_ID = 'zones-preview-dock';

const DESKTOP_QUERY = '(min-width: 1024px) and (pointer: fine)';

interface Frame extends PreviewTarget {
  /** Monotonic key so re-opening the same target remounts the body. */
  seq: number;
  /** Title resolved by the body once its data arrived. */
  liveTitle?: string;
  /** "Open in its own surface" href resolved by the body. */
  href?: string;
  external?: boolean;
  /** The embed the body rendered (pre-resolved or fetched) — feeds the dock footer. */
  embed?: EmbedData;
  /** false once the body decided ⛶ makes no sense (link, download cards). */
  fullscreenable?: boolean;
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el instanceof HTMLElement && (el.isContentEditable || el.getAttribute('contenteditable') === 'true');
}

function siblingIndex(frame: PreviewTarget): number {
  return frame.siblings ? frame.siblings.findIndex((s) => s.kind === frame.kind && s.ref === frame.ref) : -1;
}

export function PreviewProvider({ children, mode = 'modal' }: { children: ReactNode; mode?: 'dock' | 'modal' }) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion() ?? false;
  const pathname = usePathname();

  const [stack, setStack] = useState<Frame[]>([]);
  const stackRef = useRef<Frame[]>([]);
  const seqRef = useRef(0);
  // Keep the last frame while the drawer slides out, so it never empties mid-exit.
  const lastRef = useRef<Frame | null>(null);
  // M8: direction of the next body slide (open / ↓ = forward, back / ↑ = backward).
  const dirRef = useRef<1 | -1>(1);
  // Keyboard-opened sessions return focus to their opener on close.
  const keyboardRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const [width, setWidth] = useState(DOCK_DEFAULT);
  const [expanded, setExpanded] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [pageBand, setPageBand] = useState<PageBand>('wide');
  const pageRef = useRef<HTMLDivElement>(null);
  // The fullscreen target is a stable wrapper INSIDE PreviewBody, never the
  // motion.aside (unmounting the fullscreen element exits fullscreen).
  const fsRef = useRef<HTMLDivElement>(null);
  const fs = useFullscreen(fsRef);

  const dock = mode === 'dock';
  const docked = dock && desktop;
  const open = stack.length > 0;
  const current = open ? stack[stack.length - 1] : null;
  if (current) lastRef.current = current;
  const shown = current ?? lastRef.current;

  useEffect(() => {
    stackRef.current = stack;
  }, [stack]);

  // ── host detection (effects only: SSR and the first client render are modal-closed / 'wide') ──
  useEffect(() => {
    if (!dock) return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [dock]);

  useEffect(() => {
    if (!dock) return;
    try {
      setWidth(readStoredWidth(localStorage.getItem(DOCK_STORAGE_KEY), window.innerWidth));
    } catch {
      /* storage blocked — the default width is fine */
    }
  }, [dock]);

  useEffect(() => {
    if (!dock) return;
    const el = pageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setPageBand(pageBandFor(el.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [dock]);

  // ── stack ops ──
  const open_ = useCallback((target: PreviewTarget) => {
    seqRef.current += 1;
    dirRef.current = 1;
    if (stackRef.current.length === 0) {
      keyboardRef.current = target.via === 'keyboard';
      openerRef.current =
        target.via === 'keyboard' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const frame: Frame = { ...target, seq: seqRef.current };
    setStack((s) => [...s, frame]);
  }, []);

  const fsStateRef = useRef(fs);
  useEffect(() => {
    fsStateRef.current = fs;
  });

  const close = useCallback(() => {
    setStack([]);
    setExpanded(false);
    if (fsStateRef.current.isFull) fsStateRef.current.exit();
    const opener = openerRef.current;
    if (keyboardRef.current && opener && opener.isConnected) {
      // Expand mode left the page wrapper `inert`; React drops the attribute
      // only at the next commit and `focus()` inside an inert subtree is a
      // no-op — the keyboard user would land on <body> once the ✕ unmounts.
      // Lift it here, synchronously, before handing focus back.
      const page = pageRef.current;
      if (page) {
        page.removeAttribute('inert');
        page.removeAttribute('aria-hidden');
      }
      opener.focus({ preventScroll: true });
    }
    keyboardRef.current = false;
    openerRef.current = null;
  }, []);

  const back = useCallback(() => {
    dirRef.current = -1;
    setStack((s) => s.slice(0, -1));
  }, []);

  const stepSibling = useCallback((dir: 1 | -1) => {
    const s = stackRef.current;
    const top = s[s.length - 1];
    if (!top?.siblings?.length) return;
    const i = siblingIndex(top);
    const next = i < 0 ? undefined : top.siblings[i + dir];
    if (!next) return;
    seqRef.current += 1;
    dirRef.current = dir;
    const frame: Frame = { ...next, siblings: top.siblings, via: 'pointer', seq: seqRef.current };
    setStack([...s.slice(0, -1), frame]);
  }, []);

  const patchFrame = useCallback((seq: number, patch: Partial<Frame>) => {
    setStack((s) => {
      const i = s.findIndex((f) => f.seq === seq);
      if (i < 0) return s;
      const f = s[i];
      let changed = false;
      for (const k of Object.keys(patch) as (keyof Frame)[]) {
        if (patch[k] !== undefined && patch[k] !== f[k]) changed = true;
      }
      if (!changed) return s;
      const next = s.slice();
      next[i] = { ...f, ...patch };
      return next;
    });
  }, []);

  const onResolved = useCallback(
    (seq: number, info: PreviewResolvedInfo) => {
      patchFrame(seq, { liveTitle: info.title, href: info.href, external: info.external, embed: info.embed });
    },
    [patchFrame],
  );
  const onFullscreenable = useCallback(
    (seq: number, ok: boolean) => {
      patchFrame(seq, { fullscreenable: ok });
    },
    [patchFrame],
  );

  // ── route change: the preview is contextual to the page that opened it (ref-tech §4.1) ──
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    close();
  }, [pathname, close]);

  // ── navbar: held VISIBLE beside the dock (constant 68 px offset), HIDDEN in expand / maximize ──
  useEffect(() => {
    if (!(docked && open)) return;
    if (expanded || fs.mode === 'maximized') return holdNavBarHidden();
    if (fs.mode === 'native') return; // top layer — nothing to coordinate
    return holdNavBarVisible();
  }, [docked, open, expanded, fs.mode]);
  // The bar's RESOLVED state: a hidden hold (the composer's own bar) beats the
  // visible hold above, and then there is no strip to reserve.
  const navVisible = useNavBarVisible();

  // ── derived header state ──
  const currentPublic = useMemo<PreviewTarget | null>(
    () => (current ? { kind: current.kind, ref: current.ref, title: current.title, data: current.data, siblings: current.siblings } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current?.kind, current?.ref, current?.title, current?.data, current?.siblings],
  );
  const api = useMemo<PreviewApi>(
    () => ({ open: open_, close, current: currentPublic, isDocked: docked && open }),
    [open_, close, currentPublic, docked, open],
  );

  const sibCount = shown?.siblings?.length ?? 0;
  const sibIndex = shown ? siblingIndex(shown) : -1;
  const canFullscreen = !!shown && shown.kind !== 'link' && shown.fullscreenable !== false;
  const title = shown ? shown.liveTitle ?? shown.title ?? t(`embed_kind_${shown.kind}`) : '';
  const bodyMode: 'scroll' | 'fill' = shown?.kind === 'file' ? 'fill' : 'scroll';
  const topOffset = dockTopOffset({ expanded, maximized: fs.mode === 'maximized', navVisible });

  const expandedRef = useRef(expanded);
  const canFullscreenRef = useRef(canFullscreen);
  const sibCountRef = useRef(sibCount);
  useEffect(() => {
    expandedRef.current = expanded;
    canFullscreenRef.current = canFullscreen;
    sibCountRef.current = sibCount;
  });

  // ── keyboard (dock only — the modal DrawerShell keeps its own ESC) ──
  useEffect(() => {
    if (!(docked && open)) return;
    const onKey = (e: KeyboardEvent) => {
      const aside = document.getElementById(DOCK_ID);
      const active = document.activeElement;
      // The sash is a sibling of the aside and carries the keyboard hint — it counts as inside.
      const inAside = !!active && ((!!aside && aside.contains(active)) || isDockSash(active, DOCK_ID));
      if (e.key === 'Escape') {
        // (0) a sash drag owns ESC (useSplitResize cancels it in the capture phase — belt and braces here).
        if (aside?.hasAttribute('data-dragging')) return;
        // (1) fullscreen exits on its own (native ESC is browser-driven; maximize has a capture listener).
        if (document.fullscreenElement || fsStateRef.current.mode !== 'off') return;
        // (2) a modal (lightbox, menu, picker) owns ESC while it is open.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        // (3) the comment box keeps its ESC.
        if (isEditable(active) && !inAside) return;
        if (expandedRef.current) {
          setExpanded(false);
          return;
        }
        close();
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!inAside || isEditable(active)) return;
      if (e.key === 'f' || e.key === 'F') {
        if (!canFullscreenRef.current) return;
        e.preventDefault();
        fsStateRef.current.toggle(); // synchronous — keydown is a user activation
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && sibCountRef.current > 1) {
        e.preventDefault();
        stepSibling(e.key === 'ArrowUp' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked, open, close, stepSibling]);

  // ── header slots ──
  const backButton =
    stack.length > 1 ? (
      <button type="button" onClick={back} aria-label={t('preview_back')} title={t('preview_back')} className={BTN_ICON}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ) : null;

  const openSource = shown?.href ? (
    shown.external ? (
      <a
        href={shown.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={t('preview_open_source')}
        aria-label={t('preview_open_source')}
        className={BTN_ICON}
      >
        <ExternalLink className="h-4 w-4" aria-hidden />
      </a>
    ) : (
      <Link href={shown.href} onClick={close} title={t('preview_open_source')} aria-label={t('preview_open_source')} className={BTN_ICON}>
        <ExternalLink className="h-4 w-4" aria-hidden />
      </Link>
    )
  ) : null;

  const fullscreenButton = canFullscreen ? (
    <button
      type="button"
      onClick={fs.toggle}
      aria-label={fs.isFull ? t('panel_exit_fullscreen') : t('panel_fullscreen')}
      title={fs.isFull ? t('panel_exit_fullscreen') : t('panel_fullscreen')}
      aria-pressed={fs.isFull}
      className={BTN_ICON}
    >
      {fs.isFull ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
    </button>
  ) : null;

  const dockHeaderExtra = shown ? (
    <>
      {sibCount > 1 && (
        <>
          <button
            type="button"
            onClick={() => stepSibling(-1)}
            disabled={sibIndex <= 0}
            aria-label={t('panel_prev')}
            title={t('panel_prev')}
            className={BTN_ICON}
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => stepSibling(1)}
            disabled={sibIndex < 0 || sibIndex >= sibCount - 1}
            aria-label={t('panel_next')}
            title={t('panel_next')}
            className={BTN_ICON}
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
          <span className="px-1 font-mono text-[11px] tabular-nums text-muted">
            {t('panel_position', { n: Math.max(0, sibIndex) + 1, total: sibCount })}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? t('panel_collapse') : t('panel_expand')}
        title={expanded ? t('panel_collapse') : t('panel_expand')}
        aria-pressed={expanded}
        className={BTN_ICON}
      >
        {expanded ? <Shrink className="h-4 w-4" aria-hidden /> : <Expand className="h-4 w-4" aria-hidden />}
      </button>
      {fullscreenButton}
      {openSource}
    </>
  ) : null;

  const modalHeaderExtra = shown ? (
    <div className="flex items-center gap-1">
      {backButton}
      {dock && fullscreenButton}
      {openSource}
    </div>
  ) : null;

  const footer =
    shown?.kind === 'file' && shown.embed?.ok && shown.embed.kind === 'file' ? <FilePreviewFooter data={shown.embed.data} /> : undefined;

  const KindIcon = shown ? EMBED_KIND_ICONS[shown.kind] : null;
  const labels = useMemo(
    () => ({ close: t('panel_close'), resize: t('panel_resize'), region: t('panel_aria'), keyboardHint: t('panel_keyboard_hint') }),
    [t],
  );

  const body = shown ? (
    <PreviewBody
      key={shown.seq}
      target={shown}
      fill={docked && bodyMode === 'fill'}
      docked={docked}
      fsRef={fsRef}
      isFull={fs.isFull}
      fullscreenMode={fs.mode}
      onToggleFullscreen={fs.toggle}
      onResolved={(info) => onResolved(shown.seq, info)}
      onFullscreenable={(ok) => onFullscreenable(shown.seq, ok)}
    />
  ) : null;

  const pageInert = docked && expanded;
  const inertAttr = (pageInert ? { inert: '' } : {}) as unknown as HTMLAttributes<HTMLDivElement>;

  return (
    <PreviewContext.Provider value={api}>
      <PageBandContext.Provider value={pageBand}>
        {dock ? (
          // The wrapper is ALWAYS rendered in dock mode (also below lg) so a
          // desktop ↔ touch flip never re-parents the page subtree; only the
          // aside branch depends on the measured host.
          <div className="flex min-h-full items-stretch" data-dock={docked && open ? 'open' : 'closed'}>
            <div
              ref={pageRef}
              className={`min-w-0 flex-1 ${pageInert ? 'overflow-hidden' : ''}`}
              data-page={pageBand}
              aria-hidden={pageInert ? 'true' : undefined}
              {...inertAttr}
            >
              {children}
            </div>
            <AnimatePresence initial={false}>
              {docked && open && shown && (
                <DockShell
                  key="dock"
                  id={DOCK_ID}
                  width={width}
                  onWidthCommit={setWidth}
                  onClose={close}
                  title={title}
                  kindIcon={KindIcon ? <KindIcon className="h-4 w-4" /> : undefined}
                  headerStart={backButton ?? undefined}
                  headerExtra={dockHeaderExtra}
                  bodyMode={bodyMode}
                  footer={footer}
                  expanded={expanded}
                  topOffset={topOffset}
                  autoFocusClose={shown.via === 'keyboard'}
                  labels={labels}
                  reduce={reduce}
                >
                  {/* M8: stack / sibling travel — a slide + fade keyed on the frame (client-only mount). */}
                  <motion.div
                    key={shown.seq}
                    className={bodyMode === 'fill' ? 'flex min-h-0 flex-1 flex-col' : undefined}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, x: dirRef.current * 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={reduce ? { duration: 0 } : TWEEN}
                  >
                    {body}
                  </motion.div>
                </DockShell>
              )}
            </AnimatePresence>
          </div>
        ) : (
          children
        )}
        {!docked && (
          <DrawerShell open={open} onClose={close} title={title} width={620} headerExtra={modalHeaderExtra}>
            {body}
          </DrawerShell>
        )}
      </PageBandContext.Provider>
    </PreviewContext.Provider>
  );
}
