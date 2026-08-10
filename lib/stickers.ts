// 表情包 (sticker) shared contract — CLIENT-SAFE, no Node imports.
//
// Sticker files live in the shared uploads root under the `stickers/` key
// namespace and are served by the public /api/uploads/[...key] route, so the
// stored markdown URL `/api/uploads/stickers/<file>` doubles as the render-time
// trust signal: MarkdownRenderer branches on this prefix (testing the RAW
// stored src, BEFORE withBasePath) to render a constrained-size sticker with
// the 添加到表情包 affordance instead of a regular image.
//
// The prefix is only a DISPLAY hint — anyone can type it in markdown. The
// add-to-my-stickers API re-validates the extracted key against
// STICKER_KEY_RE and checks the file actually exists in the stickers
// namespace before creating a row (never trust the client-sent URL).

/** Root-relative URL prefix every sticker image src starts with (raw stored form). */
export const STICKER_URL_PREFIX = '/api/uploads/stickers/';

/** Storage-key shape: "stickers/<nanoid>.<ext>", ext clamped to the image allowlist. */
export const STICKER_KEY_RE = /^stickers\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|avif|gif)$/;

/** Per-user library cap (WeChat caps at 999; keep headroom below disk concerns). */
export const MAX_STICKERS_PER_USER = 500;

/** How many rows the 最近 tab shows. */
export const RECENT_STICKERS_LIMIT = 30;

export interface StickerDto {
  id: string;
  key: string;
  url: string;
  favorited: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Is this RAW stored markdown src (root-relative, pre-withBasePath) a sticker? */
export function isStickerSrc(src: string): boolean {
  return src.startsWith(STICKER_URL_PREFIX);
}

/** Root-relative public URL for a sticker key (client-safe mirror of imagePublicUrl). */
export function stickerPublicUrl(key: string): string {
  return `/api/uploads/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Extract + validate the storage key from a sticker src. Accepts only the raw
 * root-relative form; returns null for anything that doesn't parse to a key
 * matching STICKER_KEY_RE (absolute URLs, traversal attempts, foreign paths).
 */
export function stickerKeyFromSrc(src: string): string | null {
  if (!isStickerSrc(src)) return null;
  let rest = src.slice('/api/uploads/'.length);
  try {
    rest = rest
      .split('/')
      .map((seg) => decodeURIComponent(seg))
      .join('/');
  } catch {
    return null;
  }
  return STICKER_KEY_RE.test(rest) ? rest : null;
}
