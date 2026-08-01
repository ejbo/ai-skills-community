import { describe, expect, it } from 'vitest';
import {
  assistInputSchema,
  buildAssistContext,
  buildPackAssistContext,
  buildAssistPrompt,
  extractJsonObject,
  parseAssistResult,
  isAssistAction,
} from '@/lib/skill-assist';

describe('isAssistAction', () => {
  it('accepts known actions and rejects others', () => {
    expect(isAssistAction('autofill')).toBe(true);
    expect(isAssistAction('tokens')).toBe(true);
    expect(isAssistAction('delete')).toBe(false);
    expect(isAssistAction(42)).toBe(false);
  });
});

describe('extractJsonObject', () => {
  it('extracts a bare object', () => {
    expect(extractJsonObject('{"name":"x"}')).toEqual({ name: 'x' });
  });
  it('strips ```json fences and surrounding prose', () => {
    const text = 'Sure!\n```json\n{"summary": "做 PDF"}\n```\nhope that helps';
    expect(extractJsonObject(text)).toEqual({ summary: '做 PDF' });
  });
  it('handles braces inside strings', () => {
    expect(extractJsonObject('{"a":"to {b} or not"}')).toEqual({ a: 'to {b} or not' });
  });
  it('strips a reasoning <think> block (local GLM/DeepSeek) before the JSON', () => {
    // The think block contains a brace that would otherwise derail extraction.
    const text = '<think>maybe {name} should be short…</think>\n{"name":"PDF Signer"}';
    expect(extractJsonObject(text)).toEqual({ name: 'PDF Signer' });
  });
  it('returns null when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });

  // ── reasoning models cut off by max_tokens (the 知识库 indexing failure) ──
  it('returns null when <think> was never closed', () => {
    // Budget exhausted inside the reasoning: the answer never arrived, and the
    // brace the model quoted while thinking is NOT it.
    const text = '<think>好的，我需要输出 {"summary":"…","keywords":[…]} 这样的对象。先读正文：这一章讲';
    expect(extractJsonObject(text)).toBeNull();
  });
  it('prefers the answer after the LAST </think>, not a brace inside the thinking', () => {
    const text =
      '<think>格式应该是 {"summary":"x","keywords":["a"]}，我先想想…</think>\n' +
      '{"summary":"真正的概要","keywords":["检索"]}';
    expect(extractJsonObject(text)).toEqual({ summary: '真正的概要', keywords: ['检索'] });
  });
  it('skips a non-JSON brace in prose and finds the real object', () => {
    const text = '按照 {格式} 输出如下：\n{"summary":"内容"}';
    expect(extractJsonObject(text)).toEqual({ summary: '内容' });
  });
  it('repairs an object truncated inside an array', () => {
    expect(extractJsonObject('{"summary":"做 PDF 签名","keywords":["pdf","签名"')).toEqual({
      summary: '做 PDF 签名',
      keywords: ['pdf', '签名'],
    });
  });
  it('repairs an object truncated inside a string', () => {
    expect(extractJsonObject('{"summary":"这一章讲的是检索')).toEqual({
      summary: '这一章讲的是检索',
    });
  });
  it('drops a dangling key with no value when repairing', () => {
    expect(extractJsonObject('{"summary":"完整的概要","keywords":')).toEqual({
      summary: '完整的概要',
    });
  });
  it('still returns null when the truncation leaves nothing valid', () => {
    expect(extractJsonObject('{"summ')).toBeNull();
  });
  it('strips a fence with a non-json language tag', () => {
    expect(extractJsonObject('```JSON5\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  // ── regressions found by the reasoning-model audit ──
  it('returns null when an unterminated <thinking> alias holds only the schema', () => {
    // /<think\b/ does not match <thinking> (both sides are word chars), so the
    // reasoning's own example object used to be returned as the answer.
    expect(extractJsonObject('<thinking>需要输出 {"summary":"…"} 先读正文')).toBeNull();
  });
  it('returns null for an unterminated <think> carrying attributes', () => {
    expect(extractJsonObject('<think id="1">格式是 {"name":"x"} 先想想')).toBeNull();
  });
  it('finds the answer when only the CLOSING tag is emitted (GLM prefills the opener)', () => {
    expect(extractJsonObject('先分析 {"a":1} 然后</think>\n{"name":"x"}')).toEqual({ name: 'x' });
  });
  it('prefers the real answer over a schema echo that precedes it', () => {
    expect(extractJsonObject('例如 {"name": "..."} — 我的答案:\n{"name":"PDF Signer"}')).toEqual({
      name: 'PDF Signer',
    });
  });
  it('prefers the real answer over a {} mentioned in prose', () => {
    expect(extractJsonObject('这是你要的 JSON（注意 {} 结构）:\n{"name":"x"}')).toEqual({ name: 'x' });
  });
  it('preserves ``` fences inside a descriptionMd string value', () => {
    // The old blanket fence strip silently destroyed generated code blocks and
    // persisted the damage as the skill's public Overview.
    expect(extractJsonObject('{"descriptionMd":"run:\\n```bash\\nls\\n```\\ndone"}')).toEqual({
      descriptionMd: 'run:\n```bash\nls\n```\ndone',
    });
  });
  it('tolerates a trailing comma', () => {
    expect(extractJsonObject('{"tags":["a","b",],}')).toEqual({ tags: ['a', 'b'] });
  });
  it('escapes a raw newline inside a string value', () => {
    expect(extractJsonObject('{"summary":"line1\nline2"}')).toEqual({ summary: 'line1\nline2' });
  });
  it('promotes smart quotes only when there is no ASCII quote', () => {
    expect(extractJsonObject('{“name”:“x”}')).toEqual({ name: 'x' });
    expect(extractJsonObject('{"summary":"他说“你好”"}')).toEqual({ summary: '他说“你好”' });
  });
  it('takes the final harmony channel, not the analysis channel', () => {
    const t =
      '<|channel|>analysis<|message|>they want {"summary":"..."}<|end|>' +
      '<|channel|>final<|message|>{"summary":"真答案"}';
    expect(extractJsonObject(t)).toEqual({ summary: '真答案' });
  });
  it('stays fast with many decoy braces (prefilter guard)', () => {
    const t = 'lorem {ipsum} '.repeat(20000) + '{"name":"x"}';
    expect(extractJsonObject(t)).toEqual({ name: 'x' });
  });
});

describe('buildAssistContext', () => {
  it('respects a per-action budget and appends a truncation note with the full size', () => {
    const ctx = buildAssistContext(
      { skillMd: 'x'.repeat(50_000), readme: 'r'.repeat(10_000) },
      8 * 1024,
    );
    expect(ctx.length).toBeLessThan(9 * 1024);
    expect(ctx).toContain('已截断');
    expect(ctx).toContain('60000'); // 50k SKILL.md + 10k README
  });

  it('adds no truncation note when everything fits', () => {
    const ctx = buildAssistContext({ skillMd: 'short body' });
    expect(ctx).not.toContain('已截断');
  });

  it('includes SKILL.md, README and extra files but skips skill/readme dupes', () => {
    const ctx = buildAssistContext({
      skillMd: 'BODY',
      readme: 'READ',
      files: [
        { path: 'scripts/x.py', content: 'CODE' },
        { path: 'SKILL.md', content: 'DUPE' },
        { path: 'README.md', content: 'DUPE2' },
      ],
    });
    expect(ctx).toContain('# SKILL.md\nBODY');
    expect(ctx).toContain('# README\nREAD');
    expect(ctx).toContain('# FILE: scripts/x.py\nCODE');
    expect(ctx).not.toContain('DUPE');
  });
});

describe('parseAssistResult', () => {
  it('autofill maps every present field and normalizes tags', () => {
    const text = '{"name":"PDF 签署","summary":"签 PDF","descriptionMd":"## 介绍","tags":["#PDF","Forms"],"triggers":["签 pdf"]}';
    const r = parseAssistResult('autofill', text, 'ctx');
    expect(r.name).toBe('PDF 签署');
    expect(r.summary).toBe('签 PDF');
    expect(r.descriptionMd).toBe('## 介绍');
    expect(r.tags).toEqual(['pdf', 'forms']);
    expect(r.triggers).toEqual(['签 pdf']);
  });

  it('single-field actions only pull their own field', () => {
    const r = parseAssistResult('summary', '{"summary":"hi","name":"ignored"}', 'ctx');
    expect(r.summary).toBe('hi');
    expect(r.name).toBeUndefined();
  });

  it('tokens parses a number and falls back to the heuristic', () => {
    expect(parseAssistResult('tokens', '{"tokenCost": 1500}', 'ctx').tokenCost).toBe(1500);
    // bad number → heuristic over the context (4 chars/token → ceil(8/4)=2)
    expect(parseAssistResult('tokens', 'garbage', '12345678').tokenCost).toBe(2);
  });

  it('caps an absurd token estimate at 50000', () => {
    expect(parseAssistResult('tokens', '{"tokenCost": 999999}', 'ctx').tokenCost).toBe(50000);
  });
});

describe('assistInputSchema', () => {
  // Regression guard: assist had a 200KB cap while the uploader accepted 256KB, so
  // every AI call on a large skill 400'd ("invalid input"). Caps are now removed
  // (internal deploy) — any size the pipeline stored must pass; buildAssistContext
  // slices for the LLM rather than rejecting.
  it('accepts an arbitrarily large skillMd / readme / many files (no size cap)', () => {
    const r = assistInputSchema.safeParse({
      action: 'autofill',
      skillMd: 'a'.repeat(1_000_000),
      readme: 'r'.repeat(1_000_000),
      files: Array.from({ length: 300 }, (_, i) => ({ path: `f${i}.md`, content: 'c' })),
    });
    expect(r.success).toBe(true);
  });

  it('still rejects empty skillMd and unknown actions', () => {
    expect(assistInputSchema.safeParse({ action: 'tags', skillMd: '' }).success).toBe(false);
    expect(assistInputSchema.safeParse({ action: 'nope', skillMd: 'x' }).success).toBe(false);
  });

  it('pack needs packSkills instead of skillMd', () => {
    expect(
      assistInputSchema.safeParse({ action: 'pack', packSkills: [{ name: 'pdf 签署' }] }).success,
    ).toBe(true);
    expect(assistInputSchema.safeParse({ action: 'pack' }).success).toBe(false);
    expect(assistInputSchema.safeParse({ action: 'pack', packSkills: [] }).success).toBe(false);
  });
});

describe('pack assist', () => {
  it('buildPackAssistContext lists members with summary and truncated description', () => {
    const ctx = buildPackAssistContext([
      { name: 'PDF 签署', summary: '签 PDF', descriptionMd: 'x'.repeat(1000) },
      { name: 'Excel 转换' },
    ]);
    expect(ctx).toContain('## PDF 签署');
    expect(ctx).toContain('一句话：签 PDF');
    expect(ctx).toContain('## Excel 转换');
    expect(ctx).not.toContain('x'.repeat(601)); // description capped at 600 chars
  });

  it('pack prompt asks for a name only when the pack has none yet', () => {
    const named = buildAssistPrompt('pack', 'CTX', { name: '办公套件' });
    expect(named.user).toContain('办公套件');
    expect(named.user).not.toContain('"name"');
    const unnamed = buildAssistPrompt('pack', 'CTX', {});
    expect(unnamed.user).toContain('"name"');
  });

  it('parseAssistResult maps pack fields', () => {
    const r = parseAssistResult(
      'pack',
      '{"name":"办公套件","summary":"一站式办公自动化","descriptionMd":"### 包含内容","tags":["ignored"]}',
      'ctx',
    );
    expect(r.name).toBe('办公套件');
    expect(r.summary).toBe('一站式办公自动化');
    expect(r.descriptionMd).toBe('### 包含内容');
    expect(r.tags).toBeUndefined();
  });
});

describe('buildAssistPrompt', () => {
  it('autofill only asks for the still-empty fields', () => {
    const p = buildAssistPrompt('autofill', 'CTX', { name: 'have', summary: 'have' });
    expect(p.user).toContain('descriptionMd');
    expect(p.user).toContain('tags');
    expect(p.user).not.toMatch(/还空着的字段：[^\n]*name/); // name was filled → not requested
  });
});
