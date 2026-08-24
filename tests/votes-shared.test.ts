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

// ─── 批量投票 helpers ────────────────────────────────────────────────────────
import { planBallotChanges, stepDraftCount, MAX_BALLOT_CHANGES } from '@/lib/votes/shared';

describe('planBallotChanges', () => {
  const rules = { votesPerUser: 5, maxPerEntry: 2, allowRevoke: false };

  it('diffs desired counts against current ballots and drops no-op changes', () => {
    const current = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const res = planBallotChanges(rules, current, [
      { entryId: 'a', count: 1 }, // unchanged → dropped
      { entryId: 'c', count: 2 },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.steps).toEqual([{ entryId: 'c', from: 0, to: 2 }]);
    expect(res.plan.used).toBe(5);
  });

  it('counts the budget across ALL current ballots, including entries not mentioned', () => {
    const current = new Map([
      ['hidden-entry', 3], // voted on an entry the client no longer sees
      ['a', 1],
    ]);
    const res = planBallotChanges(rules, current, [{ entryId: 'b', count: 2 }]);
    expect(res).toEqual({ ok: false, error: 'budget_exhausted' });
  });

  it('rejects going above maxPerEntry', () => {
    const res = planBallotChanges(rules, new Map(), [{ entryId: 'a', count: 3 }]);
    expect(res).toEqual({ ok: false, error: 'entry_cap', entryId: 'a' });
  });

  it('rejects lowering a committed count unless allowRevoke', () => {
    const current = new Map([['a', 2]]);
    expect(planBallotChanges(rules, current, [{ entryId: 'a', count: 1 }])).toEqual({
      ok: false,
      error: 'revoke_forbidden',
      entryId: 'a',
    });
    const res = planBallotChanges({ ...rules, allowRevoke: true }, current, [{ entryId: 'a', count: 0 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.steps).toEqual([{ entryId: 'a', from: 2, to: 0 }]);
    expect(res.plan.used).toBe(0);
  });

  it('lets a revoke free budget for an add in the same submission', () => {
    const current = new Map([
      ['a', 2],
      ['b', 2],
      ['c', 1],
    ]); // used 5/5
    const res = planBallotChanges({ ...rules, allowRevoke: true }, current, [
      { entryId: 'a', count: 0 },
      { entryId: 'd', count: 2 },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.used).toBe(5);
    expect(res.plan.steps.map((s) => s.entryId)).toEqual(['a', 'd']);
  });

  it('rejects malformed input: negatives, non-integers, duplicate ids, oversized batches', () => {
    expect(planBallotChanges(rules, new Map(), [{ entryId: 'a', count: -1 }]).ok).toBe(false);
    expect(planBallotChanges(rules, new Map(), [{ entryId: 'a', count: 1.5 }]).ok).toBe(false);
    expect(
      planBallotChanges(rules, new Map(), [
        { entryId: 'a', count: 1 },
        { entryId: 'a', count: 2 },
      ]),
    ).toEqual({ ok: false, error: 'invalid_input', entryId: 'a' });
    const huge = Array.from({ length: MAX_BALLOT_CHANGES + 1 }, (_, i) => ({ entryId: `e${i}`, count: 1 }));
    expect(planBallotChanges(rules, new Map(), huge)).toEqual({ ok: false, error: 'invalid_input' });
  });

  it('is a no-op plan when nothing moves', () => {
    const res = planBallotChanges(rules, new Map([['a', 1]]), [{ entryId: 'a', count: 1 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.steps).toEqual([]);
    expect(res.plan.used).toBe(1);
  });
});

describe('stepDraftCount', () => {
  const rules = { votesPerUser: 3, maxPerEntry: 2, allowRevoke: false };

  it('adds while budget and cap allow', () => {
    expect(stepDraftCount(rules, 0, 0, 1, 3)).toEqual({ ok: true, next: 1 });
    expect(stepDraftCount(rules, 0, 1, 1, 2)).toEqual({ ok: true, next: 2 });
    expect(stepDraftCount(rules, 0, 2, 1, 1)).toEqual({ ok: false, error: 'entry_cap' });
    expect(stepDraftCount(rules, 0, 0, 1, 0)).toEqual({ ok: false, error: 'budget_exhausted' });
  });

  it('always lets an unsubmitted vote be taken back, even when 撤票 is off', () => {
    expect(stepDraftCount(rules, 0, 1, -1, 2)).toEqual({ ok: true, next: 0 });
    expect(stepDraftCount(rules, 1, 2, -1, 1)).toEqual({ ok: true, next: 1 });
  });

  it('refuses to go below the committed count without allowRevoke', () => {
    expect(stepDraftCount(rules, 1, 1, -1, 2)).toEqual({ ok: false, error: 'revoke_forbidden' });
    expect(stepDraftCount({ ...rules, allowRevoke: true }, 1, 1, -1, 2)).toEqual({ ok: true, next: 0 });
    expect(stepDraftCount(rules, 0, 0, -1, 3)).toEqual({ ok: false, error: 'nothing_to_remove' });
  });
});

// ─── 规则收紧后的方向性 + 草稿重校验 ─────────────────────────────────────────
import { reconcileDraft } from '@/lib/votes/shared';

describe('planBallotChanges: cap/budget gate increases only', () => {
  const rules = { votesPerUser: 5, maxPerEntry: 2, allowRevoke: true };

  it('lets a voter over a LOWERED votesPerUser make a pure 撤回', () => {
    const current = new Map([
      ['a', 5],
      ['b', 5],
    ]); // 10 used, cap now 5
    const res = planBallotChanges(rules, current, [{ entryId: 'a', count: 3 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.used).toBe(8);
  });

  it('still refuses to ADD while over budget', () => {
    const current = new Map([
      ['a', 5],
      ['b', 5],
    ]);
    expect(
      planBallotChanges(rules, current, [
        { entryId: 'a', count: 0 },
        { entryId: 'c', count: 1 },
      ]),
    ).toEqual({ ok: false, error: 'budget_exhausted' });
  });

  it('lets a partial 撤回 above a LOWERED maxPerEntry through, but not an add above it', () => {
    const current = new Map([['a', 5]]);
    expect(planBallotChanges(rules, current, [{ entryId: 'a', count: 4 }]).ok).toBe(true);
    expect(planBallotChanges(rules, current, [{ entryId: 'a', count: 6 }])).toEqual({
      ok: false,
      error: 'entry_cap',
      entryId: 'a',
    });
  });
});

describe('reconcileDraft', () => {
  const rules = { votesPerUser: 3, maxPerEntry: 2, allowRevoke: true };
  const committed = new Map([
    ['a', 1],
    ['b', 0],
    ['c', 0],
  ]);

  it('drops redundant / vanished overrides without calling it a trim', () => {
    const r = reconcileDraft(rules, true, 1, committed, { a: 1, zzz: 2, b: 1 });
    expect(r).toEqual({ next: { b: 1 }, trimmed: false, changed: true });
  });

  it('clears everything once voting is closed', () => {
    const r = reconcileDraft(rules, false, 1, committed, { b: 1 });
    expect(r.next).toEqual({});
    expect(r.changed).toBe(true);
  });

  it('clamps pending adds to maxPerEntry and sheds newest adds over budget', () => {
    // used 1 + b:2 + c:2 = 5 > 3 → shed from c first (newest), then b.
    const r = reconcileDraft(rules, true, 1, committed, { b: 3, c: 2 });
    expect(r.trimmed).toBe(true);
    expect(r.next).toEqual({ b: 2 });
  });

  it('never touches revokes, even when the committed total is over a lowered cap', () => {
    const over = new Map([
      ['a', 3],
      ['b', 3],
      ['c', 0],
    ]); // 6 committed, cap 3
    const r = reconcileDraft(rules, true, 6, over, { a: 1, c: 1 });
    // c:1 is an add while over budget → shed; a:1 (revoke) stays.
    expect(r.next).toEqual({ a: 1 });
    expect(r.trimmed).toBe(true);
  });

  it('reports no change for a clean draft', () => {
    expect(reconcileDraft(rules, true, 1, committed, { b: 1 })).toEqual({
      next: { b: 1 },
      trimmed: false,
      changed: false,
    });
  });
});
