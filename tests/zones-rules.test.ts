import { describe, expect, it } from 'vitest';
import { ZONE_RULES_WIKI_SLUG, splitMarkdownSections } from '@/lib/zones/rules';

describe('splitMarkdownSections (版规 accordion)', () => {
  it('is keyed to the `rules` wiki slug', () => {
    expect(ZONE_RULES_WIKI_SLUG).toBe('rules');
  });

  it('returns [] for an empty or whitespace body', () => {
    expect(splitMarkdownSections('')).toEqual([]);
    expect(splitMarkdownSections('\n\n  \n')).toEqual([]);
  });

  it('keeps the text before the first heading as a heading-less lead section', () => {
    const md = 'Welcome — read these first.\n\n## 1. Respect\n\nDiscuss the work.';
    expect(splitMarkdownSections(md)).toEqual([
      { heading: null, body: 'Welcome — read these first.' },
      { heading: '1. Respect', body: 'Discuss the work.' },
    ]);
  });

  it('splits at h2 and h3, in document order, with heading text from extractHeadings', () => {
    const md = ['## 1. 尊重与专业', '', '讨论围绕技术。', '', '### 1.1 细则', '', '不针对个人。', '', '## 2. 分享', '', '附上数据。'].join('\n');
    expect(splitMarkdownSections(md)).toEqual([
      { heading: '1. 尊重与专业', body: '讨论围绕技术。' },
      { heading: '1.1 细则', body: '不针对个人。' },
      { heading: '2. 分享', body: '附上数据。' },
    ]);
  });

  it('strips inline emphasis from the heading label like the TOC does', () => {
    expect(splitMarkdownSections('## **Bold** rule\n\nbody')).toEqual([{ heading: 'Bold rule', body: 'body' }]);
  });

  it('ignores `#` lines inside fenced code (they are code, not rules)', () => {
    const md = ['## Real', '', '```sh', '## not a heading', '# nor this', '```', '', 'after'].join('\n');
    const sections = splitMarkdownSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Real');
    expect(sections[0].body).toContain('## not a heading');
    expect(sections[0].body).toContain('after');
  });

  it('does not split at h1 or h4+ (an in-body h1 is a lead heading, h4 is sub-structure)', () => {
    const md = ['# Title', '', 'intro', '', '## Rule', '', '#### detail', '', 'text'].join('\n');
    expect(splitMarkdownSections(md)).toEqual([
      { heading: null, body: '# Title\n\nintro' },
      { heading: 'Rule', body: '#### detail\n\ntext' },
    ]);
  });

  it('produces a section for a heading with an empty body', () => {
    expect(splitMarkdownSections('## A\n## B\n\nb')).toEqual([
      { heading: 'A', body: '' },
      { heading: 'B', body: 'b' },
    ]);
  });
});
