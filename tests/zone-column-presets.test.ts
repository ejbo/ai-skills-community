// 栏目预设 — the pure halves: hub facet ordering (orderColumnFacet), the seed
// list a new board gets (seedPresetColumns) and the per-board apply plan
// (planPresetsForZone). The DB code around them is thin by design.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

const { orderColumnFacet, seedPresetColumns } = await import('@/lib/zones/column-presets');
const { planPresetsForZone } = await import('@/lib/zones/column-presets-admin');
const { MAX_ZONE_COLUMNS } = await import('@/lib/zones/shared');

describe('orderColumnFacet', () => {
  it('lists presets first in preset order, even at zero posts', () => {
    const out = orderColumnFacet(
      [
        { name: '实验记录', postCount: 9 },
        { name: '技术报告', postCount: 1 },
      ],
      [{ name: '每周论文导读' }, { name: '技术报告' }],
    );
    expect(out.map((c) => c.name)).toEqual(['每周论文导读', '技术报告', '实验记录']);
    expect(out[0].postCount).toBe(0);
    expect(out[1].postCount).toBe(1);
  });

  it('keeps the live order for everything the presets do not name, and never drops a column', () => {
    const live = [
      { name: 'B', postCount: 5 },
      { name: 'A', postCount: 3 },
    ];
    expect(orderColumnFacet(live, []).map((c) => c.name)).toEqual(['B', 'A']);
  });

  it('ignores blank / duplicate preset names', () => {
    const out = orderColumnFacet([{ name: 'X', postCount: 1 }], [{ name: ' ' }, { name: 'X' }, { name: 'X' }]);
    expect(out.map((c) => c.name)).toEqual(['X']);
  });
});

describe('seedPresetColumns', () => {
  it('dedupes by columnDedupeKey, steps sortOrder by 10 and keeps preset order', () => {
    const out = seedPresetColumns([{ name: '技术 报告' }, { name: '技术报告' }, { name: 'Weekly Papers', description: '  每周  ' }]);
    expect(out.map((c) => c.name)).toEqual(['技术 报告', 'Weekly Papers']);
    expect(out.map((c) => c.sortOrder)).toEqual([10, 20]);
    expect(out[1].slug).toBe('weekly-papers');
    expect(out[1].description).toBe('每周');
  });

  it('gives a CJK-only name a stable generated slug and keeps slugs unique within the batch', () => {
    const a = seedPresetColumns([{ name: '论文' }]);
    const b = seedPresetColumns([{ name: '论文' }]);
    expect(a[0].slug).toBe(b[0].slug);
    expect(a[0].slug).toMatch(/^col-[0-9a-z]{6}$/);
    const two = seedPresetColumns([{ name: 'Lab Notes' }, { name: 'lab-notes!' }]);
    // 'lab-notes!' dedupes to a different key ("lab-notes!" vs "labnotes") but the SAME slug base.
    expect(two.map((c) => c.slug)).toEqual(['lab-notes', 'lab-notes-2']);
  });

  it('caps at MAX_ZONE_COLUMNS', () => {
    const many = Array.from({ length: MAX_ZONE_COLUMNS + 5 }, (_, i) => ({ name: `c${i}` }));
    expect(seedPresetColumns(many)).toHaveLength(MAX_ZONE_COLUMNS);
  });
});

describe('planPresetsForZone', () => {
  const presets = [{ name: '每周论文导读' }, { name: '技术报告' }, { name: '实验记录' }];

  it('adds only what the board is missing, continuing its official sort steps', () => {
    const plan = planPresetsForZone(
      [
        { name: '技术 报告', slug: 'reports', official: true, sortOrder: 30 },
        { name: '闲聊', slug: 'chat', official: false, sortOrder: 1000 },
      ],
      presets,
    );
    expect(plan).not.toBeNull();
    expect(plan!.map((c) => c.name)).toEqual(['每周论文导读', '实验记录']);
    expect(plan!.map((c) => c.sortOrder)).toEqual([40, 50]);
  });

  it('returns [] when nothing is missing and null when missing but full', () => {
    expect(planPresetsForZone(presets.map((p, i) => ({ name: p.name, slug: `s${i}`, official: true, sortOrder: i })), presets)).toEqual([]);
    const full = Array.from({ length: MAX_ZONE_COLUMNS }, (_, i) => ({ name: `own${i}`, slug: `own${i}`, official: false, sortOrder: 1000 }));
    expect(planPresetsForZone(full, presets)).toBeNull();
  });

  it('suffixes a slug the board already uses and fills only the room left', () => {
    const existing = Array.from({ length: MAX_ZONE_COLUMNS - 1 }, (_, i) => ({
      name: `own${i}`,
      slug: i === 0 ? 'weekly-papers' : `own${i}`,
      official: false,
      sortOrder: 1000,
    }));
    const plan = planPresetsForZone(existing, [{ name: 'Weekly Papers' }, { name: 'Second' }]);
    expect(plan).toHaveLength(1);
    expect(plan![0].slug).toBe('weekly-papers-2');
  });
});
