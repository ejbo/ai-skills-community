import { describe, expect, it } from 'vitest';
import {
  STICKER_KEY_RE,
  STICKER_URL_PREFIX,
  isStickerSrc,
  stickerKeyFromSrc,
  stickerPublicUrl,
} from '@/lib/stickers';
import {
  MAX_POLLS_PER_CONTENT,
  POLL_TOKEN_GLOBAL_RE,
  POLL_TOKEN_RE,
  pollToken,
  splitPollSegments,
} from '@/lib/polls-shared';

describe('sticker URL/key contract', () => {
  it('round-trips key → url → key', () => {
    const key = 'stickers/V1StGXR8_Z5jdHi6B-myT.gif';
    const url = stickerPublicUrl(key);
    expect(url).toBe(`${STICKER_URL_PREFIX}V1StGXR8_Z5jdHi6B-myT.gif`);
    expect(isStickerSrc(url)).toBe(true);
    expect(stickerKeyFromSrc(url)).toBe(key);
  });

  it('rejects non-sticker srcs', () => {
    expect(isStickerSrc('/api/uploads/images/abc.png')).toBe(false);
    expect(stickerKeyFromSrc('/api/uploads/images/abc.png')).toBeNull();
    expect(stickerKeyFromSrc('https://evil.example/api/uploads/stickers/x.png')).toBeNull();
  });

  it('rejects traversal / foreign extensions / malformed escapes', () => {
    expect(stickerKeyFromSrc('/api/uploads/stickers/..%2F..%2Fsecret.png')).toBeNull();
    expect(stickerKeyFromSrc('/api/uploads/stickers/x.svg')).toBeNull();
    expect(stickerKeyFromSrc('/api/uploads/stickers/x.html')).toBeNull();
    expect(stickerKeyFromSrc('/api/uploads/stickers/%zz.png')).toBeNull();
    expect(STICKER_KEY_RE.test('stickers/../images/a.png')).toBe(false);
    expect(STICKER_KEY_RE.test('stickers/ok-name_123.webp')).toBe(true);
  });
});

describe('poll token splitting', () => {
  const id = 'clxyz12345abcde';

  it('matches own-line tokens, with or without markdown escapes', () => {
    expect(POLL_TOKEN_RE.test(`[poll:${id}]`)).toBe(true);
    expect(POLL_TOKEN_RE.test(`\\[poll:${id}\\]`)).toBe(true);
    expect(POLL_TOKEN_RE.test(`  [poll:${id}]  `)).toBe(true);
    expect(POLL_TOKEN_RE.test(`see [poll:${id}] inline`)).toBe(false);
    expect(POLL_TOKEN_RE.test('[poll:short]')).toBe(false); // < 8 chars
  });

  it('splits content around the token', () => {
    const md = `before\n\n${pollToken(id)}\n\nafter`;
    expect(splitPollSegments(md)).toEqual([
      { type: 'md', text: 'before\n' },
      { type: 'poll', id },
      { type: 'md', text: '\nafter' },
    ]);
  });

  it('handles token-only content and multiple polls', () => {
    expect(splitPollSegments(pollToken(id))).toEqual([{ type: 'poll', id }]);
    const two = splitPollSegments(`${pollToken(id)}\n${pollToken('abcdefgh')}`);
    expect(two).toEqual([
      { type: 'poll', id },
      { type: 'poll', id: 'abcdefgh' },
    ]);
  });

  it('leaves plain content untouched (single md segment, fast path)', () => {
    expect(splitPollSegments('hello **world**')).toEqual([
      { type: 'md', text: 'hello **world**' },
    ]);
    // inline mention does not split
    expect(splitPollSegments(`a [poll:${id}] b`)).toEqual([
      { type: 'md', text: `a [poll:${id}] b` },
    ]);
  });

  it('never splits inside fenced code blocks, and fences round-trip intact', () => {
    const md = 'how to embed:\n\n```\n' + pollToken(id) + '\n```\n\nafter';
    expect(splitPollSegments(md)).toEqual([{ type: 'md', text: md }]);
    // ~~~ fences too
    const tilde = '~~~\n' + pollToken(id) + '\n~~~';
    expect(splitPollSegments(tilde)).toEqual([{ type: 'md', text: tilde }]);
    // a token AFTER a properly closed fence still splits
    const closed = '```\ncode\n```\n' + pollToken(id);
    expect(splitPollSegments(closed)).toEqual([
      { type: 'md', text: '```\ncode\n```' },
      { type: 'poll', id },
    ]);
  });

  it('treats 4-space/tab indented token lines as code, not polls', () => {
    expect(splitPollSegments(`    ${pollToken(id)}`)).toEqual([
      { type: 'md', text: `    ${pollToken(id)}` },
    ]);
    expect(splitPollSegments(`\t${pollToken(id)}`)).toEqual([
      { type: 'md', text: `\t${pollToken(id)}` },
    ]);
    // ≤3 spaces is still a block-level token (CommonMark threshold)
    expect(splitPollSegments(`   ${pollToken(id)}`)).toEqual([{ type: 'poll', id }]);
  });

  it('dedupes repeated ids and caps widgets per content', () => {
    const twice = `${pollToken(id)}\n${pollToken(id)}`;
    expect(splitPollSegments(twice)).toEqual([
      { type: 'poll', id },
      { type: 'md', text: pollToken(id) }, // duplicate stays inert text
    ]);
    const ids = Array.from({ length: MAX_POLLS_PER_CONTENT + 3 }, (_, i) =>
      `pollid${String(i).padStart(4, '0')}`,
    );
    const many = splitPollSegments(ids.map((x) => `[poll:${x}]`).join('\n'));
    expect(many.filter((s) => s.type === 'poll')).toHaveLength(MAX_POLLS_PER_CONTENT);
  });

  it('POLL_TOKEN_GLOBAL_RE strips both plain and escaped forms', () => {
    const text = `a \\[poll:${id}\\] b [poll:${id}] c`;
    expect(text.replace(POLL_TOKEN_GLOBAL_RE, ' ').includes('poll:')).toBe(false);
  });
});
