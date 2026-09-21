import { describe, expect, it } from 'vitest';
import {
  activeCueIndexes,
  activeCueText,
  buildVtt,
  parseSubtitleFile,
  parseVtt,
  secondsToVttTime,
  stripCueMarkup,
  toTimedCues,
  vttTimeToSeconds,
  type TimedCue,
} from '@/lib/video/subtitles-shared';
import { cuesToTranscript, formatStamp, hasStamps, parseStamp, TRANSCRIPT_TRUNCATED_MARK } from '@/lib/video/transcript';
import {
  buildVideoChatSystem,
  buildVideoContext,
  buildVideoSummaryPrompt,
  CONTEXT_TRUNCATED_MARK,
  effectiveTranscript,
  hasAiGrounding,
  videoContextSourceHash,
} from '@/lib/video/ai';

describe('vtt time helpers', () => {
  it('reads hh:mm:ss.mmm, mm:ss.mmm and the SRT comma form', () => {
    expect(vttTimeToSeconds('00:00:01.500')).toBe(1.5);
    expect(vttTimeToSeconds('01:02.250')).toBe(62.25);
    expect(vttTimeToSeconds('01:00:00,000')).toBe(3600);
    expect(vttTimeToSeconds(' 00:00:04.000 align:start position:0%')).toBe(4);
  });
  it('rejects things that are not timestamps', () => {
    expect(vttTimeToSeconds('hello')).toBeNull();
    expect(vttTimeToSeconds('00:75:00.000')).toBeNull();
    expect(vttTimeToSeconds('00:00:61.000')).toBeNull();
  });
  it('round-trips through the canonical form', () => {
    for (const t of [0, 1.5, 62.25, 3599.999, 3600, 7325.042]) {
      expect(vttTimeToSeconds(secondsToVttTime(t))).toBeCloseTo(t, 3);
    }
    expect(secondsToVttTime(-5)).toBe('00:00:00.000');
    expect(secondsToVttTime(Number.NaN)).toBe('00:00:00.000');
  });
});

describe('parseSubtitleFile', () => {
  const SRT = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    '<i>大家好</i>，欢迎来到 <b>AI 极客访谈</b>',
    '',
    '2',
    '00:00:04,000 --> 00:00:06,000',
    '{\\an8}Line one',
    'Line two',
    '',
  ].join('\r\n');

  it('accepts SubRip and canonicalises it to VTT cues', () => {
    const cues = parseSubtitleFile(SRT);
    expect(cues).toEqual([
      { start: '00:00:01.000', end: '00:00:03.500', text: '大家好，欢迎来到 AI 极客访谈' },
      { start: '00:00:04.000', end: '00:00:06.000', text: 'Line one\nLine two' },
    ]);
    // …and what we store parses back to the same thing.
    expect(parseVtt(buildVtt(cues!))).toEqual(cues);
  });

  it('accepts WebVTT with a header, notes, cue ids and cue settings', () => {
    const vtt = 'WEBVTT - made by hand\n\nNOTE a comment\n\nintro\n00:01.000 --> 00:02.000 line:80%\n<v Bob>Hello</v>\n\n00:00:03.000 --> 00:00:04.000\nWorld\n';
    expect(parseSubtitleFile(vtt)).toEqual([
      { start: '00:00:01.000', end: '00:00:02.000', text: 'Hello' },
      { start: '00:00:03.000', end: '00:00:04.000', text: 'World' },
    ]);
  });

  it('sorts cues, drops empty and backwards ones, strips a BOM', () => {
    const raw = '\uFEFF00:00:05.000 --> 00:00:06.000\nB\n\n00:00:01.000 --> 00:00:02.000\nA\n\n00:00:09.000 --> 00:00:08.000\nbackwards\n\n00:00:10.000 --> 00:00:11.000\n<i></i>\n';
    expect(parseSubtitleFile(raw)?.map((c) => c.text)).toEqual(['A', 'B']);
  });

  it('returns null for files with nothing usable', () => {
    expect(parseSubtitleFile('just some text')).toBeNull();
    expect(parseSubtitleFile('WEBVTT\n\nNOTE only a note --> here\n')).toBeNull();
    expect(parseSubtitleFile('<html><script>alert(1)</script></html>')).toBeNull();
  });

  it('never lets markup reach the stored text', () => {
    expect(stripCueMarkup('<c.loud>HEY</c> <00:00:01.000>you &amp; me &lt;3')).toBe('HEY you & me <3');
    const cues = parseSubtitleFile('00:00:01.000 --> 00:00:02.000\n<font color="red">red</font>\n');
    expect(cues?.[0].text).toBe('red');
  });
});

describe('active cue lookup', () => {
  const cues: TimedCue[] = [
    { start: 1, end: 3, text: 'a' },
    { start: 3, end: 5, text: 'b' },
    { start: 4, end: 6, text: 'c (overlaps b)' },
    { start: 10, end: 12, text: 'd' },
  ];
  it('finds the cue on screen, boundaries half-open', () => {
    expect(activeCueIndexes(cues, 0.5)).toEqual([]);
    expect(activeCueIndexes(cues, 1)).toEqual([0]);
    expect(activeCueIndexes(cues, 2.99)).toEqual([0]);
    expect(activeCueIndexes(cues, 3)).toEqual([1]);
    expect(activeCueIndexes(cues, 8)).toEqual([]);
    expect(activeCueIndexes(cues, 11)).toEqual([3]);
    expect(activeCueIndexes(cues, 12)).toEqual([]);
  });
  it('returns overlapping cues in order', () => {
    expect(activeCueIndexes(cues, 4.5)).toEqual([1, 2]);
    expect(activeCueText(cues, 4.5)).toBe('b\nc (overlaps b)');
  });
  it('is safe on empty input and junk times', () => {
    expect(activeCueIndexes([], 1)).toEqual([]);
    expect(activeCueIndexes(cues, Number.NaN)).toEqual([]);
  });
  it('toTimedCues drops unparseable cues and sorts', () => {
    expect(
      toTimedCues([
        { start: '00:00:05.000', end: '00:00:06.000', text: 'late' },
        { start: 'junk', end: '00:00:02.000', text: 'bad' },
        { start: '00:00:01.000', end: '00:00:02.000', text: 'early' },
      ]).map((c) => c.text),
    ).toEqual(['early', 'late']);
  });
});

describe('transcript', () => {
  it('formats and parses stamps', () => {
    expect(formatStamp(0)).toBe('0:00');
    expect(formatStamp(754)).toBe('12:34');
    expect(formatStamp(3723)).toBe('1:02:03');
    expect(parseStamp('12:34')).toBe(754);
    expect(parseStamp('1:02:03')).toBe(3723);
    expect(parseStamp('90:00')).toBe(5400);
    expect(parseStamp('12:75')).toBeNull();
    expect(parseStamp('1:75:00')).toBeNull();
    expect(parseStamp('abc')).toBeNull();
  });

  it('merges cues into stamped paragraphs and breaks on pauses', () => {
    const cues: TimedCue[] = [
      { start: 0, end: 2, text: '大家好' },
      { start: 2, end: 4, text: '今天聊聊 Agent' },
      { start: 4.2, end: 6, text: 'and how it works' },
      { start: 20, end: 22, text: '第二部分' },
    ];
    expect(cuesToTranscript(cues)).toBe('[0:00] 大家好今天聊聊 Agent and how it works\n\n[0:20] 第二部分');
  });

  it('closes a paragraph once it is long enough', () => {
    const cues: TimedCue[] = Array.from({ length: 40 }, (_, i) => ({ start: i * 3, end: i * 3 + 3, text: `word${i}` }));
    const out = cuesToTranscript(cues, { maxParagraphSec: 30 });
    expect(out.split('\n\n').length).toBeGreaterThan(3);
    expect(out.startsWith('[0:00] word0 word1')).toBe(true);
    expect(out).toContain('[0:30] word10');
  });

  it('collapses whisper loops (the same line over and over)', () => {
    const cues: TimedCue[] = Array.from({ length: 30 }, (_, i) => ({ start: i, end: i + 1, text: '谢谢观看' }));
    expect(cuesToTranscript(cues)).toBe('[0:00] 谢谢观看');
  });

  it('cuts at a paragraph boundary with a marker', () => {
    const cues: TimedCue[] = Array.from({ length: 50 }, (_, i) => ({ start: i * 10, end: i * 10 + 2, text: `paragraph number ${i} `.repeat(3).trim() }));
    const out = cuesToTranscript(cues, { maxChars: 400 });
    expect(out.length).toBeLessThan(400 + TRANSCRIPT_TRUNCATED_MARK.length + 4);
    expect(out.endsWith(TRANSCRIPT_TRUNCATED_MARK)).toBe(true);
    expect(out).not.toMatch(/paragraph number \d+ paragraph number \d+ paragraph$/m);
  });

  it('knows a stamped transcript from a plain one', () => {
    expect(hasStamps('[0:00] hi\n\n[1:02:03] later')).toBe(true);
    expect(hasStamps('a pasted transcript without stamps')).toBe(false);
    expect(hasStamps(null)).toBe(false);
  });
});

describe('video AI context', () => {
  const base = { title: '  Agent 深度访谈 ', tags: ['agent', 'rl'] };

  it('prefers the manual transcript, falls back to the subtitle one', () => {
    expect(effectiveTranscript({ ...base, transcriptText: ' manual ', subtitleTranscript: '[0:00] auto' })).toBe('manual');
    expect(effectiveTranscript({ ...base, transcriptText: '  ', subtitleTranscript: '[0:00] auto' })).toBe('[0:00] auto');
    expect(hasAiGrounding({ ...base, subtitleTranscript: '[0:00] auto' })).toBe(true);
    expect(hasAiGrounding(base)).toBe(false);
  });

  it('assembles a fixed order and includes the speaker', () => {
    const ctx = buildVideoContext({
      ...base,
      durationSec: 3723,
      descriptionMd: '作者写的简介',
      intervieweeName: '王伟',
      intervieweeTitle: '首席科学家',
      intervieweeBio: '做了十年 RL',
      subtitleTranscript: '[0:00] 开场\n\n[0:30] 正题',
    });
    const order = ['# VIDEO TITLE', '# DURATION', '# TAGS', '# SPEAKER', '# DESCRIPTION', '# TRANSCRIPT'].map((h) => ctx.indexOf(h));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(ctx).toContain('王伟 · 首席科学家');
    expect(ctx).toContain('1:02:03');
    expect(ctx).toContain('[m:ss] timestamp');
  });

  it('only ever truncates the transcript, at a paragraph boundary', () => {
    const description = 'D'.repeat(3000);
    const transcript = Array.from({ length: 400 }, (_, i) => `[${formatStamp(i * 30)}] ${'x'.repeat(200)}`).join('\n\n');
    const ctx = buildVideoContext({ ...base, descriptionMd: description, subtitleTranscript: transcript }, 12_000);
    expect(ctx).toContain(description);
    expect(ctx.endsWith(CONTEXT_TRUNCATED_MARK)).toBe(true);
    expect(ctx.length).toBeLessThan(12_000 + 200);
    // the last kept paragraph is whole
    const lastPara = ctx.slice(0, ctx.lastIndexOf(CONTEXT_TRUNCATED_MARK)).trimEnd().split('\n\n').pop()!;
    expect(lastPara).toMatch(/^\[\d+:\d{2}\] x{200}$/);
  });

  it('the summary hash moves when subtitles arrive, and only then', () => {
    const before = videoContextSourceHash({ ...base, descriptionMd: 'd' });
    expect(videoContextSourceHash({ ...base, descriptionMd: 'd' })).toBe(before);
    expect(videoContextSourceHash({ ...base, descriptionMd: 'd', subtitleTranscript: '[0:00] hi' })).not.toBe(before);
    // a manual transcript shadows the subtitle one, so the subtitle one changing is not a change
    const manual = videoContextSourceHash({ ...base, transcriptText: 'm', subtitleTranscript: '[0:00] a' });
    expect(videoContextSourceHash({ ...base, transcriptText: 'm', subtitleTranscript: '[0:00] b' })).toBe(manual);
  });

  it('asks for a timeline and cited stamps only when the transcript has stamps', () => {
    const stamped = buildVideoContext({ ...base, subtitleTranscript: '[0:00] hi' });
    const plain = buildVideoContext({ ...base, descriptionMd: 'only a description' });
    expect(buildVideoSummaryPrompt(stamped).system).toContain('Timeline');
    expect(buildVideoSummaryPrompt(plain).system).not.toContain('Timeline');
    expect(buildVideoChatSystem(stamped, null).includes('[12:34]')).toBe(true);
    expect(buildVideoChatSystem(plain, null).includes('[12:34]')).toBe(false);
    // no token cap: a reasoning model must not be cut off inside <think>
    expect('maxTokens' in buildVideoSummaryPrompt(stamped)).toBe(false);
  });
});
