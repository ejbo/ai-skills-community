// Pages framed inside the side dock (PreviewProvider `page` target) must not
// use history navigation: an iframe shares the TOP window's session history,
// so `history.length > 1` is true and `router.back()` navigates the host page
// away — the "返回的路径不对" bug (2026-10-09). A framed page either navigates
// itself (the reader → its doc page, still inside the panel) or asks the host
// to close the panel.

export const PREVIEW_CLOSE_MESSAGE = 'preview:close';

export function isFramed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin top ⇒ definitely framed
  }
}

/** Ask the host page (same origin) to close the panel this page is framed in. */
export function requestPreviewClose(): void {
  if (!isFramed()) return;
  try {
    window.parent.postMessage({ type: PREVIEW_CLOSE_MESSAGE }, window.location.origin);
  } catch {
    /* no host listening — nothing to do */
  }
}
