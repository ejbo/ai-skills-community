import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_TAGS,
  MAX_OFFICIAL_TAGS,
  discussionTagLabel,
  isValidTagName,
  normalizeTagName,
  sanitizeTopicTags,
  slugifyDiscussionTag,
  tagColorIndex,
  type DiscussionTagOption,
} from '@/lib/discussion-tags';

const tag = (slug: string, official: boolean, name = slug): DiscussionTagOption => ({
  slug,
  name,
  nameEn: name,
  official,
});

const KNOWN = new Map<string, DiscussionTagOption>(
  [
    tag('tech', true, '技术交流'),
    tag('models', true, '模型与算法'),
    tag('agents', true, 'Agent 与工具'),
    tag('skills', true, 'Skill 开发'),
    tag('rag', false, 'RAG'),
    tag('d1abc', false, '长上下文'),
    tag('vllm', false, 'vLLM'),
    tag('sglang', false, 'SGLang'),
  ].map((t) => [t.slug, t]),
);

describe('sanitizeTopicTags', () => {
  it('侧栏分类排在自建之前 —— categories[0] 因此恒为 official', () => {
    const res = sanitizeTopicTags(['rag', 'models', 'vllm', 'tech'], KNOWN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.categories).toEqual(['models', 'tech', 'rag', 'vllm']);
    expect(res.value.official).toEqual(['models', 'tech']);
    expect(res.value.custom).toEqual(['rag', 'vllm']);
  });

  it('至少要有一个侧栏分类（只填自建的会被拒）', () => {
    expect(sanitizeTopicTags(['rag', 'vllm'], KNOWN)).toEqual({ ok: false, error: 'no_official' });
    expect(sanitizeTopicTags([], KNOWN)).toEqual({ ok: false, error: 'no_official' });
  });

  it('两类配额分开算，互不挤占', () => {
    const full = sanitizeTopicTags(
      ['tech', 'models', 'agents', 'rag', 'vllm', 'sglang'],
      KNOWN,
    );
    expect(full.ok).toBe(true);
    expect(MAX_OFFICIAL_TAGS).toBe(3);
    expect(MAX_CUSTOM_TAGS).toBe(3);

    expect(sanitizeTopicTags(['tech', 'models', 'agents', 'skills'], KNOWN)).toEqual({
      ok: false,
      error: 'too_many_official',
    });
    expect(sanitizeTopicTags(['tech', 'rag', 'vllm', 'sglang', 'd1abc'], KNOWN)).toEqual({
      ok: false,
      error: 'too_many_custom',
    });
  });

  it('去重（去重后仍在配额内就放行），未知 slug 直接拒', () => {
    const res = sanitizeTopicTags(['tech', 'tech', 'rag', 'rag'], KNOWN);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.categories).toEqual(['tech', 'rag']);

    expect(sanitizeTopicTags(['tech', 'nope'], KNOWN)).toEqual({ ok: false, error: 'unknown_tag' });
  });

  it('空串/空白项被忽略而不是当成未知分类', () => {
    const res = sanitizeTopicTags(['tech', '', '  '], KNOWN);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.categories).toEqual(['tech']);
  });
});

describe('slugifyDiscussionTag', () => {
  it('拉丁名 slugify', () => {
    expect(slugifyDiscussionTag('  RAG Eval ')).toBe('rag-eval');
    expect(slugifyDiscussionTag('vLLM')).toBe('vllm');
  });

  it('纯中文没得转写 —— 退化成稳定短哈希，且同名同 slug', () => {
    const a = slugifyDiscussionTag('长上下文');
    expect(a).toMatch(/^d[a-z0-9]+$/);
    expect(slugifyDiscussionTag('长上下文')).toBe(a);
    expect(slugifyDiscussionTag('多模态')).not.toBe(a);
  });

  it('单个拉丁字母不足以做 slug，也走哈希', () => {
    expect(slugifyDiscussionTag('A 模型')).toMatch(/^d[a-z0-9]+$/);
  });
});

describe('name normalization', () => {
  it('折叠内部空白', () => {
    expect(normalizeTagName('  长  上下文 ')).toBe('长 上下文');
  });

  it('长度边界', () => {
    expect(isValidTagName('a')).toBe(false);
    expect(isValidTagName('ab')).toBe(true);
    expect(isValidTagName('x'.repeat(24))).toBe(true);
    expect(isValidTagName('x'.repeat(25))).toBe(false);
  });
});

describe('discussionTagLabel', () => {
  const tl = (key: string) => (key === 'discussionCategory.tech' ? '技术交流' : key);

  it('内置分类走 i18n', () => {
    expect(discussionTagLabel(tag('tech', true, 'fallback'), 'zh-CN', tl)).toBe('技术交流');
  });

  it('缺 message key 时回落到存储名（next-intl 会把 key 原样渲染出来）', () => {
    expect(discussionTagLabel(tag('brandnew', true, '新分类'), 'zh-CN', tl)).toBe('新分类');
  });

  it('自建分类按 locale 取中/英名', () => {
    const custom: DiscussionTagOption = { slug: 'rag', name: '检索增强', nameEn: 'RAG', official: false };
    expect(discussionTagLabel(custom, 'zh-CN', tl)).toBe('检索增强');
    expect(discussionTagLabel(custom, 'en', tl)).toBe('RAG');
    // nameEn 为空时英文界面也回落到中文名，而不是渲染成空白
    expect(discussionTagLabel({ ...custom, nameEn: '' }, 'en', tl)).toBe('检索增强');
  });
});

describe('tagColorIndex', () => {
  it('稳定且落在调色板范围内', () => {
    for (const slug of ['rag', 'vllm', '长上下文', '']) {
      const i = tagColorIndex(slug, 6);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
      expect(tagColorIndex(slug, 6)).toBe(i);
    }
  });

  it('空调色板不会除零', () => {
    expect(tagColorIndex('rag', 0)).toBe(0);
  });
});

describe('退役分类（综合讨论）', () => {
  it('静默丢弃，而不是让编辑老帖的作者卡在报错上', () => {
    const known = new Map(KNOWN);
    known.set('general', tag('general', false, '综合讨论'));
    const res = sanitizeTopicTags(['tech', 'general'], known);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.categories).toEqual(['tech']);
  });

  it('只剩退役分类时仍然要求补一个侧栏分类', () => {
    const known = new Map(KNOWN);
    known.set('general', tag('general', false, '综合讨论'));
    expect(sanitizeTopicTags(['general'], known)).toEqual({ ok: false, error: 'no_official' });
  });
});
