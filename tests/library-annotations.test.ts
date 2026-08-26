import { describe, it, expect } from 'vitest';
import {
  annotatorStats,
  filterByAnnotators,
  othersOnly,
  type CommunityNote,
} from '@/components/library/reader/community-types';

const author = (handle: string, displayName = handle) => ({
  handle,
  displayName,
  avatarUrl: null,
  department: null,
  lab: null,
  isPrivate: false,
});

const note = (over: Partial<CommunityNote> & { id: string; handle: string }): CommunityNote => ({
  id: over.id,
  isMine: over.isMine ?? false,
  chapterIndex: over.chapterIndex ?? 0,
  charStart: over.charStart ?? 0,
  charEnd: over.charEnd ?? 10,
  quote: over.quote ?? 'quote',
  color: 'yellow',
  noteText: over.noteText ?? null,
  replyCount: over.replyCount ?? 0,
  likeCount: over.likeCount ?? 0,
  likedByMe: false,
  canModerate: false,
  createdAt: '2026-08-25T00:00:00.000Z',
  author: author(over.handle),
  authorRole: over.authorRole ?? null,
  replies: over.replies ?? [],
});

const NOTES: CommunityNote[] = [
  note({ id: '1', handle: 'expert', authorRole: { key: 'expert', name: '专家' }, likeCount: 5 }),
  note({ id: '2', handle: 'expert', likeCount: 2 }),
  note({ id: '3', handle: 'reader' }),
  note({ id: '4', handle: 'me', isMine: true }),
];

describe('annotator rail', () => {
  it('tallies each annotator and puts me first, then the most prolific', () => {
    const stats = annotatorStats(NOTES);
    expect(stats.map((s) => s.handle)).toEqual(['me', 'expert', 'reader']);
    const expert = stats.find((s) => s.handle === 'expert')!;
    expect(expert.count).toBe(2);
    expect(expert.likes).toBe(7);
  });

  it('keeps a role badge even when only one of the notes carries it', () => {
    // The rail must still mark 专家 when the newest note happened to omit it.
    const stats = annotatorStats([NOTES[1], NOTES[0]]);
    expect(stats.find((s) => s.handle === 'expert')!.role?.name).toBe('专家');
  });
});

describe('annotator filter', () => {
  it('treats an empty selection as everyone', () => {
    expect(filterByAnnotators(NOTES, [])).toHaveLength(4);
  });

  it('is MULTI-select — two people means exactly those two', () => {
    const picked = filterByAnnotators(NOTES, ['expert', 'reader']);
    expect(picked.map((n) => n.id)).toEqual(['1', '2', '3']);
  });

  it('can narrow to a single annotator', () => {
    expect(filterByAnnotators(NOTES, ['reader']).map((n) => n.id)).toEqual(['3']);
  });
});

describe('in-text markers', () => {
  it('excludes my own annotations — those already paint as real highlights', () => {
    expect(othersOnly(NOTES).map((n) => n.id)).toEqual(['1', '2', '3']);
  });

  it('composes with the annotator selection so page and list agree', () => {
    expect(filterByAnnotators(othersOnly(NOTES), ['expert']).map((n) => n.id)).toEqual(['1', '2']);
  });
});
