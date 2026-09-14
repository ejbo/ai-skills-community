// 组织架构目录 — the pure planners behind the admin writes. Renames must reach
// the 版块 rows (the name IS the join key), lab renames must stay inside their
// own 研究所, and reordering must never lose an id.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

const { planInstituteRename, planLabRename, planReorder, cleanImageUrl, cleanOrgName } = await import('@/lib/zones/org-admin');
const { ZoneError } = await import('@/lib/zones/errors');

describe('planInstituteRename', () => {
  it('rewrites Zone.lab from the old name to the new one', () => {
    expect(planInstituteRename('温哥华研究所', ' 温哥华 研究所 ')).toEqual({
      changed: true,
      where: { lab: '温哥华研究所' },
      data: { lab: '温哥华 研究所' },
    });
  });

  it('is a no-op when only whitespace differs', () => {
    expect(planInstituteRename('温哥华研究所', '  温哥华研究所  ').changed).toBe(false);
  });

  it('refuses an empty new name', () => {
    expect(() => planInstituteRename('x', '   ')).toThrow(ZoneError);
  });
});

describe('planLabRename', () => {
  it('scopes the rewrite to rows under the same 研究所', () => {
    expect(planLabRename('温哥华研究所', 'Graphics Lab', 'Graphics Technology Laboratory')).toEqual({
      changed: true,
      where: { lab: '温哥华研究所', department: 'Graphics Lab' },
      data: { department: 'Graphics Technology Laboratory' },
    });
  });

  it('no-op on an unchanged name', () => {
    expect(planLabRename('a', 'b', 'b').changed).toBe(false);
  });
});

describe('planReorder', () => {
  it('assigns 10, 20, … in the requested order and appends ids the request forgot', () => {
    expect(planReorder(['c', 'a'], ['a', 'b', 'c'])).toEqual([
      { id: 'c', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
    ]);
  });

  it('ignores unknown and duplicate ids', () => {
    expect(planReorder(['zzz', 'a', 'a'], ['a', 'b'])).toEqual([
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 20 },
    ]);
  });
});

describe('cleaners', () => {
  it('normalises whitespace and caps the name at the Zone column width', () => {
    expect(cleanOrgName('  a   b  ')).toBe('a b');
    expect(cleanOrgName('x'.repeat(100))).toHaveLength(64);
    expect(cleanOrgName(42)).toBe('');
  });

  it('accepts root-relative and http(s) image urls only', () => {
    expect(cleanImageUrl('/labs/vancouver.jpg')).toBe('/labs/vancouver.jpg');
    expect(cleanImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(cleanImageUrl('//evil.example/a.png')).toBeNull();
    expect(cleanImageUrl('javascript:alert(1)')).toBeNull();
    expect(cleanImageUrl('')).toBeNull();
  });
});
