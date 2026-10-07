import { describe, expect, it } from 'vitest';
import { allocateSlug, decodeSlugParam, looksLikeCuid, titleSlug } from '@/lib/slug';

describe('titleSlug', () => {
  it('keeps CJK titles readable instead of falling back to a hash', () => {
    expect(titleSlug('大模型推理优化实践')).toBe('大模型推理优化实践');
    expect(titleSlug('Claude Code 实战指南（第二版）')).toBe('claude-code-实战指南-第二版');
  });

  it('folds case, Latin diacritics and full-width forms', () => {
    expect(titleSlug('Attention Is All You Need')).toBe('attention-is-all-you-need');
    expect(titleSlug('Café — Résumé')).toBe('cafe-resume');
    expect(titleSlug('ＧＰＴ４ 评测')).toBe('gpt4-评测');
  });

  it('keeps non-Latin combining marks that are part of the letter', () => {
    expect(titleSlug('がんばる')).toBe('がんばる');
    expect(titleSlug('한국어 제목')).toBe('한국어-제목');
    expect(titleSlug('हिन्दी')).toBe('हिन्दी');
  });

  it('turns punctuation, slashes and emoji into single separators', () => {
    expect(titleSlug('  a/b?c#d  ')).toBe('a-b-c-d');
    expect(titleSlug('🔥 热门 🔥')).toBe('热门');
    expect(titleSlug('???')).toBe('');
  });

  it('caps by code point and prefers a word boundary', () => {
    const long = 'attention is all you need for scaling large language models to production systems';
    const s = titleSlug(long, 30);
    expect(Array.from(s).length).toBeLessThanOrEqual(30);
    expect(s.endsWith('-')).toBe(false);
    expect(long.replace(/ /g, '-').startsWith(s)).toBe(true);
    expect(Array.from(titleSlug('长'.repeat(200))).length).toBe(60);
  });
});

describe('allocateSlug', () => {
  it('uses the base, then -2, -3 — never a random suffix', () => {
    expect(allocateSlug('ai-大赛', [], { fallback: 'vote' })).toBe('ai-大赛');
    expect(allocateSlug('ai-大赛', ['ai-大赛'], { fallback: 'vote' })).toBe('ai-大赛-2');
    expect(allocateSlug('ai-大赛', ['ai-大赛', 'ai-大赛-2', 'ai-大赛-3'], { fallback: 'vote' })).toBe('ai-大赛-4');
  });

  it('falls back for an empty base and never shadows a reserved route segment', () => {
    expect(allocateSlug('', [], { fallback: 'doc' })).toBe('doc');
    expect(allocateSlug('new', [], { fallback: 'vote', reserved: ['new', 'edit'] })).toBe('new-2');
  });
});

describe('decodeSlugParam', () => {
  it('decodes a still-encoded segment and leaves a decoded one alone', () => {
    expect(decodeSlugParam(encodeURIComponent('大模型-推理'))).toBe('大模型-推理');
    expect(decodeSlugParam('大模型-推理')).toBe('大模型-推理');
    expect(decodeSlugParam('%E0%A4%A')).toBe('%E0%A4%A');
  });
});

describe('looksLikeCuid', () => {
  it('tells row ids from slugs', () => {
    expect(looksLikeCuid('cmg8x2k1p0000abcdxyz12345')).toBe(true);
    expect(looksLikeCuid('ai-大赛')).toBe(false);
    expect(looksLikeCuid('attention-is-all-you-need')).toBe(false);
  });
});
