import { describe, expect, it } from 'vitest';
import {
  MAX_SHORT_CAPTION_CHARS,
  decodeShortsCursor,
  encodeShortsCursor,
  isValidShortPosterKey,
  isValidShortSourceKey,
  parseShortsSort,
  shortTitleFromCaption,
} from '@/lib/video/shorts-shared';
import { parseShortCaptionResult } from '@/lib/video/shorts-caption';

describe('shorts storage-key validation', () => {
  it('accepts real upload keys', () => {
    expect(isValidShortSourceKey('source/V1StGXR8_Z5jdHi6B.mp4')).toBe(true);
    expect(isValidShortSourceKey('source/abc-123.webm')).toBe(true);
    expect(isValidShortSourceKey('source/abc.mov')).toBe(true);
    expect(isValidShortPosterKey('poster/xyz_9.jpg')).toBe(true);
    expect(isValidShortPosterKey('poster/xyz.webp')).toBe(true);
  });

  it('rejects traversal, wrong kinds and wrong extensions', () => {
    expect(isValidShortSourceKey('../etc/passwd')).toBe(false);
    expect(isValidShortSourceKey('source/../x.mp4')).toBe(false);
    expect(isValidShortSourceKey('poster/abc.mp4')).toBe(false);
    expect(isValidShortSourceKey('preview/abc.mp4')).toBe(false);
    expect(isValidShortSourceKey('source/abc.html')).toBe(false);
    expect(isValidShortSourceKey('source/abc.mp4/extra')).toBe(false);
    expect(isValidShortPosterKey('source/abc.jpg')).toBe(false);
    expect(isValidShortPosterKey('poster/abc.svg')).toBe(false);
  });
});

describe('shorts feed cursor', () => {
  it('round-trips the keyset cursor', () => {
    const row = { createdAt: new Date('2026-08-11T03:04:05.678Z'), id: 'ckabc123' };
    const decoded = decodeShortsCursor(encodeShortsCursor(row));
    expect(decoded?.id).toBe('ckabc123');
    expect(decoded?.createdAt.getTime()).toBe(row.createdAt.getTime());
  });

  it('rejects malformed cursors instead of throwing', () => {
    expect(decodeShortsCursor(null)).toBeNull();
    expect(decodeShortsCursor('')).toBeNull();
    expect(decodeShortsCursor('no-separator')).toBeNull();
    expect(decodeShortsCursor('not-a-date|id')).toBeNull();
    expect(decodeShortsCursor('|id')).toBeNull();
    expect(decodeShortsCursor('2026-08-11T00:00:00.000Z|')).toBeNull();
  });

  it('normalizes sort values', () => {
    expect(parseShortsSort('new')).toBe('new');
    expect(parseShortsSort('hot')).toBe('hot');
    expect(parseShortsSort('bogus')).toBe('hot');
    expect(parseShortsSort(null)).toBe('hot');
  });
});

describe('parseShortCaptionResult', () => {
  it('extracts the caption from a plain JSON reply', () => {
    expect(parseShortCaptionResult('{"caption": "很棒的视频 #AI"}')).toBe('很棒的视频 #AI');
  });

  it('skips a closed reasoning block before the JSON', () => {
    expect(
      parseShortCaptionResult('先想想。</think>\n{"caption": "润色后的文案"}'),
    ).toBe('润色后的文案');
  });

  it('returns null on an unterminated reasoning opener (truncation)', () => {
    expect(parseShortCaptionResult('<think>还在思考 {"caption": "x"}')).toBeNull();
  });

  it('returns null when there is no usable caption', () => {
    expect(parseShortCaptionResult('sorry, no json here')).toBeNull();
    expect(parseShortCaptionResult('{"caption": ""}')).toBeNull();
    expect(parseShortCaptionResult('{}')).toBeNull();
  });

  it('clamps overlong captions', () => {
    const long = 'x'.repeat(MAX_SHORT_CAPTION_CHARS * 2);
    expect(parseShortCaptionResult(JSON.stringify({ caption: long }))?.length).toBe(
      MAX_SHORT_CAPTION_CHARS,
    );
  });
});

describe('shortTitleFromCaption', () => {
  it('takes the first line, collapses whitespace, clamps length', () => {
    expect(shortTitleFromCaption('第一行标题\n第二行忽略')).toBe('第一行标题');
    expect(shortTitleFromCaption('  a   b  ')).toBe('a b');
    expect(shortTitleFromCaption('t'.repeat(200)).length).toBe(60);
  });

  it('falls back when the caption has no usable first line', () => {
    expect(shortTitleFromCaption('\n\n正文')).toBe('短视频');
  });
});

describe('subtitle VTT helpers', async () => {
  const { parseVtt, buildVtt, detectSubtitleLang } = await import('@/lib/video/subtitles-shared');

  it('parses and rebuilds a VTT round-trip', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n大家好\n\n00:00:03.500 --> 00:00:06.000\n欢迎来到 AI Community\n';
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: '00:00:01.000', end: '00:00:03.500', text: '大家好' });
    expect(buildVtt(cues)).toContain('00:00:03.500 --> 00:00:06.000\n欢迎来到 AI Community');
  });

  it('tolerates hour-less timestamps, cue ids and settings', () => {
    const vtt = 'WEBVTT\n\n1\n01:02.000 --> 01:04.000 align:center\nhello there\n';
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBe('01:02.000');
    expect(cues[0].text).toBe('hello there');
  });

  it('ignores malformed blocks instead of throwing', () => {
    expect(parseVtt('WEBVTT\n\nnot a cue at all')).toEqual([]);
    expect(parseVtt('')).toEqual([]);
  });

  it('detects zh vs en cue language', () => {
    expect(
      detectSubtitleLang([{ start: '0', end: '1', text: '这是一段中文字幕内容' }]),
    ).toBe('zh');
    expect(
      detectSubtitleLang([{ start: '0', end: '1', text: 'this is english subtitle text' }]),
    ).toBe('en');
  });
});
