// 版块主页布局 contract (lib/zones/sidebar.ts): the ONE sanitizer both the renderer
// and the editor trust. Garbage degrades to the default; nothing built-in can
// ever vanish; 关于 can never be hidden; custom cards are capped.
import { describe, expect, it } from 'vitest';
import { RICH_TEXT_RAW_CEILING_FACTOR } from '@/lib/markdown-text';
import {
  DEFAULT_SIDEBAR_ORDER,
  MAX_SIDEBAR_CUSTOM_CARDS,
  SIDEBAR_CARD_BODY_MAX,
  SIDEBAR_CARD_TITLE_MAX,
  defaultSidebarLayout,
  isDefaultSidebarLayout,
  parseSidebarLayout,
  visibleSidebarModules,
} from '@/lib/zones/sidebar';

describe('parseSidebarLayout', () => {
  it('garbage (null, string, array, {}) → the default layout', () => {
    for (const raw of [null, undefined, 'x', 42, [], {}]) {
      const l = parseSidebarLayout(raw);
      expect(l).toEqual(defaultSidebarLayout());
      expect(isDefaultSidebarLayout(l)).toBe(true);
    }
  });

  it('drops unknown ids and appends every missing built-in in default order', () => {
    const l = parseSidebarLayout({ order: ['links', 'bogus', 'about', 'custom:nope'] });
    expect(l.order).toEqual(['links', 'about', 'pulse', 'rules', 'members', 'moderators']);
    expect(l.order).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });

  it('dedupes a repeated id in order', () => {
    const l = parseSidebarLayout({ order: ['rules', 'rules', 'rules'] });
    expect(l.order.filter((x) => x === 'rules')).toHaveLength(1);
  });

  it('`about` is never hidden; unknown / custom ids are not hideable', () => {
    const l = parseSidebarLayout({ hidden: ['about', 'pulse', 'custom:abcd1234', 'zzz', 'pulse'] });
    expect(l.hidden).toEqual(['pulse']);
  });

  it('custom cards: bad ids, duplicates and empty cards are dropped; text is trimmed, titles capped', () => {
    const long = 'x'.repeat(SIDEBAR_CARD_TITLE_MAX + 10);
    const body = `  ${'y'.repeat(SIDEBAR_CARD_BODY_MAX)}  `;
    const l = parseSidebarLayout({
      custom: [
        { id: 'custom:abcd1234', title: '  hello ', bodyMd: body },
        { id: 'custom:abcd1234', title: 'dup', bodyMd: '' },
        { id: 'custom:ABCD', title: 'bad id', bodyMd: 'x' },
        { id: 'nope', title: 'bad id', bodyMd: 'x' },
        { id: 'custom:empty000', title: '   ', bodyMd: '' },
        { id: 'custom:longtitle', title: long, bodyMd: '' },
      ],
    });
    expect(l.custom.map((c) => c.id)).toEqual(['custom:abcd1234', 'custom:longtitle']);
    expect(l.custom[0].title).toBe('hello');
    expect(l.custom[0].bodyMd).toBe(body.trim());
    expect(l.custom[1].title).toHaveLength(SIDEBAR_CARD_TITLE_MAX);
  });

  it('card bodies are measured by VISIBLE length and never cut into broken markup', () => {
    // 50 coloured 60-character phrases: 3000 visible, ~4500 raw — what the editor counter calls "3000 / 4000".
    const phrase = `<span data-color="red">${'字'.repeat(60)}</span>`;
    const formatted = phrase.repeat(50);
    expect(formatted.length).toBeGreaterThan(SIDEBAR_CARD_BODY_MAX);
    const kept = parseSidebarLayout({ custom: [{ id: 'custom:fmt00001', title: 't', bodyMd: formatted }] });
    expect(kept.custom[0].bodyMd).toBe(formatted);

    // A STORED card slightly over the cap keeps rendering whole (the editor's red counter asks for the trim;
    // the write schema is what refuses it) — it is never sliced mid-tag.
    const slightlyOver = `${formatted}${'y'.repeat(SIDEBAR_CARD_BODY_MAX)}`;
    const read = parseSidebarLayout({ custom: [{ id: 'custom:over0001', title: 't', bodyMd: slightlyOver }] });
    expect(read.custom[0].bodyMd).toBe(slightlyOver);

    // Past the raw ceiling nothing valid could have written it: the card is dropped whole.
    const garbage = parseSidebarLayout({
      custom: [
        { id: 'custom:huge0001', title: 'garbage', bodyMd: 'y'.repeat(SIDEBAR_CARD_BODY_MAX * RICH_TEXT_RAW_CEILING_FACTOR + 1) },
        { id: 'custom:fine0001', title: 'fine', bodyMd: 'ok' },
      ],
    });
    expect(garbage.custom.map((c) => c.id)).toEqual(['custom:fine0001']);
    expect(garbage.order).not.toContain('custom:huge0001');
  });

  it('caps custom cards at MAX_SIDEBAR_CUSTOM_CARDS and appends unlisted ones to order', () => {
    const custom = Array.from({ length: MAX_SIDEBAR_CUSTOM_CARDS + 3 }, (_, i) => ({
      id: `custom:card${String(i).padStart(4, '0')}`,
      title: `c${i}`,
      bodyMd: '',
    }));
    const l = parseSidebarLayout({ custom });
    expect(l.custom).toHaveLength(MAX_SIDEBAR_CUSTOM_CARDS);
    for (const c of l.custom) expect(l.order).toContain(c.id);
    // A card beyond the cap is not in `order` either.
    expect(l.order).not.toContain(custom[MAX_SIDEBAR_CUSTOM_CARDS].id);
  });

  it('a custom id listed in order but missing from custom is dropped from order', () => {
    const l = parseSidebarLayout({ order: ['custom:ghost001', 'about'] });
    expect(l.order[0]).toBe('about');
  });

  it('round-trips a valid layout unchanged', () => {
    const input = {
      order: ['about', 'custom:abcd1234', 'members', 'rules', 'pulse', 'moderators', 'links'],
      hidden: ['links'],
      custom: [{ id: 'custom:abcd1234', title: 'Start here', bodyMd: '- read the rules' }],
    };
    expect(parseSidebarLayout(input)).toEqual(input);
    expect(isDefaultSidebarLayout(parseSidebarLayout(input))).toBe(false);
  });
});

describe('visibleSidebarModules', () => {
  it('walks order, skips hidden built-ins, resolves custom cards', () => {
    const l = parseSidebarLayout({
      order: ['custom:abcd1234', 'about', 'links', 'members'],
      hidden: ['links', 'pulse'],
      custom: [{ id: 'custom:abcd1234', title: 'T', bodyMd: 'B' }],
    });
    const v = visibleSidebarModules(l);
    expect(v.map((m) => (m.kind === 'builtin' ? m.id : m.card.id))).toEqual([
      'custom:abcd1234',
      'about',
      'members',
      'rules',
      'moderators',
    ]);
    expect(v[0]).toEqual({ kind: 'custom', card: { id: 'custom:abcd1234', title: 'T', bodyMd: 'B' } });
  });

  it('the default layout shows every built-in in the fixed order', () => {
    expect(visibleSidebarModules(defaultSidebarLayout()).map((m) => (m.kind === 'builtin' ? m.id : ''))).toEqual([
      ...DEFAULT_SIDEBAR_ORDER,
    ]);
  });
});
