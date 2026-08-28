export interface NoteAuthor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department?: string | null;
  lab?: string | null;
  isPrivate?: boolean;
}

/** Named role behind a 专家 badge. `member` and every STAFF role are trimmed
 *  server-side by `publicRoleBadge` and never reach the client. */
export interface NoteAuthorRole {
  key: string;
  name: string;
}

export interface NoteReply {
  id: string;
  parentId: string | null;
  bodyMd: string;
  createdAt: string;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  author: NoteAuthor;
  authorRole: NoteAuthorRole | null;
  /** Second level only — the thread is flat below the root (house contract). */
  children?: NoteReply[];
}

export interface CommunityNote {
  id: string;
  isMine: boolean;
  chapterIndex: number;
  charStart: number;
  charEnd: number;
  quote: string;
  color: string;
  noteText: string | null;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  canModerate: boolean;
  createdAt: string;
  author: NoteAuthor;
  authorRole: NoteAuthorRole | null;
  replies: NoteReply[];
}

export const ANNOTATION_SORTS = ['position', 'recent', 'hot'] as const;
export type AnnotationSort = (typeof ANNOTATION_SORTS)[number];

/** Per-annotator tally for the filter rail. */
export interface AnnotatorStat {
  author: NoteAuthor;
  role: NoteAuthorRole | null;
  handle: string;
  count: number;
  likes: number;
  isMine: boolean;
}

/** Tally annotators for the filter rail, most prolific first (me always first). */
export function annotatorStats(notes: CommunityNote[]): AnnotatorStat[] {
  const by = new Map<string, AnnotatorStat>();
  for (const n of notes) {
    const key = n.author.handle;
    const cur =
      by.get(key) ??
      { author: n.author, role: n.authorRole, handle: key, count: 0, likes: 0, isMine: n.isMine };
    cur.count += 1;
    cur.likes += n.likeCount;
    if (n.authorRole && !cur.role) cur.role = n.authorRole;
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    return b.count - a.count || a.author.displayName.localeCompare(b.author.displayName);
  });
}

/**
 * Keep only the selected annotators. An EMPTY selection means "everyone" —
 * multi-select, so picking two people shows exactly those two.
 */
export function filterByAnnotators(notes: CommunityNote[], selected: string[]): CommunityNote[] {
  if (selected.length === 0) return notes;
  const want = new Set(selected);
  return notes.filter((n) => want.has(n.author.handle));
}

/** In-text markers: other people's shared annotations only (mine paint as real highlights). */
export function othersOnly(notes: CommunityNote[]): CommunityNote[] {
  return notes.filter((n) => !n.isMine);
}
