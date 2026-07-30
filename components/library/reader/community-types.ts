export interface NoteAuthor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department?: string | null;
  lab?: string | null;
  isPrivate?: boolean;
}

export interface CommunityNote {
  id: string;
  isMine: boolean;
  chapterIndex: number;
  charStart: number;
  quote: string;
  color: string;
  noteText: string | null;
  replyCount: number;
  createdAt: string;
  author: NoteAuthor;
  replies: { id: string; bodyMd: string; createdAt: string; author: NoteAuthor }[];
}
