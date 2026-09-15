import { describe, expect, it } from 'vitest';
import {
  CARD_BLUR_MAX,
  DEFAULT_CARD_CONFIG,
  HEADLINE_MAX,
  INTEREST_MAX,
  MAX_INTERESTS,
  MAX_LINKS,
  MAX_PINS,
  PROFILE_SECTIONS,
  cardPalette,
  isDefaultProfileLayout,
  isValidProfileMediaKey,
  layoutFromLegacyFlags,
  normalizeHexColor,
  parseCardConfig,
  parseMediaPos,
  parseProfileLayout,
  profileMediaUrl,
  resolveProfileTab,
  sanitizeAbout,
  sanitizeHeadline,
  sanitizeInterests,
  sanitizePins,
  sanitizeProfileLink,
  sanitizeProfileLinks,
  sliceCodePoints,
  togglePin,
} from '@/lib/profile/shared';

const ALL_ON = {
  showProfileSkills: true,
  showProfileDocs: true,
  showProfilePosts: true,
  showProfileComments: true,
  showProfileShelf: true,
  showProfileEvents: true,
};

describe('parseProfileLayout', () => {
  it('garbage degrades to the default', () => {
    for (const raw of ['x', 42, [], true]) {
      expect(isDefaultProfileLayout(parseProfileLayout(raw))).toBe(true);
    }
  });

  it('null means "never saved" and falls back to the legacy flags', () => {
    expect(isDefaultProfileLayout(parseProfileLayout(null, ALL_ON))).toBe(true);
    const l = parseProfileLayout(null, { ...ALL_ON, showProfilePosts: false, showProfileShelf: false });
    // showProfilePosts governed both 动态 and 论坛话题.
    expect(l.hidden).toEqual(['posts', 'topics', 'shelf']);
    expect(l.order).toEqual([...PROFILE_SECTIONS]);
  });

  it('a saved layout wins over the legacy flags', () => {
    const l = parseProfileLayout({ order: [], hidden: [] }, { ...ALL_ON, showProfileSkills: false });
    expect(l.hidden).toEqual([]);
  });

  it('drops unknown and duplicate ids and appends missing sections in default order', () => {
    const l = parseProfileLayout({ order: ['shelf', 'nope', 'shelf', 'skills'], hidden: ['docs', 'docs', 'evil'] });
    expect(l.order.slice(0, 2)).toEqual(['shelf', 'skills']);
    expect(l.order).toHaveLength(PROFILE_SECTIONS.length);
    expect(new Set(l.order).size).toBe(PROFILE_SECTIONS.length);
    expect(l.hidden).toEqual(['docs']);
  });

  it('matches the migration backfill mapping', () => {
    const l = layoutFromLegacyFlags({ ...ALL_ON, showProfileComments: false, showProfileEvents: false });
    expect(l.hidden).toEqual(['events', 'comments']);
  });

  it('all six legacy sections off hides the sections added since, too', () => {
    const allOff = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false])) as typeof ALL_ON;
    expect(layoutFromLegacyFlags(allOff).hidden).toEqual([...PROFILE_SECTIONS]);
  });
});

describe('resolveProfileTab', () => {
  it('only opens an allowed tab', () => {
    const allowed = ['overview', 'skills', 'docs'] as const;
    expect(resolveProfileTab('docs', allowed)).toBe('docs');
    expect(resolveProfileTab(['skills', 'docs'], allowed)).toBe('skills');
    expect(resolveProfileTab('workspace', allowed)).toBe('overview');
    expect(resolveProfileTab(undefined, allowed)).toBe('overview');
  });
});

describe('text fields', () => {
  it('headline is one line and capped by code points', () => {
    expect(sanitizeHeadline('  a\tb\nc  ')).toBe('a b c');
    expect(Array.from(sanitizeHeadline('𠀀'.repeat(HEADLINE_MAX + 5)))).toHaveLength(HEADLINE_MAX);
    expect(sliceCodePoints('😀😀😀', 2)).toBe('😀😀');
  });

  it('about keeps newlines but drops other control characters', () => {
    expect(sanitizeAbout('line1\r\nline2\u0000\u0007')).toBe('line1\nline2');
    expect(sanitizeAbout(42)).toBe('');
  });

  it('interests dedupe case-insensitively, strip #, cap count and length', () => {
    expect(sanitizeInterests(['#RAG', 'rag', ' Agents ', '', 7])).toEqual(['RAG', 'Agents']);
    expect(sanitizeInterests(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(MAX_INTERESTS);
    expect(Array.from(sanitizeInterests(['x'.repeat(50)])[0])).toHaveLength(INTEREST_MAX);
  });
});

describe('links', () => {
  it('keeps plain http(s) links and defaults the label to the host', () => {
    expect(sanitizeProfileLink({ url: 'https://github.com/me', label: '' })).toEqual({
      label: 'github.com',
      url: 'https://github.com/me',
    });
  });

  it('rejects anything that is not a clean absolute http(s) URL', () => {
    for (const url of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,x',
      '//evil.example',
      'https://user:pw@host.com',
      'https://host.com/a b',
      'https://host.com/"onmouseover=',
      'https://host.com/\tx',
      'ftp://host.com',
      '',
    ]) {
      expect(sanitizeProfileLink({ url, label: 'x' }), url).toBeNull();
    }
  });

  it('dedupes by url and caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://a.com/${i}`, label: `l${i}` }));
    expect(sanitizeProfileLinks([...many, many[0]])).toHaveLength(MAX_LINKS);
    expect(sanitizeProfileLinks('nope')).toEqual([]);
  });
});

describe('pins', () => {
  it('sanitizes kind and id shape, dedupes and caps', () => {
    expect(
      sanitizePins([
        { kind: 'skill', id: 'abc' },
        { kind: 'skill', id: 'abc' },
        { kind: 'nope', id: 'abc' },
        { kind: 'doc', id: '../etc' },
      ]),
    ).toEqual([{ kind: 'skill', id: 'abc' }]);
    const many = Array.from({ length: 10 }, (_, i) => ({ kind: 'post', id: `p${i}` }));
    expect(sanitizePins(many)).toHaveLength(MAX_PINS);
  });

  it('toggle is idempotent and refuses to overflow', () => {
    const full = Array.from({ length: MAX_PINS }, (_, i) => ({ kind: 'post' as const, id: `p${i}` }));
    expect(togglePin(full, { kind: 'post', id: 'p0' }, true)).toEqual({ pins: full, error: null });
    expect(togglePin(full, { kind: 'post', id: 'new' }, true).error).toBe('pins_full');
    expect(togglePin(full, { kind: 'post', id: 'p0' }, false).pins).toHaveLength(MAX_PINS - 1);
  });
});

describe('card config', () => {
  it('garbage gives the default', () => {
    expect(parseCardConfig(null)).toEqual({ ...DEFAULT_CARD_CONFIG });
    expect(parseCardConfig('holo')).toEqual({ ...DEFAULT_CARD_CONFIG });
  });

  it('validates every field independently', () => {
    const c = parseCardConfig({
      style: 'reflective',
      theme: '#ABCDEF',
      status: 'x'.repeat(100),
      pattern: 'bogus',
      mediaPos: '30% 120%',
      blur: 999,
      grayscale: '40',
      showStats: 'yes',
      tilt: false,
    });
    expect(c.style).toBe('reflective');
    expect(c.theme).toBe('#abcdef');
    expect(c.status.length).toBeLessThanOrEqual(32);
    expect(c.pattern).toBe(DEFAULT_CARD_CONFIG.pattern);
    expect(c.mediaPos).toBe('');
    expect(c.blur).toBe(CARD_BLUR_MAX);
    expect(c.grayscale).toBe(40);
    expect(c.showStats).toBe(DEFAULT_CARD_CONFIG.showStats);
    expect(c.tilt).toBe(false);
  });

  it('never lets raw CSS through the colour or position', () => {
    expect(normalizeHexColor('red; background:url(x)')).toBeNull();
    expect(normalizeHexColor('fff')).toBeNull();
    expect(parseMediaPos('50% 50%; x')).toBe('');
    expect(parseMediaPos('0% 100%')).toBe('0% 100%');
  });

  it('palette output is built from numbers only', () => {
    const p = cardPalette('#3e63a8');
    expect(p.base).toBe('#3e63a8');
    for (const v of [p.glow, p.innerGradient, p.overlay, p.emptyGradient]) {
      expect(v).toMatch(/^[a-z0-9(),.%# -]+$/i);
    }
    expect(cardPalette('garbage').base).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('media keys', () => {
  it('accepts only the four namespaces with matching extensions', () => {
    expect(isValidProfileMediaKey('image/abcdEFGH12.webp', 'image')).toBe(true);
    expect(isValidProfileMediaKey('video/abcdEFGH12.mp4', 'video')).toBe(true);
    expect(isValidProfileMediaKey('loop/abcdEFGH12.mp4')).toBe(true);
    expect(isValidProfileMediaKey('poster/abcdEFGH12.jpg')).toBe(true);
    expect(isValidProfileMediaKey('image/abcdEFGH12.mp4')).toBe(false);
    expect(isValidProfileMediaKey('video/abcdEFGH12.png')).toBe(false);
    expect(isValidProfileMediaKey('loop/abcdEFGH12.webm')).toBe(false);
    expect(isValidProfileMediaKey('image/abcdEFGH12.webp', 'video')).toBe(false);
    expect(isValidProfileMediaKey('images/abcdEFGH12.webp')).toBe(false);
    expect(isValidProfileMediaKey('image/../../etc.png')).toBe(false);
    expect(isValidProfileMediaKey('image/short.png')).toBe(false);
    expect(isValidProfileMediaKey(null)).toBe(false);
  });

  it('builds a root-relative URL', () => {
    expect(profileMediaUrl('image/abcdEFGH12.webp')).toBe('/api/profile/media/image/abcdEFGH12.webp');
  });
});
