import type { PublicAuthor } from '@/lib/user-identity';

/** Client view of one short — exactly what the feed UI renders (no raw identity,
 * no server-only fields; authors already went through toPublicAuthor). */
export interface ShortView {
  id: string;
  slug: string;
  title: string;
  /** The caption. */
  summary: string;
  videoUrl: string | null;
  posterUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  featured: boolean;
  uploader: PublicAuthor;
  likedByMe: boolean;
  favoritedByMe: boolean;
}

export interface ShortsCurrentUser {
  id: string;
  isAdmin: boolean;
  handle?: string;
}

/** Per-cell imperative API the feed's keyboard shortcuts drive. */
export interface ShortsCellApi {
  togglePlay: () => void;
  toggleLike: () => void;
}
