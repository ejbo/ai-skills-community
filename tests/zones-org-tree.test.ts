import { describe, expect, it, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INSTITUTES, instituteNames, labsOf } from '@/lib/org';
import type { OrgLabNode } from '@/lib/zones/shared';

// 研究所 → 实验室, as NAVIGATION and as DISPLAY.
//
// The owner's model: a 研究所 is the TOP category and is COMPOSED OF 实验室; the
// navbar shows 研究所. The columns behind it read backwards and are deliberately
// NOT renamed — `Zone.lab` holds the 研究所 and `Zone.department` the 实验室 —
// so every guarantee below is about the two things that CAN drift: whether the
// tree the UI renders still contains everything the org config declares AND
// everything the live rows carry, and whether the labels say 实验室.

// lib/zones/labs.ts imports Prisma for the live counts; `withConfiguredInstitutes`
// is pure, so stub the db rather than skip it.
vi.mock('@/lib/db', () => ({ prisma: {} }));

let withConfiguredInstitutes: (tree: readonly OrgLabNode[]) => OrgLabNode[];
beforeAll(async () => {
  ({ withConfiguredInstitutes } = await import('@/lib/zones/labs'));
});

const node = (lab: string, zoneCount: number, departments: [string, number][] = []): OrgLabNode => ({
  lab,
  zoneCount,
  departments: departments.map(([department, n]) => ({ department, zoneCount: n })),
});

describe('withConfiguredInstitutes — the rail shows the whole org chart', () => {
  it('lists every configured 研究所 even when nothing is filed under it', () => {
    const out = withConfiguredInstitutes([]);
    expect(out.map((n) => n.lab)).toEqual(instituteNames());
    for (const n of out) expect(n.zoneCount).toBe(0);
  });

  it('keeps configured order, so the rail matches the navbar grid', () => {
    // A busy institute must NOT jump the queue: the config decides the running
    // order (both surfaces read the same list) and counts only break ties among
    // institutes the config does not name.
    const busy = INSTITUTES[3].name;
    const out = withConfiguredInstitutes([node(busy, 99)]);
    expect(out.map((n) => n.lab)).toEqual(instituteNames());
  });

  it('an empty 研究所 is visibly EMPTY, not silently absent', () => {
    const out = withConfiguredInstitutes([node(INSTITUTES[0].name, 2, [[INSTITUTES[0].labs[0], 2]])]);
    const placeholder = out.find((n) => n.lab === INSTITUTES[3].name);
    expect(placeholder, 'a placeholder 研究所 must still be in the tree').toBeDefined();
    expect(placeholder!.zoneCount).toBe(0);
  });

  it('folds in the configured 实验室 a 研究所 has no 版块 in yet', () => {
    const inst = INSTITUTES[0];
    const [first, second] = inst.labs;
    const out = withConfiguredInstitutes([node(inst.name, 3, [[first, 3]])]);
    const hit = out.find((n) => n.lab === inst.name)!;
    // The one with content leads; the empty configured one follows at zero.
    expect(hit.departments.map((d) => d.department)).toEqual([first, second]);
    expect(hit.departments.map((d) => d.zoneCount)).toEqual([3, 0]);
  });

  it('is TOLERANT: an unconfigured 研究所 / 实验室 keeps working', () => {
    // Nothing here is a whitelist — a 版块 filed under a name the config does
    // not know must never disappear from the filters, it just sorts last.
    const out = withConfiguredInstitutes([node('某个未登记的研究所', 4, [['未登记实验室', 4]])]);
    const extra = out.find((n) => n.lab === '某个未登记的研究所');
    expect(extra, 'an unconfigured institute must survive').toBeDefined();
    expect(extra!.zoneCount).toBe(4);
    expect(extra!.departments).toEqual([{ department: '未登记实验室', zoneCount: 4 }]);
    // …and after every configured one.
    expect(out.indexOf(extra!)).toBe(out.length - 1);
  });

  it('keeps a live 实验室 the config does not list, but AFTER the configured ones', () => {
    // The org chart is the structure; the rows only fill it in. So a 实验室
    // that exists in the data but not in lib/org.ts is never dropped and never
    // jumps the queue — it lands after every configured one. (Same rule the DB
    // tree uses, because both go through this one function.)
    const inst = INSTITUTES[0];
    const out = withConfiguredInstitutes([node(inst.name, 1, [['临时项目组', 1]])]);
    const hit = out.find((n) => n.lab === inst.name)!;
    expect(hit.departments.map((d) => d.department)).toEqual([...inst.labs, '临时项目组']);
  });

  it('is idempotent — safe to apply to an already-merged tree', () => {
    // The hub applies it to BOTH rails, and the feed's tree may already have
    // been merged upstream by zoneOrgTree. Applying twice must not duplicate.
    const once = withConfiguredInstitutes([node(INSTITUTES[1].name, 1, [[INSTITUTES[1].labs[0], 1]])]);
    expect(withConfiguredInstitutes(once)).toEqual(once);
  });

  it('never invents a 实验室 for a 研究所 that has none configured', () => {
    const out = withConfiguredInstitutes([]);
    for (const n of out) expect(n.departments.map((d) => d.department)).toEqual(labsOf(n.lab));
  });
});

// ── The vocabulary the user actually reads ──────────────────────────────────

const LOCALES = ['zh-CN', 'en', 'fr'] as const;
const cat = (l: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '..', 'messages', `${l}.json`), 'utf8')) as {
    zones: Record<string, string>;
    nav: Record<string, string>;
  };

describe('the second level is called 实验室 / Lab / Laboratoire, never 部门', () => {
  const cats = Object.fromEntries(LOCALES.map((l) => [l, cat(l)])) as Record<string, ReturnType<typeof cat>>;

  it('has every org key in all three locales', () => {
    const zoneKeys = [
      'hub_filter_org',
      'hub_chip_institute',
      'hub_chip_laboratory',
      'hub_org_expand',
      'hub_org_no_zones',
      'hub_org_no_match',
      'hub_org_search_placeholder',
      'hub_institute_empty_title',
      'hub_institute_empty_desc',
      'hub_institute_labs',
      'hub_institute_labs_empty',
      'home_org_institute',
      'home_org_laboratory',
    ];
    for (const locale of LOCALES) {
      for (const k of zoneKeys) expect(typeof cats[locale].zones[k], `${locale} zones.${k}`).toBe('string');
      for (const k of ['mega_labs', 'mega_lab_labs', 'mega_lab_labs_empty', 'mega_lab_zones'])
        expect(typeof cats[locale].nav[k], `${locale} nav.${k}`).toBe('string');
    }
  });

  it('names the two levels the way the owner does', () => {
    expect(cats['zh-CN'].zones.hub_filter_org).toBe('研究所 · 实验室');
    expect(cats['zh-CN'].zones.home_org_institute).toBe('研究所');
    expect(cats['zh-CN'].zones.home_org_laboratory).toBe('实验室');
    expect(cats.en.zones.home_org_institute).toBe('Institute');
    expect(cats.en.zones.home_org_laboratory).toBe('Lab');
    expect(cats.fr.zones.home_org_institute).toBe('Institut');
    expect(cats.fr.zones.home_org_laboratory).toBe('Laboratoire');
  });

  it('has no 部门 / Department left in the hub org labels', () => {
    // 部门 was the OLD name for the second level and is what the owner
    // corrected. The `?department=` PARAM keeps the historical spelling on
    // purpose — this is only about what a reader sees.
    const shown = (c: ReturnType<typeof cat>) =>
      Object.entries(c.zones)
        .filter(([k]) => k.startsWith('hub_') || k.startsWith('home_org_'))
        .map(([, v]) => v)
        .join('\n');
    expect(shown(cats['zh-CN'])).not.toContain('部门');
    expect(shown(cats.en).toLowerCase()).not.toContain('department');
    expect(shown(cats.fr).toLowerCase()).not.toContain('département');
  });

  it('the empty-institute state names the 研究所 and lists its 实验室', () => {
    for (const locale of LOCALES) {
      expect(cats[locale].zones.hub_institute_empty_title).toContain('{name}');
      expect(cats[locale].zones.hub_institute_labs).toContain('{labs}');
    }
  });
});
