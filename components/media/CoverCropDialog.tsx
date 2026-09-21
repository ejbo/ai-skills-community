'use client';

// 封面裁切对话框 — <CoverCropEditor/> in a portaled modal. Surface-neutral: the
// host says which frames the surface shows (`ratioFor`) and supplies the strings;
// 技术专区 (CoverAdjustDialog) and the long-video form both wrap this one shell.
//
// It stores nothing itself: `aspect` / `pos` live in the host and every change
// applies LIVE, so there is no 取消 to reason about — ✕ / Esc / 完成 all just close.
//
// It may open from inside another modal (the zones composer's settings drawer:
// z-95, Esc on `window`, bubble phase). Hence:
//   · portaled to `usePortalHost()` at z-[100] — a drawer's panel is a
//     transformed box, a `fixed` child would be trapped inside it;
//   · Esc is taken in the CAPTURE phase and stopped, so one press closes this
//     dialog and leaves whatever is under it open;
//   · the scrim closes only on a press that BEGAN on the scrim — releasing a
//     crop-frame drag outside the panel must not dismiss the dialog.

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { CoverCropEditor, type CoverCropLabels } from '@/components/media/CoverCropEditor';
import { usePortalHost } from '@/components/usePortalHost';
import type { CoverAspect } from '@/lib/media/cover-pos';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface CoverCropDialogProps {
  open: boolean;
  /** Stored root-relative url (or blob:) of the cover being framed. */
  imageUrl: string;
  aspect: CoverAspect;
  pos: string;
  /** Width ÷ height of the frame for an aspect — the SAME function the surface's renderer uses. */
  ratioFor: (aspect: CoverAspect) => number;
  /** Omit to lock the aspect (no 横版/竖版 toggle). */
  onAspectChange?: (aspect: CoverAspect) => void;
  onPosChange: (pos: string) => void;
  onClose: () => void;
  title: string;
  closeLabel: string;
  doneLabel: string;
  hint?: string;
  /** Editor strings; omitted ones fall back to the shared `ui.crop_*` messages. */
  labels?: Partial<CoverCropLabels>;
  /** Extra content under the editor — e.g. the host's own "实际展示" previews. */
  children?: ReactNode;
}

export function CoverCropDialog(props: CoverCropDialogProps) {
  const host = usePortalHost();
  if (!props.open || !host) return null;
  return createPortal(<Panel {...props} />, host);
}

function Panel({ imageUrl, aspect, pos, ratioFor, onAspectChange, onPosChange, onClose, title, closeLabel, doneLabel, hint, labels, children }: CoverCropDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const downOnScrim = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus in / return, Esc, Tab containment, body scroll lock — once per open.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const raf = requestAnimationFrame(() => panel?.focus({ preventScroll: true }));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-zinc-950/60 p-0 sm:items-center sm:p-6"
      onPointerDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnScrim.current) onClose();
        downOnScrim.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-800 dark:bg-zinc-950 sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100/30"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 sm:px-5">
          <CoverCropEditor
            imageUrl={imageUrl}
            aspect={aspect}
            pos={pos}
            ratioFor={ratioFor}
            onAspectChange={onAspectChange}
            onPosChange={onPosChange}
            labels={labels}
            // A host that brings its own previews replaces the editor's single-frame one.
            framePreview={!children}
          >
            {children}
          </CoverCropEditor>
          {hint && <p className="mt-3 text-xs leading-relaxed text-muted">{hint}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950"
          >
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
