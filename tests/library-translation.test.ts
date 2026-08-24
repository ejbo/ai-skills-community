import { describe, it, expect } from 'vitest';
import { applyBlockTranslations, htmlBlockTexts, sanitizeChapterHtml } from '@/lib/library/sanitize';
import {
  parseTranslatedPassages,
  translatePassagesPrompt,
} from '@/lib/library/ai-prompts';
import { normalizeSource, sourceHash, targetLangFor } from '@/lib/library/translation';

const HTML = sanitizeChapterHtml(
  '<h2>Title</h2>' +
    '<p>First paragraph with <strong>emphasis</strong> inside.</p>' +
    '<ul><li>One</li><li>Two</li></ul>' +
    '<pre><code>const x = 1;</code></pre>' +
    '<figure><img src="/api/library/file/a.png" alt="pic"><figcaption>Caption</figcaption></figure>' +
    '<table><tbody><tr><td>Cell</td></tr></tbody></table>',
  { baseUrl: null },
);

describe('译文 block mapping', () => {
  it('collects every leaf block, and skips code', () => {
    const blocks = htmlBlockTexts(HTML);
    expect(blocks).toContain('Title');
    expect(blocks).toContain('First paragraph with emphasis inside.');
    expect(blocks).toContain('One');
    expect(blocks).toContain('Two');
    expect(blocks).toContain('Caption');
    expect(blocks).toContain('Cell');
    // Source code must never be handed to a translator.
    expect(blocks.some((b) => b.includes('const x = 1'))).toBe(false);
  });

  it('keeps the document structure and every tag intact', () => {
    const map = new Map(htmlBlockTexts(HTML).map((b) => [normalizeSource(b), `[${b}]`]));
    const out = applyBlockTranslations(HTML, map);
    for (const tag of ['<h2>', '<ul>', '<li>', '<pre>', '<figure>', '<figcaption>', '<table>', '<td>']) {
      expect(out).toContain(tag);
    }
    expect(out).toContain('src="/api/library/file/a.png"');
    expect(out).toContain('[Title]');
    expect(out).toContain('[Cell]');
    // The code block is untouched.
    expect(out).toContain('const x = 1;');
  });

  it('leaves untranslated blocks in the source language (a partial pass still reads)', () => {
    const out = applyBlockTranslations(HTML, new Map([[normalizeSource('Title'), '标题']]));
    expect(out).toContain('标题');
    expect(out).toContain('First paragraph with');
  });

  it('cannot inject markup — a translation only ever reaches the DOM as text', () => {
    const evil = new Map([[normalizeSource('Title'), '<img src=x onerror=alert(1)>']]);
    const out = applyBlockTranslations(HTML, evil);
    // Escaped, not parsed: the heading holds the literal characters and the
    // document still has exactly the ONE image it started with.
    expect(out).toContain('<h2>&lt;img src=x onerror=alert(1)&gt;</h2>');
    expect(out.match(/<img/g) ?? []).toHaveLength(1);
    expect(out).toContain('src="/api/library/file/a.png"');
  });
});

describe('translation cache keys', () => {
  it('normalizes whitespace so a DOM selection and a stored block share one row', () => {
    const fromDom = 'First paragraph with emphasis inside.';
    const fromHtml = '  First paragraph\n  with emphasis   inside. ';
    expect(normalizeSource(fromHtml)).toBe(fromDom);
    expect(sourceHash(fromHtml)).toBe(sourceHash(fromDom));
  });

  it('translates INTO the other language', () => {
    expect(targetLangFor('zh')).toBe('en');
    expect(targetLangFor('en')).toBe('zh');
    expect(targetLangFor(null)).toBe('zh');
  });
});

describe('batch translation prompt', () => {
  it('round-trips indices, and tolerates a partial reply', () => {
    const passages = ['alpha', 'beta', 'gamma'];
    const prompt = translatePassagesPrompt({ targetLang: 'zh', passages });
    expect(prompt.user).toContain('"i":0');
    expect(prompt.user).toContain('gamma');
    // No maxTokens: a cap is what truncates a reasoning model mid-<think>.
    expect(prompt.maxTokens).toBeUndefined();

    const parsed = parseTranslatedPassages(
      '<think>hmm</think>{"items":[{"i":2,"text":"丙"},{"i":0,"text":"甲"}]}',
    );
    expect(parsed.get(0)).toBe('甲');
    expect(parsed.get(2)).toBe('丙');
    expect(parsed.has(1)).toBe(false);
  });

  it('degrades to an empty map rather than throwing on junk', () => {
    expect(parseTranslatedPassages('sorry, I cannot').size).toBe(0);
  });
});
