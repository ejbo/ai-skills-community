'use client';

import { useEffect } from 'react';

const KEY = 'library:returnScroll';

/**
 * List scroll memory: DocCard links call rememberListScroll() on click, and
 * the list page mounts <ListScrollRestore /> to put the reader back exactly
 * where they were when they return (works for both browser-back AND re-entry
 * navigation, which Next's built-in popstate restore doesn't cover).
 */
export function rememberListScroll(): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ key: location.pathname + location.search, y: window.scrollY }),
    );
  } catch {
    /* ignore */
  }
}

export function ListScrollRestore() {
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      const { key, y } = JSON.parse(raw) as { key?: string; y?: number };
      if (key !== location.pathname + location.search || !y || y <= 0) return;
      sessionStorage.removeItem(KEY);
      // Double rAF lets the server-rendered list paint first; the late retry
      // covers layout shift from cover images loading in.
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
      const t = window.setTimeout(() => {
        if (Math.abs(window.scrollY - y) > 48) window.scrollTo(0, y);
      }, 300);
      return () => window.clearTimeout(t);
    } catch {
      return;
    }
  }, []);
  return null;
}
