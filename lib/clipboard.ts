/**
 * Copy text to the clipboard, working in BOTH secure and insecure contexts.
 *
 * `navigator.clipboard` only exists in a secure context (HTTPS or localhost).
 * When the site is served over plain HTTP on an IP (e.g. http://35.165.188.177:3000)
 * it is `undefined`, so `navigator.clipboard.writeText(...)` throws. We fall back
 * to the legacy `document.execCommand('copy')`, which works over plain HTTP.
 *
 * Returns true on success, false if every strategy failed (caller shows an error).
 * Must be called from a user-gesture handler (click) for the fallback to work.
 */
export async function copyText(text: string): Promise<boolean> {
  // Preferred: async Clipboard API — only when it can actually succeed.
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }

  // Fallback: hidden textarea + execCommand('copy'). Deprecated but works over HTTP.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
