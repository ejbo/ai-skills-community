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
  /**
   * The top visible root comments (最相关 order) a FEED card shows under the
   * actions before 查看全部评论. Absent on the permalink page and on a freshly
   * published post, where the full comment section is the only view.
   */
  previewComments?: PostCommentView[];
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

/** A forum topic as a card in the 全部 stream (lib/discussion-queries.ts#listDiscussionStream). */
export interface TopicCardView {
  id: string;
  title: string;
  excerpt: string;
  tags: { slug: string; name: string; nameEn: string; official: boolean }[];
  pinned: boolean;
  locked: boolean;
  upvoteCount: number;
  replyCount: number;
  viewCount: number;
  upvotedByMe: boolean;
  lastActivityAt: string | Date;
  createdAt: string | Date;
  author: AuthorView;
  /** Recent distinct repliers, newest first (≤4). */
  participants: AuthorView[];
}

/** One row of the 全部 stream — a feed post or a forum topic. */
export type StreamItemView =
  | { kind: 'post'; post: PostView }
  | { kind: 'topic'; topic: TopicCardView };

export interface CurrentUser {
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  canModerate: boolean;
}

// No byte formatter here: file sizes go through lib/files/display.ts
// `formatBytes` / `fileMetaParts`, the same copy the viewer drawer uses — this
// board's own `(n/1024).toFixed(0)` once put "2 KB" on a card whose drawer said
// "1.5 KB".
