import { describe, expect, it } from 'vitest';
import { parseSemver, compareSemver, formatSemver, bumpPatch } from '@/lib/version';

describe('parseSemver', () => {
  it('parses strict x.y.z', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver(' 0.0.1 ')).toEqual({ major: 0, minor: 0, patch: 1 });
  });
  it('rejects malformed / partial / pre-release', () => {
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('1.2.3-rc1')).toBeNull();
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('a.b.c')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('orders by major, then minor, then patch', () => {
    const a = parseSemver('1.2.0')!;
    expect(compareSemver(parseSemver('1.1.9')!, a)).toBe(-1);
    expect(compareSemver(parseSemver('1.2.0')!, a)).toBe(0);
    expect(compareSemver(parseSemver('1.2.1')!, a)).toBe(1);
    expect(compareSemver(parseSemver('2.0.0')!, a)).toBe(1);
    expect(compareSemver(parseSemver('0.9.9')!, a)).toBe(-1);
  });
});

describe('formatSemver / bumpPatch', () => {
  it('round-trips and bumps the patch', () => {
    const v = parseSemver('3.4.5')!;
    expect(formatSemver(v)).toBe('3.4.5');
    expect(bumpPatch(v)).toBe('3.4.6');
  });
});
