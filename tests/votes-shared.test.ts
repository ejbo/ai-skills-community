import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAME_RULE,
  applyNameRule,
  competitionRanks,
  parseCustomFields,
  parseNameRule,
  resolveCustomAnswers,
  seededShuffle,
  voteDayKey,
  voteOver,
  voteStarted,
  votingOpen,
  type VoteNameRule,
} from '@/lib/votes/shared';

describe('applyNameRule', () => {
  const rule: VoteNameRule = {
    stripExt: true,
    prefix: '参赛-',
    delimiter: '-',
    title: { mode: 'from', index: 2 },
    author: { mode: 'segment', index: 0 },
    authorNo: { mode: 'segment', index: 1 },
  };

  it('extracts author / 工号 / multi-segment title from a delimited filename', () => {
    const parsed = applyNameRule('参赛-张三-A12345678-日落时分-最终版v2.mp4', rule);
    expect(parsed.authorName).toBe('张三');
    expect(parsed.authorNo).toBe('a12345678'); // lowercased per EmployeeDirectory contract
    expect(parsed.title).toBe('日落时分-最终版v2'); // 'from' keeps later delimiters
  });

  it('resolves missing segments to empty strings instead of throwing', () => {
    const parsed = applyNameRule('孤独的文件名.jpg', rule);
    expect(parsed.authorName).toBe('孤独的文件名');
    expect(parsed.authorNo).toBe('');
    expect(parsed.title).toBe('');
  });

  it('default rule keeps the whole basename as the title', () => {
    const parsed = applyNameRule('team_photo_2026.png', DEFAULT_NAME_RULE);
    expect(parsed.title).toBe('team_photo_2026');
    expect(parsed.authorName).toBe('');
  });

  it('treats every delimiter character as a separator and collapses runs', () => {
    const r: VoteNameRule = {
      ...DEFAULT_NAME_RULE,
      delimiter: '-_ ',
      title: { mode: 'segment', index: 2 },
      author: { mode: 'segment', index: 0 },
    };
    expect(applyNameRule('李四__b0099-城市 印象.webm', r)).toMatchObject({
      authorName: '李四',
      title: '城市',
    });
  });

  it('only strips the prefix when present, and only from the start', () => {
    const r: VoteNameRule = { ...DEFAULT_NAME_RULE, prefix: 'IMG_', title: { mode: 'full' } };
    expect(applyNameRule('IMG_0042.jpg', r).title).toBe('0042');
    expect(applyNameRule('X_IMG_0042.jpg', r).title).toBe('X_IMG_0042');
  });

  it("a '-' in the delimiter set is literal — range-like sets never throw or form ranges", () => {
    const r: VoteNameRule = {
      ...DEFAULT_NAME_RULE,
      delimiter: '0-9',
      title: { mode: 'segment', index: 1 },
    };
    // literal chars {0,-,9} split; the range [0-9] would instead split at the
    // digits 1 and 2 and yield 'b-c' here.
    expect(applyNameRule('a1b-c2d.png', r).title).toBe('c2d');
    const reversed: VoteNameRule = { ...DEFAULT_NAME_RULE, delimiter: 'z-a', title: { mode: 'full' } };
    expect(() => applyNameRule('x-y.png', reversed)).not.toThrow();
  });

  it('regex metacharacters in the delimiter set are literal', () => {
    const r: VoteNameRule = {
      ...DEFAULT_NAME_RULE,
      delimiter: '.',
      stripExt: false,
      title: { mode: 'segment', index: 0 },
    };
    expect(applyNameRule('作品.王五.mp4', r).title).toBe('作品');
  });

  it('strips directory-ish prefixes defensively', () => {
    expect(applyNameRule('C:\\Users\\me\\pic.png', DEFAULT_NAME_RULE).title).toBe('pic');
    expect(applyNameRule('a/b/pic.png', DEFAULT_NAME_RULE).title).toBe('pic');
  });
});

describe('parseNameRule', () => {
  it('round-trips a valid rule', () => {
    const rule: VoteNameRule = {
      stripExt: false,
      prefix: 'p-',
      delimiter: '_',
      title: { mode: 'from', index: 1 },
      author: { mode: 'segment', index: 0 },
      authorNo: { mode: 'none' },
    };
    expect(parseNameRule(JSON.parse(JSON.stringify(rule)))).toEqual(rule);
  });

  it('rejects malformed shapes', () => {
    expect(parseNameRule(null)).toBeNull();
    expect(parseNameRule('x')).toBeNull();
    expect(parseNameRule({})).toBeNull();
    expect(
      parseNameRule({ ...DEFAULT_NAME_RULE, title: { mode: 'segment', index: -1 } }),
    ).toBeNull();
    expect(
      parseNameRule({ ...DEFAULT_NAME_RULE, title: { mode: 'segment', index: 1.5 } }),
    ).toBeNull();
    expect(parseNameRule({ ...DEFAULT_NAME_RULE, delimiter: 'x'.repeat(9) })).toBeNull();
  });
});

describe('vote window', () => {
  const now = new Date('2026-08-17T12:00:00Z');

  it('voteOver honors closedAt over endAt', () => {
    expect(voteOver({ startAt: null, endAt: null, closedAt: '2026-08-01T00:00:00Z' }, now)).toBe(true);
    expect(voteOver({ startAt: null, endAt: '2026-08-18T00:00:00Z', closedAt: null }, now)).toBe(false);
    expect(voteOver({ startAt: null, endAt: '2026-08-17T12:00:00Z', closedAt: null }, now)).toBe(true);
    expect(voteOver({ startAt: null, endAt: null, closedAt: null }, now)).toBe(false);
  });

  it('voteStarted / votingOpen gate on startAt and status', () => {
    const w = { startAt: '2026-08-18T00:00:00Z', endAt: null, closedAt: null };
    expect(voteStarted(w, now)).toBe(false);
    expect(votingOpen('published', w, now)).toBe(false);
    expect(votingOpen('published', { ...w, startAt: null }, now)).toBe(true);
    expect(votingOpen('draft', { ...w, startAt: null }, now)).toBe(false);
  });
});

describe('voteDayKey', () => {
  it("is '' for total budgets", () => {
    expect(voteDayKey('total')).toBe('');
  });

  it('buckets by Beijing calendar day', () => {
    // 2026-08-17T15:59Z = 23:59 Beijing; 16:01Z = next day 00:01 Beijing.
    expect(voteDayKey('daily', new Date('2026-08-17T15:59:00Z'))).toBe('2026-08-17');
    expect(voteDayKey('daily', new Date('2026-08-17T16:01:00Z'))).toBe('2026-08-18');
  });
});

describe('seededShuffle', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it('is deterministic per seed and a real permutation', () => {
    const a = seededShuffle(items, 'user1:act1');
    const b = seededShuffle(items, 'user1:act1');
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toBe(items);
  });

  it('differs across seeds (position-bias removal)', () => {
    const a = seededShuffle(items, 'user1:act1');
    const b = seededShuffle(items, 'user2:act1');
    expect(a).not.toEqual(b);
  });
});

describe('custom submission fields', () => {
  const fields = [
    { id: 'grp', label: '参赛组别', required: true },
    { id: 'contact', label: '联系方式', required: false },
  ];

  it('parseCustomFields round-trips valid defs and rejects malformed ones', () => {
    expect(parseCustomFields(fields)).toEqual(fields);
    expect(parseCustomFields(null)).toEqual([]);
    expect(parseCustomFields(undefined)).toEqual([]);
    expect(parseCustomFields('x')).toBeNull();
    expect(parseCustomFields([{ id: 'bad id!', label: 'x', required: true }])).toBeNull();
    expect(parseCustomFields([{ id: 'a', label: '', required: true }])).toBeNull();
    expect(
      parseCustomFields([
        { id: 'a', label: 'x', required: true },
        { id: 'a', label: 'y', required: false },
      ]),
    ).toBeNull(); // duplicate ids
    expect(parseCustomFields(Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, label: 'x', required: false })))).toBeNull();
  });

  it('resolveCustomAnswers enforces required, drops unknown ids, trims and clamps', () => {
    expect(resolveCustomAnswers(fields, { grp: ' 摄影组 ', contact: '', evil: 'x' })).toEqual({
      grp: '摄影组',
    });
    expect(resolveCustomAnswers(fields, { contact: 'me@x' })).toBeNull(); // required grp missing
    expect(resolveCustomAnswers(fields, undefined)).toBeNull();
    expect(resolveCustomAnswers([], undefined)).toEqual({});
    const long = resolveCustomAnswers(fields, { grp: 'x'.repeat(500) });
    expect(long?.grp.length).toBe(200);
  });
});

describe('competitionRanks', () => {
  it('ties share a rank and the next rank skips (1,1,3)', () => {
    expect(competitionRanks([10, 10, 7, 7, 7, 1, 0])).toEqual([1, 1, 3, 3, 3, 6, 7]);
    expect(competitionRanks([])).toEqual([]);
    expect(competitionRanks([5])).toEqual([1]);
  });
});
