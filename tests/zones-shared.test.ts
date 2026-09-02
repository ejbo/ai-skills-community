import { describe, expect, it } from 'vitest';
import {
  ACCESS_CODE_ALPHABET,
  ACCESS_CODE_LENGTH,
  EMBED_FILE_KEY_RE,
  EMBED_TOKEN_GLOBAL_RE,
  EMBED_TOKEN_RE,
  MAX_EMBEDS_PER_CONTENT,
  MAX_ZONE_COLUMNS,
  MAX_ZONE_LINKS,
  MAX_ZONE_POST_TAGS,
  RESERVED_ZONE_SLUGS,
  UNCATEGORIZED_COLUMN_PARAM,
  ZONE_LIMITS,
  ZONE_POST_VISIBILITIES,
  bodyFileKeys,
  collectEmbedRefs,
  columnDedupeKey,
  columnSlugFrom,
  decodeOffsetCursor,
  decodeTimeCursor,
  embedKey,
  embedToken,
  encodeTimeCursor,
  estimateReadMinutes,
  excerptOf,
  extractHeadings,
  headingSlug,
  isValidAccessCode,
  isValidColumnSlug,
  isValidWikiSlug,
  isZonePostVisibility,
  isValidZoneSlug,
  isEmbedFileKey,
  mergeBodyFileKeys,
  normalizeAccessCode,
  normalizeColumnName,
  normalizeEmbedRef,
  normalizeHttpUrl,
  normalizeTags,
  parseEmbedToken,
  parseMultiParam,
  parseZoneFeedSort,
  parseZoneLinks,
  serializeMultiParam,
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

describe('栏目 (columns)', () => {
  it('column slugs allow single chars and reject the edges', () => {
    expect(isValidColumnSlug('a')).toBe(true);
    expect(isValidColumnSlug('llm-infra')).toBe(true);
    expect(isValidColumnSlug('a'.repeat(40))).toBe(true);
    expect(isValidColumnSlug('a'.repeat(41))).toBe(false);
    expect(isValidColumnSlug('-a')).toBe(false);
    expect(isValidColumnSlug('a-')).toBe(false);
    expect(isValidColumnSlug('Infra')).toBe(false);
    expect(isValidColumnSlug('大模型')).toBe(false);
    expect(isValidColumnSlug('')).toBe(false);
  });

  it('columnSlugFrom folds a latin name and gives up on a CJK-only one', () => {
    expect(columnSlugFrom('Weekly Report')).toBe('weekly-report');
    expect(columnSlugFrom('  Infra & Ops  ')).toBe('infra-ops');
    // '' is the signal for the caller to fall back to `col-<nanoid>`.
    expect(columnSlugFrom('每周简报')).toBe('');
  });

  it('normalizeColumnName collapses whitespace and caps at the shared limit', () => {
    expect(normalizeColumnName('  大模型   推理  ')).toBe('大模型 推理');
    expect(normalizeColumnName('a'.repeat(60))).toHaveLength(ZONE_LIMITS.columnNameMax);
  });

  it('columnDedupeKey ignores case and spacing so near-twins never both exist', () => {
    expect(columnDedupeKey('大模型 推理')).toBe(columnDedupeKey('大模型推理'));
    expect(columnDedupeKey('LLM Infra')).toBe(columnDedupeKey('  llm   infra '));
    expect(columnDedupeKey('推理')).not.toBe(columnDedupeKey('训练'));
  });

  it('caps how many 栏目 a zone may hold', () => {
    expect(MAX_ZONE_COLUMNS).toBeGreaterThan(0);
  });
});

describe('帖子可见性 + 访问密码', () => {
  it('knows the three visibility values and nothing else', () => {
    expect([...ZONE_POST_VISIBILITIES]).toEqual(['zone', 'members', 'restricted']);
    for (const v of ZONE_POST_VISIBILITIES) expect(isZonePostVisibility(v)).toBe(true);
    expect(isZonePostVisibility('public')).toBe(false);
    expect(isZonePostVisibility(null)).toBe(false);
  });

  it('normalizeAccessCode uppercases and drops separators', () => {
    expect(normalizeAccessCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeAccessCode('a b c 2 3 4')).toBe('ABC234');
    expect(normalizeAccessCode('')).toBe('');
  });

  it('validates a normalized code and rejects look-alike / wrong-length input', () => {
    expect(isValidAccessCode('abc-234')).toBe(true);
    expect(isValidAccessCode('ABC234')).toBe(true);
    expect(isValidAccessCode('ABC23')).toBe(false);
    expect(isValidAccessCode('ABC2345')).toBe(false);
    // 0/1/O/I are not in the alphabet — a mistyped code fails fast.
    expect(isValidAccessCode('ABC201')).toBe(false);
    expect(isValidAccessCode('中文密码')).toBe(false);
  });

  it('every code the alphabet can produce passes isValidAccessCode', () => {
    expect(ACCESS_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    for (let i = 0; i < ACCESS_CODE_ALPHABET.length; i++) {
      const code = Array.from({ length: ACCESS_CODE_LENGTH }, (_, k) => ACCESS_CODE_ALPHABET[(i + k) % ACCESS_CODE_ALPHABET.length]).join('');
      expect(isValidAccessCode(code)).toBe(true);
    }
  });
});

describe('hub filters', () => {
  it('parseMultiParam trims, dedupes, drops empties and caps', () => {
    expect(parseMultiParam('a,b,,a, c ')).toEqual(['a', 'b', 'c']);
    expect(parseMultiParam('')).toEqual([]);
    expect(parseMultiParam(null)).toEqual([]);
    expect(parseMultiParam(undefined)).toEqual([]);
    expect(parseMultiParam('中国研究所,加拿大研究所')).toEqual(['中国研究所', '加拿大研究所']);
    expect(parseMultiParam(Array.from({ length: 30 }, (_, i) => `v${i}`).join(','))).toHaveLength(20);
    expect(parseMultiParam('a,b,c', 2)).toEqual(['a', 'b']);
  });

  it('serializeMultiParam round-trips through parseMultiParam', () => {
    const values = ['多模态研究所', '推理系统部'];
    expect(serializeMultiParam(values)).toBe('多模态研究所,推理系统部');
    expect(parseMultiParam(serializeMultiParam(values))).toEqual(values);
    expect(serializeMultiParam(['a', '', 'b'])).toBe('a,b');
    expect(serializeMultiParam([])).toBe('');
  });

  it('parseZoneFeedSort only ever answers new | hot', () => {
    expect(parseZoneFeedSort('hot')).toBe('hot');
    expect(parseZoneFeedSort('new')).toBe('new');
    expect(parseZoneFeedSort('active')).toBe('new');
    expect(parseZoneFeedSort(null)).toBe('new');
    expect(parseZoneFeedSort(undefined)).toBe('new');
  });
});

describe('file embeds by storage key', () => {
  const key = 'file/V1StGXR8_Z5jdHi6B-myT.pptx';

  it('accepts the three attachment-kind key prefixes with an extension', () => {
    expect(parseEmbedToken(`[embed:file:${key}]`)).toEqual({ kind: 'file', ref: key });
    expect(parseEmbedToken('[embed:file:image/abc_123-x.jpg]')).toEqual({ kind: 'file', ref: 'image/abc_123-x.jpg' });
    expect(parseEmbedToken('[embed:file:video/clip.mp4]')).toEqual({ kind: 'file', ref: 'video/clip.mp4' });
    expect(isEmbedFileKey(key)).toBe(true);
    expect(EMBED_FILE_KEY_RE.test('file/x.webp')).toBe(true);
  });

  it('still accepts the row-id form', () => {
    expect(parseEmbedToken('[embed:file:clxyz123]')).toEqual({ kind: 'file', ref: 'clxyz123' });
    expect(isEmbedFileKey('clxyz123')).toBe(false);
    expect(normalizeEmbedRef('file', 'clxyz123')).toBe('clxyz123');
  });

  it('rejects the namespaces that never have an attachment row, traversal and ext-less keys', () => {
    for (const bad of ['cover/x.jpg', 'poster/x.jpg', 'preview/x.pdf', 'icon/x.png', 'file/../x.pdf', 'file/x', 'file/x.', 'file/x.PDF', 'file//x.pdf', 'file/x.pdf/y.pdf']) {
      expect(parseEmbedToken(`[embed:file:${bad}]`)).toBeNull();
      expect(isEmbedFileKey(bad)).toBe(false);
    }
    // an overlong nanoid segment
    expect(isEmbedFileKey(`file/${'a'.repeat(81)}.pdf`)).toBe(false);
  });

  it('only the `file` kind widens — every other kind keeps the plain-id ref grammar', () => {
    expect(parseEmbedToken('[embed:skill:file/x.pdf]')).toBeNull();
    expect(parseEmbedToken('[embed:post:image/x.jpg]')).toBeNull();
    expect(normalizeEmbedRef('short', 'video/x.mp4')).toBeNull();
    expect(normalizeEmbedRef('file', ' file/x.pdf ')).toBe('file/x.pdf');
  });

  it('a key-form and an id-form token are distinct segments (the server keys the answer by ref form)', () => {
    const md = `[embed:file:${key}]\n[embed:file:clxyz123]`;
    expect(splitEmbedSegments(md)).toEqual([
      { type: 'embed', kind: 'file', ref: key, key: `file:${key}` },
      { type: 'embed', kind: 'file', ref: 'clxyz123', key: 'file:clxyz123' },
    ]);
  });

  it('the per-body cap is 200 (server pre-resolution makes a long ledger affordable)', () => {
    expect(MAX_EMBEDS_PER_CONTENT).toBe(200);
  });

  it('bodyFileKeys returns the distinct KEY refs in render order and skips row ids', () => {
    expect(bodyFileKeys('[embed:file:file/a.pdf]\n[embed:file:clid1]\n[embed:file:file/a.pdf]')).toEqual(['file/a.pdf']);
    expect(bodyFileKeys(`[embed:file:image/b.png]\ntext\n[embed:file:file/a.pdf]\n[embed:skill:file/c.pdf]`)).toEqual([
      'image/b.png',
      'file/a.pdf',
    ]);
    // a token inside a fence is inert text, never a key to union
    expect(bodyFileKeys('```\n[embed:file:file/a.pdf]\n```')).toEqual([]);
    expect(bodyFileKeys('')).toEqual([]);
  });

  it('mergeBodyFileKeys keeps the ledger rows and appends each missing body key once', () => {
    type Item = { key: string; name: string; mimeType: string; sizeBytes: number };
    const make = (k: string): Item => ({ key: k, name: '', mimeType: '', sizeBytes: 0 });
    const ledger: Item[] = [{ key: 'file/a.pdf', name: 'A.pdf', mimeType: 'application/pdf', sizeBytes: 10 }];
    const md = '[embed:file:file/a.pdf]\n\n[embed:file:file/b.pdf]\n\n[embed:file:file/b.pdf]\n[embed:file:clid1]';
    const merged = mergeBodyFileKeys(ledger, md, make);
    expect(merged).toEqual([ledger[0], { key: 'file/b.pdf', name: '', mimeType: '', sizeBytes: 0 }]);
    // the input array is never mutated; a body without keys is an identity
    expect(ledger).toHaveLength(1);
    expect(mergeBodyFileKeys(ledger, 'plain text', make)).toEqual(ledger);
    expect(mergeBodyFileKeys([], md, make).map((i) => i.key)).toEqual(['file/a.pdf', 'file/b.pdf']);
  });
});

describe('未归栏 sentinel', () => {
  it('can never collide with a real 栏目 slug', () => {
    expect(UNCATEGORIZED_COLUMN_PARAM).toBe('_none');
    expect(isValidColumnSlug(UNCATEGORIZED_COLUMN_PARAM)).toBe(false);
    // `none` itself IS a legal slug — which is exactly why the sentinel carries the underscore
    expect(isValidColumnSlug('none')).toBe(true);
  });
});
