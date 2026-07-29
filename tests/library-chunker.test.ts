import { describe, expect, it } from 'vitest';
import { CHUNKER_VERSION, chunkChapterText, estimateTokens } from '@/lib/library/chunker';

const ZH_PARA = '大语言模型正在改变知识工作的形态。检索增强生成让模型可以引用文档原文回答问题，而不是凭记忆瞎猜。';
const EN_PARA =
  'Retrieval-augmented generation grounds the model in the source document, so answers can cite exact passages instead of hallucinating from parametric memory alone.';

function mixedText(paragraphs = 12): string {
  const parts: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    parts.push(i % 2 === 0 ? `第${i + 1}段：${ZH_PARA.repeat(3)}` : `Paragraph ${i + 1}. ${EN_PARA} ${EN_PARA}`);
  }
  return parts.join('\n\n');
}

function assertInvariant(text: string, chunks: ReturnType<typeof chunkChapterText>) {
  for (const chunk of chunks) {
    expect(chunk.text).toBe(text.slice(chunk.charStart, chunk.charEnd));
    expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
    expect(chunk.text.trim().length).toBeGreaterThan(0);
  }
}

describe('estimateTokens', () => {
  it('weights CJK chars and latin words differently', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('中文内容')).toBe(Math.ceil(4 / 1.6));
    expect(estimateTokens('two words')).toBe(Math.ceil(2 * 1.3));
  });
});

describe('chunkChapterText', () => {
  it('exports a stable version for staleness checks', () => {
    expect(CHUNKER_VERSION).toBe(1);
  });

  it('returns [] for empty / whitespace-only text', () => {
    expect(chunkChapterText(0, '')).toEqual([]);
    expect(chunkChapterText(0, '  \n\n   \n\n')).toEqual([]);
  });

  it('every chunk is an exact substring of the chapter text (mixed zh/en)', () => {
    const text = mixedText();
    const chunks = chunkChapterText(3, text);
    expect(chunks.length).toBeGreaterThan(0);
    assertInvariant(text, chunks);
    chunks.forEach((chunk, i) => {
      expect(chunk.chapterIndex).toBe(3);
      expect(chunk.ordinal).toBe(i);
      expect(chunk.tokenEstimate).toBe(estimateTokens(chunk.text));
    });
  });

  it('packs whole paragraphs and keeps chunks under the max budget', () => {
    const text = mixedText(40);
    const chunks = chunkChapterText(0, text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(800);
    }
    // Chunks are ordered and non-overlapping.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeGreaterThanOrEqual(chunks[i - 1].charEnd);
    }
  });

  it('hard-splits an oversized single paragraph at sentence terminators', () => {
    const sentence = `模型上下文窗口有限，超长段落必须先拆分。${ZH_PARA}`;
    const text = sentence.repeat(60); // one paragraph, no \n\n, ~4000 tokens
    expect(estimateTokens(text)).toBeGreaterThan(800);
    const chunks = chunkChapterText(1, text);
    expect(chunks.length).toBeGreaterThan(1);
    assertInvariant(text, chunks);
    for (const chunk of chunks) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(800);
    }
  });

  it('falls back to char windows when a single sentence has no terminators', () => {
    const text = '啊'.repeat(5000); // no terminators at all
    const chunks = chunkChapterText(0, text);
    expect(chunks.length).toBeGreaterThan(1);
    assertInvariant(text, chunks);
  });

  it('is deterministic', () => {
    const text = mixedText(20);
    expect(chunkChapterText(2, text)).toEqual(chunkChapterText(2, text));
  });
});
