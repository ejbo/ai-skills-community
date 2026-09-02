// The people picker's matcher. The owner asked for it to be "smart": case
// blind, name-order blind, and 工号-by-digits. Each of those is a case here.
import { describe, expect, it } from 'vitest';
import { matchesAccount, matchesPerson, prefilterTerms, rankPeople, searchPeople, searchTokens } from '@/lib/user-search';

const wei = { userId: '1', handle: 'z84412632', displayName: 'Wang Wei', accountNumber: '84412632' };
const li = { userId: '2', handle: 'liming', displayName: '李明', accountNumber: 'z00412632', altName: 'Li Ming' };
const bob = { userId: '3', handle: 'bob', displayName: 'Bob Smith', accountNumber: null };

describe('searchTokens', () => {
  it('folds width and case and splits on whitespace', () => {
    expect(searchTokens('  Wang   WEI ')).toEqual(['wang', 'wei']);
    expect(searchTokens('ｚ８４４１２６３２')).toEqual(['z84412632']);
    expect(searchTokens('')).toEqual([]);
  });
});

describe('matchesAccount', () => {
  it('matches on the digit run, whatever the spelling', () => {
    for (const spelling of ['84412632', 'z84412632', 'ｚ８４４１２６３２', 'Z84412632']) {
      expect(matchesAccount(spelling, '84412632')).toBe(true);
    }
  });

  it('matches a prefix so typing narrows', () => {
    expect(matchesAccount('844', '84412632')).toBe(true);
    expect(matchesAccount('999', '84412632')).toBe(false);
  });

  it('keeps leading zeros significant', () => {
    expect(matchesAccount('00412632', '00412632')).toBe(true);
    expect(matchesAccount('412632', '00412632')).toBe(false);
  });

  it('never matches on a token with no digits', () => {
    // Otherwise every word would match every letter-prefixed account.
    expect(matchesAccount('wang', '84412632')).toBe(false);
    expect(matchesAccount('z', 'z84412632')).toBe(false);
  });
});

describe('matchesPerson', () => {
  it('is case-insensitive', () => {
    expect(matchesPerson(searchTokens('WANG'), wei)).toBe(true);
  });

  it('ignores the order of first and last name', () => {
    expect(matchesPerson(searchTokens('wang wei'), wei)).toBe(true);
    expect(matchesPerson(searchTokens('wei wang'), wei)).toBe(true);
  });

  it('requires EVERY token to match something', () => {
    expect(matchesPerson(searchTokens('wang smith'), wei)).toBe(false);
  });

  it('matches the CJK display name and the latin alt name', () => {
    expect(matchesPerson(searchTokens('李明'), li)).toBe(true);
    expect(matchesPerson(searchTokens('li ming'), li)).toBe(true);
  });

  it('matches by 工号 and mixes with a name token', () => {
    expect(matchesPerson(searchTokens('84412632'), wei)).toBe(true);
    expect(matchesPerson(searchTokens('wang 844'), wei)).toBe(true);
  });

  it('never matches on an empty query', () => {
    expect(matchesPerson([], wei)).toBe(false);
  });
});

describe('rankPeople / searchPeople', () => {
  it('puts an exact 工号 hit first', () => {
    const out = rankPeople(searchTokens('84412632'), [bob, li, wei]);
    expect(out[0]).toBe(wei);
  });

  it('prefers a name that starts with the query', () => {
    const bobby = { userId: '4', handle: 'bobby', displayName: 'Bobby Zhang', accountNumber: null };
    const other = { userId: '5', handle: 'x', displayName: 'Jim Bob', accountNumber: null };
    expect(rankPeople(searchTokens('bob'), [other, bobby])[0]).toBe(bobby);
  });

  it('filters and caps in one call', () => {
    expect(searchPeople('wang', [wei, li, bob])).toEqual([wei]);
    expect(searchPeople('', [wei, li, bob])).toEqual([]);
    expect(searchPeople('a', [wei, li, bob], 1)).toHaveLength(1);
  });
});

describe('prefilterTerms', () => {
  it('is a bounded set of tokens for the SQL side', () => {
    expect(prefilterTerms('a b c d e')).toEqual(['a', 'b', 'c']);
    expect(prefilterTerms('  ')).toEqual([]);
  });
});
