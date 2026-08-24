// Serializable view types shared by the Discussion server pages, API routes
// and client components. Dates may arrive as Date (RSC props) or ISO strings
// (fetch responses) — always wrap in `new Date(...)` before formatting.

// Privacy contract (lib/user-identity.ts): authors arriving here MUST already
// have gone through toPublicAuthor() server-side — department/lab are null for
// private accounts, and UI must not render the @handle text when isPrivate.
export interface AuthorView {
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  department?: string | null;
  lab?: string | null;
  isPrivate?: boolean;
}

export type PostMediaKind = 'image' | 'video' | 'video_link' | 'file';

export interface MediaView {
  id: string;
  kind: PostMediaKind;
  url: string;
  posterUrl?: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  sortOrder: number;
}

export interface PostView {
  id: string;
  bodyMd: string;
  pinned: boolean;
  likeCount: number; // TOTAL reactions across all types
  commentCount: number;
  editedAt: string | Date | null;
  createdAt: string | Date;
  author: AuthorView;
  media: MediaView[];
  /** The viewer's reaction type, null when they haven't reacted. */
  myReaction: string | null;
  /** Per-type counts, sorted desc — feeds the summary pills. */
  reactions: { reaction: string; count: number }[];
}

export interface PostCommentView {
  id: string;
  bodyMd: string;
  status: 'visible' | 'deleted';
  parentId: string | null;
  likeCount: number;
  replyCount: number;
  createdAt: string | Date;
  author: AuthorView;
  likedByMe: boolean;
}

export interface PostThreadView extends PostCommentView {
  replies: PostCommentView[];
}

export interface CurrentUser {
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  canModerate: boolean;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
