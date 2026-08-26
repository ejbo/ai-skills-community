import { describe, expect, it } from 'vitest';
import { clamp, digitPlaces, isWhitespaceToken, rollingDigitOffset, splitTextTokens } from '@/lib/motion';

describe('clamp', () => {
  it('bounds symmetrically', () => {
    expect(clamp(10, 6)).toBe(6);
    expect(clamp(-10, 6)).toBe(-6);
    expect(clamp(3, 6)).toBe(3);
    expect(clamp(3, -6)).toBe(3);
  });
});

describe('splitTextTokens', () => {
  it('keeps whitespace runs as tokens in words mode', () => {
    expect(splitTextTokens('Tech  Zones', 'words')).toEqual(['Tech', '  ', 'Zones']);
    expect(isWhitespaceToken('  ')).toBe(true);
    expect(isWhitespaceToken('a')).toBe(false);
  });
  it('splits CJK runs per character in words mode', () => {
    expect(splitTextTokens('技术专区', 'words')).toEqual(['技', '术', '专', '区']);
    expect(splitTextTokens('AI 模型 lab', 'words')).toEqual(['AI', ' ', '模', '型', ' ', 'lab']);
    expect(splitTextTokens('AI模型', 'words')).toEqual(['AI', '模', '型']);
  });
  it('splits by code point in chars mode', () => {
    expect(splitTextTokens('a b', 'chars')).toEqual(['a', ' ', 'b']);
    expect(splitTextTokens('😀x', 'chars')).toEqual(['😀', 'x']);
  });
  it('handles empty text', () => {
    expect(splitTextTokens('', 'words')).toEqual([]);
    expect(splitTextTokens('', 'chars')).toEqual([]);
  });
});

describe('digitPlaces', () => {
  it('lists place values most significant first', () => {
    expect(digitPlaces(0)).toEqual([1]);
    expect(digitPlaces(7)).toEqual([1]);
    expect(digitPlaces(42)).toEqual([10, 1]);
    expect(digitPlaces(1234)).toEqual([1000, 100, 10, 1]);
  });
  it('ignores sign and fractions, tolerates non-finite input', () => {
    expect(digitPlaces(-56.9)).toEqual([10, 1]);
    expect(digitPlaces(Number.NaN)).toEqual([1]);
    expect(digitPlaces(Number.POSITIVE_INFINITY)).toEqual([1]);
  });
});

describe('rollingDigitOffset', () => {
  it('puts the current digit in the visible slot and neighbours around it', () => {
    expect(rollingDigitOffset(3, 3)).toBe(0);
    expect(rollingDigitOffset(3, 4)).toBe(1);
    expect(rollingDigitOffset(3, 2)).toBe(-1);
    expect(rollingDigitOffset(13, 3)).toBe(0);
  });
  it('rolls upward as the value increases', () => {
    expect(rollingDigitOffset(3.5, 3)).toBeCloseTo(-0.5);
    expect(rollingDigitOffset(3.5, 4)).toBeCloseTo(0.5);
  });
  it('wraps 9 → 0 the short way', () => {
    expect(rollingDigitOffset(9.5, 0)).toBeCloseTo(0.5);
    expect(rollingDigitOffset(9.5, 9)).toBeCloseTo(-0.5);
    expect(rollingDigitOffset(19, 9)).toBe(0);
    expect(rollingDigitOffset(20, 0)).toBe(0);
  });
  it('never returns an offset beyond ±5', () => {
    for (let v = 0; v <= 30; v += 0.25) {
      for (let d = 0; d < 10; d += 1) {
        const o = rollingDigitOffset(v, d);
        expect(o).toBeGreaterThanOrEqual(-5);
        expect(o).toBeLessThanOrEqual(5);
      }
    }
  });
});
