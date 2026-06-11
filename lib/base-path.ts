/**
 * Prepend the configured base path to a root-relative URL, for subpath deploys
 * (e.g. the app reverse-proxied under "/community"). Set NEXT_PUBLIC_BASE_PATH
 * (= NEXT_BASE_PATH) at build time; leave unset for root/local dev (no-op).
 *
 * Absolute http(s) URLs and data:/blob: URLs pass through unchanged. The
 * convention across the app is to STORE root-relative media URLs and apply this
 * at RENDER time, so stored content stays portable across deploy paths.
 *
 * (lib/video/types.ts has its own copy predating this shared helper; this is the
 * neutral home so non-video code — e.g. MarkdownRenderer — can use it too.)
 */
export function withBasePath(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const bp = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return url.startsWith('/') ? `${bp}${url}` : url;
}
