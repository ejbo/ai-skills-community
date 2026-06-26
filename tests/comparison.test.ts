import { describe, expect, it } from 'vitest';
import {
  buildComparisonSystemPrompt,
  comparisonPutSchema,
  parseComparisonExample,
  COMPARISON_SECTIONS,
  type ComparisonExample,
} from '@/lib/comparison';

const example: ComparisonExample = {
  taskPrompt: '帮我做一页 MoE 架构汇报',
  withOutput: '【配色+版式成品页】',
  withoutOutput: '【纯文字大纲】',
};

describe('buildComparisonSystemPrompt', () => {
  const prompt = buildComparisonSystemPrompt('=== SKILL CONTEXT ===', example);

  it('embeds the skill context', () => {
    expect(prompt).toContain('=== SKILL CONTEXT ===');
  });

  it('embeds the task prompt and both real runs labeled with/without', () => {
    expect(prompt).toContain('帮我做一页 MoE 架构汇报');
    expect(prompt).toContain('【配色+版式成品页】');
    expect(prompt).toContain('【纯文字大纲】');
  });

  it('asks for every structured section', () => {
    for (const section of COMPARISON_SECTIONS) {
      expect(prompt).toContain(section);
    }
  });

  it('tells the model to analyze, not just restate, the two outputs', () => {
    // The whole point: a raw diff is often subtle, so the model must explain the value.
    expect(prompt).toMatch(/分析|价值|差别|差异/);
  });
});

describe('buildComparisonSystemPrompt without a baseline (实测 optional)', () => {
  const prompt = buildComparisonSystemPrompt('=== SKILL CONTEXT ===', null);

  it('still embeds the skill context', () => {
    expect(prompt).toContain('=== SKILL CONTEXT ===');
  });

  it('still asks for every structured section', () => {
    for (const section of COMPARISON_SECTIONS) {
      expect(prompt).toContain(section);
    }
  });

  it('does not fabricate a "real runs" block when there is no example', () => {
    expect(prompt).not.toContain('真实运行');
    expect(prompt).not.toContain('baseline');
  });

  it('still steers toward value/difference analysis', () => {
    expect(prompt).toMatch(/价值|差别|差异/);
  });
});

describe('comparisonPutSchema', () => {
  // Regression: publishing before any baseline/generation sends model: null (and
  // possibly null bodyMd/guidancePrompt). `.optional()` alone rejected null and
  // 400-ed every such publish.
  it('accepts null for the nullable columns (publish before a model is captured)', () => {
    const r = comparisonPutSchema.safeParse({
      bodyMd: '# 对比',
      example: null,
      guidancePrompt: null,
      model: null,
      status: 'published',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a fully omitted optional set with just a status', () => {
    expect(comparisonPutSchema.safeParse({ status: 'draft' }).success).toBe(true);
  });

  it('accepts a well-formed example', () => {
    const r = comparisonPutSchema.safeParse({ bodyMd: 'x', example, model: 'glm', status: 'published' });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(comparisonPutSchema.safeParse({ status: 'live' }).success).toBe(false);
  });

  it('rejects a malformed example (empty taskPrompt)', () => {
    const r = comparisonPutSchema.safeParse({
      example: { taskPrompt: '', withOutput: 'a', withoutOutput: 'b' },
      status: 'draft',
    });
    expect(r.success).toBe(false);
  });
});

describe('parseComparisonExample', () => {
  it('accepts a well-formed example', () => {
    expect(parseComparisonExample(example)).toEqual(example);
  });

  it('returns null for malformed input', () => {
    expect(parseComparisonExample(null)).toBeNull();
    expect(parseComparisonExample({ taskPrompt: 'x' })).toBeNull();
    expect(parseComparisonExample({ taskPrompt: 1, withOutput: 'a', withoutOutput: 'b' })).toBeNull();
  });
});
