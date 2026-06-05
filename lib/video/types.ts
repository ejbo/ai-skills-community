// Shared, non-Prisma types for the video board. Row shapes returned by the
// query layer are derived from Prisma selects in lib/video/queries.ts.

export type VideoSort = 'latest' | 'trending' | 'popular';
export type CommentSort = 'top' | 'newest';

export const VIDEO_SORTS: VideoSort[] = ['latest', 'trending', 'popular'];
export const COMMENT_SORTS: CommentSort[] = ['top', 'newest'];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A horizontal row of cards on the Netflix/YouTube-style home feed. */
export interface VideoRail<T> {
  key: string;
  title: string;
  /** Optional "see all" target, e.g. /videos?category=xxx */
  href?: string;
  videos: T[];
}

export function parseVideoSort(value: string | null | undefined): VideoSort {
  return value === 'trending' || value === 'popular' ? value : 'latest';
}

export function parseCommentSort(value: string | null | undefined): CommentSort {
  return value === 'newest' ? 'newest' : 'top';
}

/** Human-readable duration badge, e.g. 75 -> "1:15", 3725 -> "1:02:05". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Compact view/like count, e.g. 1500 -> "1.5K", 2_300_000 -> "2.3M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

/**
 * Prepend the configured base path to a root-relative media URL (locally-hosted
 * video/poster like "/api/videos/file/..."). Absolute http(s) URLs (e.g. the
 * external demo MP4s) and data:/blob: URLs pass through unchanged.
 *
 * For a subpath deploy, set NEXT_PUBLIC_BASE_PATH (= NEXT_BASE_PATH) at build
 * time. For root/local deploys leave it unset — this is then a no-op.
 */
export function withBasePath(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const bp = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return url.startsWith('/') ? `${bp}${url}` : url;
}
