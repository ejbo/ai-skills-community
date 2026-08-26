'use client';

// 技术专区 preview drawer host. Mounted ONCE by app/zones/layout.tsx around
// every zone page; any embed card / attachment card / picker row calls
// `usePreview().open({ kind, ref, title })` and the right-side DrawerShell
// (components/motion — portal to body, scrim, spring slide, swipe-to-close,
// ESC, body scroll lock) shows the matching PreviewBody. Targets STACK: a post
// preview may open one of its own embeds; the header's back arrow pops one
// level, close/ESC/scrim clears the stack.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { DrawerShell } from '@/components/motion';
import type { EmbedKind } from '@/lib/zones/shared';
import { PreviewBody } from './PreviewBody';

export interface PreviewTarget {
  kind: EmbedKind;
  ref: string;
  title?: string;
}

export interface PreviewApi {
  open: (target: PreviewTarget) => void;
  close: () => void;
}

const NOOP_API: PreviewApi = { open: () => {}, close: () => {} };
const PreviewContext = createContext<PreviewApi>(NOOP_API);

/** Safe outside the provider (returns no-ops) so cards render anywhere. */
export function usePreview(): PreviewApi {
  return useContext(PreviewContext);
}

interface Frame extends PreviewTarget {
  /** Monotonic key so re-opening the same target remounts the body. */
  seq: number;
  /** Title resolved by the body once its data arrived. */
  liveTitle?: string;
  /** "Open in its own surface" href resolved by the body. */
  href?: string;
  external?: boolean;
}

export function PreviewProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('zones');
  const [stack, setStack] = useState<Frame[]>([]);
  const seqRef = useRef(0);
  // Keep the last frame while the drawer slides out, so it never empties mid-exit.
  const lastRef = useRef<Frame | null>(null);

  const open = useCallback((target: PreviewTarget) => {
    seqRef.current += 1;
    const frame: Frame = { ...target, seq: seqRef.current };
    setStack((s) => [...s, frame]);
  }, []);
  const close = useCallback(() => setStack([]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  const api = useMemo<PreviewApi>(() => ({ open, close }), [open, close]);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;
  if (current) lastRef.current = current;
  const shown = current ?? lastRef.current;

  const onResolved = useCallback((seq: number, info: { title?: string; href?: string; external?: boolean }) => {
    setStack((s) => s.map((f) => (f.seq === seq ? { ...f, liveTitle: info.title ?? f.liveTitle, href: info.href ?? f.href, external: info.external ?? f.external } : f)));
  }, []);

  const title = shown ? shown.liveTitle ?? shown.title ?? t(`embed_kind_${shown.kind}`) : '';

  const headerExtra = shown ? (
    <div className="flex items-center gap-1">
      {stack.length > 1 && (
        <button
          type="button"
          onClick={back}
          aria-label={t('preview_back')}
          title={t('preview_back')}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      {shown.href &&
        (shown.external ? (
          <a
            href={shown.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={t('preview_open_source')}
            aria-label={t('preview_open_source')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <Link
            href={shown.href}
            onClick={close}
            title={t('preview_open_source')}
            aria-label={t('preview_open_source')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        ))}
    </div>
  ) : null;

  return (
    <PreviewContext.Provider value={api}>
      {children}
      <DrawerShell open={current !== null} onClose={close} title={title} width={620} headerExtra={headerExtra}>
        {shown && (
          <PreviewBody
            key={shown.seq}
            target={shown}
            onResolved={(info) => onResolved(shown.seq, info)}
          />
        )}
      </DrawerShell>
    </PreviewContext.Provider>
  );
}
