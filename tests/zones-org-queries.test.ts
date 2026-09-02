// 组织架构 (研究所 → 实验室) as DATA — the pure halves of lib/zones/queries.ts
// (`buildZoneOrgTree` behind zoneOrgTree, `buildZoneOrgOptions` behind zoneFacets).
//
// The vocabulary is the trap this suite guards: a 研究所 is the TOP level and is
// COMPOSED OF 实验室, but the columns are named the other way round
// (`Zone.lab` = 研究所, `Zone.department` = 实验室 — see lib/org.ts). Expectations
// are derived from the live config rather than hardcoded, so renaming a 研究所
// in lib/org.ts does not fail the suite — only breaking a RULE does.
import { describe, expect, it, vi } from 'vitest';
import { INSTITUTES, instituteNames, labsOf } from '@/lib/org';

// queries.ts is a server module; only its pure exports are under test here.
vi.mock('@/lib/db', () => ({ prisma: {} }));

const { buildZoneOrgTree, buildZoneOrgOptions } = await import('@/lib/zones/queries');

const CONFIGURED = instituteNames();
const [FIRST, SECOND] = CONFIGURED;
/** A configured 研究所 that has 实验室 configured under it. */
const WITH_LABS = INSTITUTES.find((i) => i.labs.length > 0)!;

describe('buildZoneOrgTree', () => {
  it('shows every configured 研究所 in config order, even at zero 版块', () => {
    const tree = buildZoneOrgTree([]);
    expect(tree.map((n) => n.lab)).toEqual(CONFIGURED);
    expect(tree.every((n) => n.zoneCount === 0)).toBe(true);
  });

  it('lists a configured 研究所 with its configured 实验室 before it has any 版块', () => {
    const node = buildZoneOrgTree([]).find((n) => n.lab === WITH_LABS.name)!;
    expect(node.departments.map((d) => d.department)).toEqual(WITH_LABS.labs);
    expect(node.departments.every((d) => d.zoneCount === 0)).toBe(true);
  });

  it('keeps configured order regardless of 版块 count', () => {
    const tree = buildZoneOrgTree([{ lab: SECOND, department: '', count: 99 }]);
    expect(tree.map((n) => n.lab).slice(0, CONFIGURED.length)).toEqual(CONFIGURED);
    expect(tree.find((n) => n.lab === SECOND)!.zoneCount).toBe(99);
    expect(tree.find((n) => n.lab === FIRST)!.zoneCount).toBe(0);
  });

  it('appends unconfigured 研究所 after the configured ones, busiest first', () => {
    const tree = buildZoneOrgTree([
      { lab: '未登记研究所 A', department: '', count: 1 },
      { lab: '未登记研究所 B', department: '', count: 5 },
      { lab: FIRST, department: '', count: 1 },
    ]);
    expect(tree.map((n) => n.lab)).toEqual([...CONFIGURED, '未登记研究所 B', '未登记研究所 A']);
  });

  it('counts a 研究所 as the sum of its rows and each 实验室 separately', () => {
    const [labA, labB] = WITH_LABS.labs;
    const tree = buildZoneOrgTree([
      { lab: WITH_LABS.name, department: labA, count: 2 },
      { lab: WITH_LABS.name, department: labB ?? '其他实验室', count: 3 },
      { lab: WITH_LABS.name, department: '', count: 1 }, // 版块 with no 实验室
    ]);
    const node = tree.find((n) => n.lab === WITH_LABS.name)!;
    expect(node.zoneCount).toBe(6);
    expect(node.departments.find((d) => d.department === labA)!.zoneCount).toBe(2);
    // A row naming no 实验室 still counts for the 研究所, but is no lab of its own.
    expect(node.departments.some((d) => d.department === '')).toBe(false);
  });

  it('merges a live 实验室 nobody configured in after the configured ones (never drops it)', () => {
    const tree = buildZoneOrgTree([{ lab: WITH_LABS.name, department: '影子实验室', count: 4 }]);
    const node = tree.find((n) => n.lab === WITH_LABS.name)!;
    expect(node.departments.map((d) => d.department)).toEqual([...WITH_LABS.labs, '影子实验室']);
    expect(node.departments.at(-1)!.zoneCount).toBe(4);
  });

  it('drops rows with no 研究所 — they belong to no branch', () => {
    const tree = buildZoneOrgTree([{ lab: '  ', department: '孤儿实验室', count: 3 }]);
    expect(tree.map((n) => n.lab)).toEqual(CONFIGURED);
    expect(tree.some((n) => n.departments.some((d) => d.department === '孤儿实验室'))).toBe(false);
  });
});

describe('buildZoneOrgOptions', () => {
  it('offers every configured 研究所 first, then whatever live rows carry', () => {
    const o = buildZoneOrgOptions([{ lab: '未登记研究所', department: '某实验室' }], [], []);
    expect(o.institutes).toEqual([...CONFIGURED, '未登记研究所']);
    expect(o.labsByInstitute['未登记研究所']).toEqual(['某实验室']);
  });

  it('scopes 实验室 to their own 研究所', () => {
    const o = buildZoneOrgOptions([{ lab: FIRST, department: '借来的实验室' }], [], []);
    expect(o.labsByInstitute[FIRST]).toEqual([...labsOf(FIRST), '借来的实验室']);
    expect(o.labsByInstitute[SECOND]).toEqual(labsOf(SECOND));
    expect(o.labsByInstitute[SECOND]).not.toContain('借来的实验室');
  });

  it('widens both levels with the employee roster (its `lab` column is the 研究所 too)', () => {
    const o = buildZoneOrgOptions([], ['花名册研究所'], ['花名册实验室']);
    expect(o.institutes).toContain('花名册研究所');
    // A roster 实验室 has no institute to sit under, so it is a free-text
    // suggestion only — never silently filed under someone's 研究所.
    expect(o.labs).toContain('花名册实验室');
    for (const inst of CONFIGURED) expect(o.labsByInstitute[inst]).not.toContain('花名册实验室');
  });

  it('dedupes and trims, and every institute has a (possibly empty) lab list', () => {
    const o = buildZoneOrgOptions(
      [
        { lab: ` ${FIRST} `, department: ' 重复实验室 ' },
        { lab: FIRST, department: '重复实验室' },
        { lab: '', department: '' },
      ],
      [FIRST],
      [],
    );
    expect(o.institutes.filter((v) => v === FIRST)).toHaveLength(1);
    expect(o.labsByInstitute[FIRST].filter((v) => v === '重复实验室')).toHaveLength(1);
    for (const inst of o.institutes) expect(Array.isArray(o.labsByInstitute[inst])).toBe(true);
  });
});
