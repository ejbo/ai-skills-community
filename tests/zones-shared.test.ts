import { describe, expect, it } from 'vitest';
import {
  EMBED_TOKEN_GLOBAL_RE,
  EMBED_TOKEN_RE,
  MAX_EMBEDS_PER_CONTENT,
  MAX_ZONE_LINKS,
  MAX_ZONE_POST_TAGS,
  RESERVED_ZONE_SLUGS,
  collectEmbedRefs,
  decodeOffsetCursor,
  decodeTimeCursor,
  embedKey,
  embedToken,
  encodeTimeCursor,
  estimateReadMinutes,
  excerptOf,
  extractHeadings,
  headingSlug,
  isValidWikiSlug,
  isValidZoneSlug,
  normalizeHttpUrl,
  normalizeTags,
  parseEmbedToken,
  parseZoneLinks,
  slugifyAscii,
  splitEmbedSegments,
  zoneHref,
  zonePostHref,
  zoneWikiHref,
} from '@/lib/zones/shared';

describe('zone slugs', () => {
  it('accepts lowercase ascii/digit/dash slugs of 3–40 chars', () => {
    expect(isValidZoneSlug('llm-infra')).toBe(true);
    expect(isValidZoneSlug('abc')).toBe(true);
    expect(isValidZoneSlug('a1-b2-c3')).toBe(true);
    expect(isValidZoneSlug('a'.repeat(40))).toBe(true);
  });

  it('rejects short, long, uppercase, dash-edged, double-dash and reserved slugs', () => {
    expect(isValidZoneSlug('ab')).toBe(false);
    expect(isValidZoneSlug('a'.repeat(41))).toBe(false);
    expect(isValidZoneSlug('LLM-Infra')).toBe(false);
    expect(isValidZoneSlug('-llm')).toBe(false);
    expect(isValidZoneSlug('llm-')).toBe(false);
    expect(isValidZoneSlug('llm infra')).toBe(false);
    expect(isValidZoneSlug('中文')).toBe(false);
    for (const r of RESERVED_ZONE_SLUGS) expect(isValidZoneSlug(r)).toBe(false);
  });

  it('slugifyAscii folds accents, punctuation and case; CJK-only input yields empty', () => {
    expect(slugifyAscii('LLM Infra 团队!')).toBe('llm-infra');
    expect(slugifyAscii('  Émile — Zola  ')).toBe('emile-zola');
    expect(slugifyAscii('多模态研究所')).toBe('');
    expect(slugifyAscii('a'.repeat(60))).toHaveLength(40);
    // a trim that lands on a dash drops it (never a trailing dash)
    expect(slugifyAscii('abc-'.repeat(12), 8)).toBe('abc-abc');
  });

  it('wiki slugs allow single-char pages but not the routing words', () => {
    expect(isValidWikiSlug('faq')).toBe(true);
    expect(isValidWikiSlug('a')).toBe(true);
    expect(isValidWikiSlug('new')).toBe(false);
    expect(isValidWikiSlug('edit')).toBe(false);
    expect(isValidWikiSlug('-x')).toBe(false);
  });
});

describe('parseZoneLinks / normalizeHttpUrl', () => {
  it('keeps http(s) rows, defaults the label to the hostname, trims and caps labels', () => {
    const links = parseZoneLinks([
      { label: '  Repo  ', url: 'https://github.com/foo/bar' },
      { url: 'https://www.example.com/path' },
      { label: 'x'.repeat(60), url: 'http://a.b' },
    ]);
    expect(links).toEqual([
      { label: 'Repo', url: 'https://github.com/foo/bar' },
      { label: 'example.com', url: 'https://www.example.com/path' },
      { label: 'x'.repeat(40), url: 'http://a.b/' },
    ]);
  });

  it('drops non-http, malformed and non-object rows; non-arrays yield []', () => {
    expect(parseZoneLinks('nope')).toEqual([]);
    expect(parseZoneLinks(null)).toEqual([]);
    expect(
      parseZoneLinks([
        { label: 'js', url: 'javascript:alert(1)' },
        { label: 'ftp', url: 'ftp://x.y' },
        { label: 'bad', url: 'not a url' },
        'string-row',
        null,
        { label: 'ok', url: 'https://ok.example' },
      ]),
    ).toEqual([{ label: 'ok', url: 'https://ok.example/' }]);
  });

  it('caps at MAX_ZONE_LINKS', () => {
    const many = Array.from({ length: MAX_ZONE_LINKS + 5 }, (_, i) => ({ url: `https://h${i}.example` }));
    expect(parseZoneLinks(many)).toHaveLength(MAX_ZONE_LINKS);
  });

  it('normalizeHttpUrl rejects empties, overlong and non-http schemes', () => {
    expect(normalizeHttpUrl('')).toBeNull();
    expect(normalizeHttpUrl(undefined)).toBeNull();
    expect(normalizeHttpUrl(`https://x.y/${'a'.repeat(2100)}`)).toBeNull();
    expect(normalizeHttpUrl('mailto:a@b.c')).toBeNull();
    expect(normalizeHttpUrl('  https://x.y/a?b=1  ')).toBe('https://x.y/a?b=1');
  });
});

describe('normalizeTags', () => {
  it('trims, collapses whitespace, dedupes case-insensitively and caps length/count', () => {
    expect(normalizeTags(['  LLM ', 'llm', 'RAG   eval', '', 42, 'x'.repeat(30)])).toEqual([
      'LLM',
      'RAG eval',
      'x'.repeat(24),
    ]);
    const many = Array.from({ length: MAX_ZONE_POST_TAGS + 4 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_ZONE_POST_TAGS);
    expect(normalizeTags('not-an-array')).toEqual([]);
  });
});

describe('embed token splitting', () => {
  const slug = 'attention-is-all-you-need';
  const tok = embedToken('library', slug);
  const seg = { type: 'embed' as const, kind: 'library' as const, ref: slug, key: embedKey('library', slug) };

  it('matches own-line tokens, with or without markdown escapes', () => {
    expect(EMBED_TOKEN_RE.test(tok)).toBe(true);
    expect(EMBED_TOKEN_RE.test(`\\[embed:library:${slug}\\]`)).toBe(true);
    expect(EMBED_TOKEN_RE.test(`  ${tok}  `)).toBe(true);
    expect(EMBED_TOKEN_RE.test(`see ${tok} inline`)).toBe(false);
    expect(EMBED_TOKEN_RE.test('[embed:unknown:x]')).toBe(false);
    expect(parseEmbedToken(tok)).toEqual({ kind: 'library', ref: slug });
    expect(parseEmbedToken('[embed:skill:has space]')).toBeNull(); // invalid ref stays text
  });

  it('splits content around the token', () => {
    const md = `before\n\n${tok}\n\nafter`;
    expect(splitEmbedSegments(md)).toEqual([{ type: 'md', text: 'before\n' }, seg, { type: 'md', text: '\nafter' }]);
  });

  it('handles token-only content and multiple embeds of different kinds', () => {
    expect(splitEmbedSegments(tok)).toEqual([seg]);
    const two = splitEmbedSegments(`${tok}\n${embedToken('short', 'clx123')}`);
    expect(two).toEqual([seg, { type: 'embed', kind: 'short', ref: 'clx123', key: 'short:clx123' }]);
  });

  it('leaves plain content untouched (single md segment, fast path)', () => {
    expect(splitEmbedSegments('hello **world**')).toEqual([{ type: 'md', text: 'hello **world**' }]);
    expect(splitEmbedSegments(`a ${tok} b`)).toEqual([{ type: 'md', text: `a ${tok} b` }]);
  });

  it('never splits inside fenced code blocks, and fences round-trip intact', () => {
    const md = 'how to embed:\n\n```\n' + tok + '\n```\n\nafter';
    expect(splitEmbedSegments(md)).toEqual([{ type: 'md', text: md }]);
    const tilde = '~~~\n' + tok + '\n~~~';
    expect(splitEmbedSegments(tilde)).toEqual([{ type: 'md', text: tilde }]);
    // a token AFTER a properly closed fence still splits
    const closed = '```\ncode\n```\n' + tok;
    expect(splitEmbedSegments(closed)).toEqual([{ type: 'md', text: '```\ncode\n```' }, seg]);
    // a longer closing fence closes a shorter opener; a shorter one does not
    const nested = '````\n```\n' + tok + '\n```\n````\n' + tok;
    expect(splitEmbedSegments(nested)).toEqual([{ type: 'md', text: '````\n```\n' + tok + '\n```\n````' }, seg]);
  });

  it('treats 4-space/tab indented token lines as code, not embeds', () => {
    expect(splitEmbedSegments(`    ${tok}`)).toEqual([{ type: 'md', text: `    ${tok}` }]);
    expect(splitEmbedSegments(`\t${tok}`)).toEqual([{ type: 'md', text: `\t${tok}` }]);
    expect(splitEmbedSegments(`   ${tok}`)).toEqual([seg]);
  });

  it('dedupes repeated refs and caps widgets per content', () => {
    expect(splitEmbedSegments(`${tok}\n${tok}`)).toEqual([seg, { type: 'md', text: tok }]);
    const refs = Array.from({ length: MAX_EMBEDS_PER_CONTENT + 3 }, (_, i) => `skill-${i}`);
    const many = splitEmbedSegments(refs.map((r) => embedToken('skill', r)).join('\n'));
    expect(many.filter((s) => s.type === 'embed')).toHaveLength(MAX_EMBEDS_PER_CONTENT);
    expect(collectEmbedRefs(refs.map((r) => embedToken('skill', r)).join('\n'))).toHaveLength(MAX_EMBEDS_PER_CONTENT);
  });

  it('link refs are URL-normalized (query kept, scheme enforced) and dedupe on the normalized form', () => {
    const md = `[embed:link:https://Example.com/a?b=1]\n[embed:link:https://example.com/a?b=1]\n[embed:link:ftp://x.y]`;
    const segs = splitEmbedSegments(md);
    expect(segs[0]).toEqual({ type: 'embed', kind: 'link', ref: 'https://example.com/a?b=1', key: 'link:https://example.com/a?b=1' });
    // second is a duplicate → inert text; third has a bad scheme → inert text
    expect(segs.slice(1)).toEqual([{ type: 'md', text: '[embed:link:https://example.com/a?b=1]\n[embed:link:ftp://x.y]' }]);
  });

  it('collectEmbedRefs returns distinct refs in render order', () => {
    const md = `${embedToken('event', 'ev1')}\ntext\n${embedToken('pack', 'p1')}\n${embedToken('event', 'ev1')}`;
    expect(collectEmbedRefs(md)).toEqual([
      { kind: 'event', ref: 'ev1' },
      { kind: 'pack', ref: 'p1' },
    ]);
  });

  it('EMBED_TOKEN_GLOBAL_RE strips both plain and escaped forms', () => {
    const text = `a \\[embed:library:${slug}\\] b ${tok} c`;
    expect(text.replace(EMBED_TOKEN_GLOBAL_RE, ' ').includes('embed:')).toBe(false);
  });
});

describe('excerptOf / estimateReadMinutes', () => {
  it('strips embed tokens, poll tokens, images, code and markdown noise', () => {
    const md = `# Title\n\n[embed:library:foo]\n\n[poll:abcdefgh]\n\n![img](x.png) some **bold** [link](u) text\n\n\`\`\`js\ncode\n\`\`\``;
    expect(excerptOf(md)).toBe('Title some bold link text');
  });

  it('cuts on code points and appends an ellipsis', () => {
    const emoji = '😀'.repeat(10);
    const out = excerptOf(emoji, 4);
    expect(out).toBe(`${'😀'.repeat(4)}…`);
    expect(excerptOf('short', 10)).toBe('short');
  });

  it('read minutes never drops below 1 and scales with CJK chars / latin words', () => {
    expect(estimateReadMinutes('')).toBe(1);
    expect(estimateReadMinutes('字'.repeat(1200))).toBe(3);
    expect(estimateReadMinutes(Array.from({ length: 660 }, () => 'word').join(' '))).toBe(3);
  });
});

describe('extractHeadings', () => {
  it('collects h1–h3 with slug ids, dedupes ids and skips fenced code', () => {
    const md = [
      '# Intro',
      '## Setup',
      '```',
      '# not a heading',
      '```',
      '### Setup',
      '#### too deep',
      '## Setup ##',
      '##NoSpace',
      '## `code` *em* heading',
    ].join('\n');
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: 'Intro', id: 'intro' },
      { level: 2, text: 'Setup', id: 'setup' },
      { level: 3, text: 'Setup', id: 'setup-1' },
      { level: 2, text: 'Setup', id: 'setup-2' },
      { level: 2, text: 'code em heading', id: 'code-em-heading' },
    ]);
    expect(extractHeadings(md, 1)).toHaveLength(1);
  });

  it('headingSlug keeps CJK, drops punctuation and falls back to "section"', () => {
    expect(headingSlug('模型 训练：第一步!')).toBe('模型-训练第一步');
    expect(headingSlug('!!!')).toBe('section');
  });
});

describe('cursors', () => {
  it('time cursors round-trip and reject garbage', () => {
    const at = new Date('2026-08-25T10:00:00.000Z');
    const c = encodeTimeCursor({ at, id: 'abc' });
    expect(c).toBe('2026-08-25T10:00:00.000Z|abc');
    expect(decodeTimeCursor(c)).toEqual({ at, id: 'abc' });
    expect(decodeTimeCursor(encodeTimeCursor({ at: at.toISOString(), id: 'x' }))).toEqual({ at, id: 'x' });
    expect(decodeTimeCursor('')).toBeNull();
    expect(decodeTimeCursor(null)).toBeNull();
    expect(decodeTimeCursor('|abc')).toBeNull();
    expect(decodeTimeCursor('not-a-date|abc')).toBeNull();
    expect(decodeTimeCursor('2026-08-25T10:00:00.000Z|')).toBeNull();
  });

  it('offset cursors parse `o:<n>` and clamp everything else to 0', () => {
    expect(decodeOffsetCursor('o:24')).toBe(24);
    expect(decodeOffsetCursor('o:-3')).toBe(0);
    expect(decodeOffsetCursor('o:1.9')).toBe(1);
    expect(decodeOffsetCursor('24')).toBe(0);
    expect(decodeOffsetCursor('o:abc')).toBe(0);
    expect(decodeOffsetCursor(undefined)).toBe(0);
  });
});

describe('hrefs', () => {
  it('build the zone / post / wiki routes', () => {
    expect(zoneHref('llm')).toBe('/zones/llm');
    expect(zonePostHref('llm', 'p1')).toBe('/zones/llm/posts/p1');
    expect(zoneWikiHref('llm')).toBe('/zones/llm/wiki');
    expect(zoneWikiHref('llm', 'faq')).toBe('/zones/llm/wiki/faq');
  });
});
