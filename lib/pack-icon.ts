/**
 * Pack icons are either an emoji string ("📦") or an uploaded image URL
 * ("/api/uploads/…", stored root-relative — apply withBasePath at render).
 * Shared by PackCard / the pack detail page (server) and PackManager (client).
 */
export function isIconImage(icon: string): boolean {
  return icon.startsWith('/') || icon.startsWith('http');
}
