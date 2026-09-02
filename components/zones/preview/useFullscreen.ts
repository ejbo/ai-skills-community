'use client';

// Fullscreen for the reading panel's preview wrapper (ref-tech §2.2, adopted
// verbatim). Truth comes from `fullscreenchange` (+ the WebKit-prefixed twin)
// ONLY — ESC / F11 / a tab switch exit natively and the click handler cannot
// know. `requestFullscreen` MUST be called synchronously inside the user's
// click (transient activation dies at the first `await`), so `enter()` is
// sync and only its promise rejection is observed. No API (iPhone — WebKit
// 212934 WONTFIX), `document.fullscreenEnabled === false` (the app framed
// without `allowfullscreen`) or a rejection fall back to 'maximized': the
// wrapper is drawn `fixed inset-0` by its owner and THIS hook owns the
// capture-phase ESC listener + body scroll lock for that mode (native handles
// both itself). Always fullscreen a stable wrapper inside the panel body —
// never the `motion.aside` an AnimatePresence may unmount (unmounting the
// fullscreen element exits fullscreen).

import { useCallback, useEffect, useState, type RefObject } from 'react';

export type FullscreenMode = 'off' | 'native' | 'maximized';

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

function fsDocument(): FsDocument {
  return document as FsDocument;
}

function fullscreenElement(): Element | null {
  const doc = fsDocument();
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function nativeAvailable(el: FsElement): boolean {
  const enabled = fsDocument().fullscreenEnabled;
  if (enabled === false) return false;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export interface Fullscreen {
  mode: FullscreenMode;
  isFull: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

export function useFullscreen(ref: RefObject<HTMLElement>): Fullscreen {
  const [mode, setMode] = useState<FullscreenMode>('off');

  useEffect(() => {
    const sync = () =>
      setMode((m) => {
        const el = ref.current;
        if (el && fullscreenElement() === el) return 'native';
        // Somebody else (the PDF viewer inside the iframe, another widget) may
        // be fullscreen — that is not us; only OUR native state flips back.
        return m === 'native' ? 'off' : m;
      });
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [ref]);

  // Maximize fallback: ESC + body scroll lock live here ONLY.
  useEffect(() => {
    if (mode !== 'maximized') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMode('off');
    };
    // Capture phase: it must run before DrawerShell's / the provider's window listeners.
    window.addEventListener('keydown', onKey, { capture: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      document.body.style.overflow = prevOverflow;
    };
  }, [mode]);

  const enter = useCallback(() => {
    const el = ref.current as FsElement | null;
    if (!el) return;
    if (!nativeAvailable(el)) {
      setMode('maximized');
      return;
    }
    try {
      const result = el.requestFullscreen
        ? el.requestFullscreen({ navigationUI: 'hide' })
        : el.webkitRequestFullscreen?.();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => setMode('maximized'));
      }
    } catch {
      setMode('maximized');
    }
  }, [ref]);

  const exit = useCallback(() => {
    if (fullscreenElement()) {
      const doc = fsDocument();
      try {
        const result = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        /* already out */
      }
      return;
    }
    setMode('off');
  }, []);

  const toggle = useCallback(() => {
    if (mode === 'off') enter();
    else exit();
  }, [mode, enter, exit]);

  return { mode, isFull: mode !== 'off', enter, exit, toggle };
}
