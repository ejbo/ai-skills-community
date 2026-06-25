import { describe, expect, it } from 'vitest';
import {
  buildAssistContext,
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
});

describe('buildAssistContext', () => {
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

describe('buildAssistPrompt', () => {
  it('autofill only asks for the still-empty fields', () => {
    const p = buildAssistPrompt('autofill', 'CTX', { name: 'have', summary: 'have' });
    expect(p.user).toContain('descriptionMd');
    expect(p.user).toContain('tags');
    expect(p.user).not.toMatch(/还空着的字段：[^\n]*name/); // name was filled → not requested
  });
});
