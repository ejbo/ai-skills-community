import { describe, expect, it } from 'vitest';
import { parseNumberedLines, translateCuesWith, TRANSLATE_CHUNK } from '@/lib/video/subtitle-translate';
import type { VttCue } from '@/lib/video/subtitles-shared';

const cue = (i: number): VttCue => ({ start: `00:00:${String(i % 60).padStart(2, '0')}.000`, end: `00:00:${String((i % 60) + 1).padStart(2, '0')}.000`, text: `line ${i}` });
const cues = (n: number) => Array.from({ length: n }, (_, i) => cue(i));
/** A model that translates every numbered line it is given. */
const echo = (user: string) =>
  user
    .split('\n')
    .map((l) => l.replace(/^(\d+)\. (.*)$/, '$1. 译:$2'))
    .join('\n');

describe('parseNumberedLines', () => {
  it('reads the common numbering styles', () => {
    const m = parseNumberedLines('1. a\n2、b\n3．c\n4) d\nnot a line');
    expect([...m.entries()]).toEqual([[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd']]);
  });
  it('ignores a reasoning block that quotes numbered lines', () => {
    const m = parseNumberedLines('<think>\n1. draft wrong\n2. draft wrong\n</think>\n1. 对\n2. 也对');
    expect(m.get(1)).toBe('对');
    expect(m.get(2)).toBe('也对');
  });
});

describe('translateCuesWith', () => {
  it('keeps count, order and timing', async () => {
    const input = cues(TRANSLATE_CHUNK * 2 + 5);
    const out = await translateCuesWith(input, 'zh', async (_s, u) => echo(u));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(input.length);
    expect(out!.every((c, i) => c.start === input[i].start && c.end === input[i].end)).toBe(true);
    expect(out![42].text).toBe('译:line 42');
  });

  it('survives a model that merges lines: retry, then split', async () => {
    let calls = 0;
    const flaky = async (_s: string, user: string) => {
      calls++;
      const lines = user.split('\n');
      // Any request of more than 4 lines comes back one line short.
      return lines.length > 4 ? echo(lines.slice(0, -1).join('\n')) : echo(user);
    };
    const out = await translateCuesWith(cues(20), 'en', flaky);
    expect(out!.map((c) => c.text)).toEqual(cues(20).map((c) => `译:${c.text}`));
    expect(calls).toBeGreaterThan(2);
  });

  it('a single stubborn cue keeps its original text instead of sinking the track', async () => {
    const stubborn = async (_s: string, user: string) =>
      user
        .split('\n')
        .filter((l) => !l.includes('line 7'))
        .map((l) => l.replace(/^(\d+)\. (.*)$/, '$1. 译:$2'))
        .join('\n');
    const out = await translateCuesWith(cues(12), 'zh', stubborn);
    expect(out).not.toBeNull();
    expect(out![7].text).toBe('line 7');
    expect(out![6].text).toBe('译:line 6');
    expect(out![8].text).toBe('译:line 8');
  });

  it('gives up fast when the model is down (no thousands of doomed calls)', async () => {
    let calls = 0;
    const down = async () => {
      calls++;
      throw new Error('fetch failed');
    };
    expect(await translateCuesWith(cues(300), 'zh', down)).toBeNull();
    expect(calls).toBeLessThanOrEqual(3);
  });

  it('refuses to ship a track that is mostly untranslated', async () => {
    const useless = async () => 'Sorry, I cannot help with that.';
    expect(await translateCuesWith(cues(10), 'en', useless)).toBeNull();
  });

  it('an empty track is an empty track', async () => {
    expect(await translateCuesWith([], 'zh', async () => '')).toEqual([]);
  });
});
