'use client';

// Unsaved-changes guard for the settings editors.
//
// Two exits need covering and the App Router offers a hook for neither:
//   · a hard exit (reload, close tab, external link) → `beforeunload`;
//   · a soft exit through a <Link> (the settings nav, 查看主页) → a CAPTURE-phase
//     document click listener. It runs before React's root listener, so
//     `preventDefault()` there reaches next/link's `onClick`, which returns early
//     on `e.defaultPrevented` — the navigation never starts.
// Browser back/forward inside the app is NOT covered (no cancellable event
// exists for it); that is an accepted gap, same as every other form here.

import { useEffect } from 'react';

export function useUnsavedGuard(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome still requires returnValue to be set to show the prompt.
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return; // new tab: nothing is lost
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // full navigation → beforeunload prompts
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
