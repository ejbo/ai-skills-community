// 主题词 sanitizer (lib/zones/shared.ts) — the PATCH route, updateZone and the
// chip input all run the same pass.
import { describe, expect, it } from 'vitest';
import { MAX_ZONE_TOPICS, ZONE_TOPIC_MAX, sanitizeZoneTopics } from '@/lib/zones/shared';

describe('sanitizeZoneTopics', () => {
  it('non-arrays and non-strings → dropped', () => {
    expect(sanitizeZoneTopics(null)).toEqual([]);
    expect(sanitizeZoneTopics('llm')).toEqual([]);
    expect(sanitizeZoneTopics([1, null, { a: 1 }, 'llm'])).toEqual(['llm']);
  });

  it('trims, collapses inner whitespace, drops empties', () => {
    expect(sanitizeZoneTopics(['  大模型   推理 ', '', '   ', '\tRAG\n'])).toEqual(['大模型 推理', 'RAG']);
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(sanitizeZoneTopics(['LLM', 'llm', 'Llm', 'rag'])).toEqual(['LLM', 'rag']);
  });

  it('caps each topic at ZONE_TOPIC_MAX and the list at MAX_ZONE_TOPICS', () => {
    const long = 'a'.repeat(ZONE_TOPIC_MAX + 5);
    expect(sanitizeZoneTopics([long])[0]).toHaveLength(ZONE_TOPIC_MAX);
    const many = Array.from({ length: MAX_ZONE_TOPICS + 4 }, (_, i) => `t${i}`);
    expect(sanitizeZoneTopics(many)).toHaveLength(MAX_ZONE_TOPICS);
  });

  it('a topic that becomes a duplicate after capping is still deduped', () => {
    const a = 'b'.repeat(ZONE_TOPIC_MAX) + 'x';
    const b = 'b'.repeat(ZONE_TOPIC_MAX) + 'y';
    expect(sanitizeZoneTopics([a, b])).toHaveLength(1);
  });
});
