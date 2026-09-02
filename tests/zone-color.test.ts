// 技术专区 配色 — the contract app/zones/_components/zone-color.ts encodes.
//
// The two things worth pinning are the ones a refactor silently breaks:
// a hue must be STABLE for the same name (the rail dot, the filter chip and the
// chip on every post row are three separate call sites that must agree), and it
// must be keyed on the NAME, never the slug — a CJK 栏目 gets a hash slug that
// differs between the zone home and the cross-zone facet, which would paint one
// 栏目 two colours.

import { describe, expect, it } from 'vitest';
import { identityColor } from '@/components/Avatar';
import { columnDotCls, columnHue, columnPillCls, orgHue, zoneHue, zoneWash } from '@/app/zones/_components/zone-color';

describe('columnHue', () => {
  it('is stable for the same name', () => {
    expect(columnHue('每周论文导读')).toBe(columnHue('每周论文导读'));
    expect(columnHue('RAG')).toBe(columnHue('RAG'));
  });

  it('folds case and surrounding whitespace, the way the name is displayed', () => {
    expect(columnHue('  Weekly Reading ')).toBe(columnHue('weekly reading'));
  });

  it('feeds the chip and the dot from ONE entry, so rail and list agree', () => {
    const name = '每周论文导读';
    expect(columnDotCls(name)).toBe(columnHue(name).dot);
    expect(columnPillCls(name, true)).toContain(columnHue(name).chip);
    expect(columnPillCls(name, false)).toContain(columnHue(name).outline);
  });

  it('spreads a realistic set of 栏目 over more than one hue', () => {
    const names = ['每周论文导读', '技术评审', '实验记录', 'RAG', '端侧推理', '周报', '论文速递', '工具链'];
    const dots = new Set(names.map(columnDotCls));
    expect(dots.size).toBeGreaterThan(2);
  });

  it('marks a member-created 栏目 dashed and an official one filled', () => {
    expect(columnPillCls('x', false)).toContain('border-dashed');
    expect(columnPillCls('x', true)).not.toContain('border-dashed');
  });
});

describe('zoneHue / orgHue', () => {
  it('is the identity palette — the same function Avatar falls back to', () => {
    expect(zoneHue('端侧推理优化')).toBe(identityColor('端侧推理优化'));
    expect(orgHue('计算视觉研究所')).toBe(identityColor('计算视觉研究所'));
  });

  it('gives different 版块 different colours (that is the whole point of the wall)', () => {
    const hues = new Set(['端侧推理优化', '多模态感知', '5G 核心网智能化', '知识图谱'].map(zoneHue));
    expect(hues.size).toBeGreaterThan(1);
  });

  it('washes to the same hue at 8-bit alpha, never a gradient', () => {
    const wash = zoneWash('端侧推理优化');
    expect(wash).toBe(`${zoneHue('端侧推理优化')}1A`);
    expect(wash).toMatch(/^#[0-9A-Fa-f]{8}$/);
  });
});
