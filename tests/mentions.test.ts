// The @人 storage contract: a mention is an ordinary markdown link, so the
// invariants worth pinning are (a) what counts as one, (b) that a code fence
// never pings anyone, (c) that the cap holds, and (d) that an edit only ever
// notifies the people the edit ADDED.
import { describe, expect, it } from 'vitest';
import {
  MAX_MENTIONS_PER_CONTENT,
  extractMentionHandles,
  isMentionHref,
  mentionHandleOf,
  mentionMarkdown,
  newMentionHandles,
} from '@/lib/mentions';

describe('mentionMarkdown', () => {
  it('writes a profile link whose text is the display name', () => {
    expect(mentionMarkdown('王伟', 'z84412632')).toBe('[@王伟](/users/z84412632)');
  });

  it('never lets a name break out of the link text', () => {
    // `]` would end the label early and turn the rest into stray markdown.
    expect(mentionMarkdown('a]b', 'x')).toBe('[@a b](/users/x)');
    expect(mentionMarkdown('a\nb', 'x')).toBe('[@a b](/users/x)');
  });

  it('falls back to the handle when the name is empty', () => {
    expect(mentionMarkdown('   ', 'alice')).toBe('[@alice](/users/alice)');
  });
});

describe('isMentionHref / mentionHandleOf', () => {
  it('accepts a profile path and rejects anything else', () => {
    expect(isMentionHref('/users/alice')).toBe(true);
    expect(mentionHandleOf('/users/alice')).toBe('alice');
    for (const bad of ['/users/', '/users/a/b', 'https://x/users/alice', '/zones/alice', null, undefined]) {
      expect(isMentionHref(bad as string)).toBe(false);
      expect(mentionHandleOf(bad as string)).toBeNull();
    }
  });
});

describe('extractMentionHandles', () => {
  it('returns distinct handles in order', () => {
    const md = 'hi [@A](/users/a) and [@B](/users/b) and [@A again](/users/a)';
    expect(extractMentionHandles(md)).toEqual(['a', 'b']);
  });

  it('reads the href, never the text — a mismatched label cannot redirect the ping', () => {
    expect(extractMentionHandles('[@王伟](/users/alice)')).toEqual(['alice']);
  });

  it('ignores mentions inside a fenced block', () => {
    const md = ['before [@a](/users/a)', '```', '[@b](/users/b)', '```', 'after [@c](/users/c)'].join('\n');
    expect(extractMentionHandles(md)).toEqual(['a', 'c']);
  });

  it('handles a tilde fence and an unterminated one', () => {
    expect(extractMentionHandles('~~~\n[@a](/users/a)\n~~~\n[@b](/users/b)')).toEqual(['b']);
    expect(extractMentionHandles('```\n[@a](/users/a)')).toEqual([]);
  });

  it('caps the fan-out', () => {
    const md = Array.from({ length: MAX_MENTIONS_PER_CONTENT + 5 }, (_, i) => `[@u${i}](/users/u${i})`).join(' ');
    expect(extractMentionHandles(md)).toHaveLength(MAX_MENTIONS_PER_CONTENT);
  });

  it('is cheap and empty for a body with no profile links', () => {
    expect(extractMentionHandles('plain **text** [link](/zones/x)')).toEqual([]);
    expect(extractMentionHandles('')).toEqual([]);
  });
});

describe('newMentionHandles', () => {
  it('only reports people the edit added', () => {
    const before = 'hi [@a](/users/a)';
    const after = 'hi [@a](/users/a) and [@b](/users/b)';
    expect(newMentionHandles(after, before)).toEqual(['b']);
    expect(newMentionHandles(after, after)).toEqual([]);
  });

  it('treats a first save (no previous body) as all-new', () => {
    expect(newMentionHandles('[@a](/users/a)', null)).toEqual(['a']);
  });
});
