import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV_MEGA, labHref } from '@/components/nav-mega-items';
import { INSTITUTES, INSTITUTE_TILE_MAX, instituteNames, labsOf } from '@/lib/org';
import { PRIMARY_NAV } from '@/components/nav-items';
import { CLIENT_MESSAGE_NAMESPACES } from '@/lib/i18n-client-namespaces';

// The navbar hover panel is a CURATED list, not a mirror of every taxonomy.
// The first cut listed skill sources, doc types, forum categories and event
// kinds; the owner rejected it as 「太冗余」 (2026-09-02) because those chips are
// already on the page one click away. These tests pin the small shape so a
// future "just one more link" cannot quietly grow it back into a sitemap.

const LOCALES = ['zh-CN', 'en', 'fr'] as const;

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(__dirname, '..', 'messages', `${locale}.json`), 'utf8'));
}

/** Resolves "labels:docType.book" the way NavMegaPanel's useLabel() does. */
function lookup(cat: Record<string, unknown>, spec: string): unknown {
  const i = spec.indexOf(':');
  const ns = spec.slice(0, i);
  const path = spec.slice(i + 1).split('.');
  let node: unknown = cat[ns];
  for (const seg of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

function allLinks() {
  return Object.entries(NAV_MEGA).flatMap(([section, menu]) =>
    menu.columns.flatMap((c) => c.links.map((l) => ({ section, ...l }))),
  );
}

function labelSpecs(): string[] {
  const out: string[] = [];
  for (const menu of Object.values(NAV_MEGA)) {
    for (const col of menu.columns) {
      if (col.t) out.push(col.t);
      for (const l of col.links) out.push(l.t);
    }
  }
  return out;
}

describe('NAV_MEGA is a small curated menu', () => {
  it('only keys sections that are actually in the nav row', () => {
    const primary = new Set(PRIMARY_NAV.map((i) => i.href));
    for (const href of Object.keys(NAV_MEGA)) expect(primary.has(href), href).toBe(true);
  });

  it('leaves 技能 / 知识库 / 活动 with no panel at all', () => {
    // Owner decision: these three sections behave as plain links. `useNavMega`
    // bails on an href it cannot find, so absence here IS the feature.
    for (const href of ['/skills', '/library', '/events']) {
      expect(NAV_MEGA[href], `${href} must have no hover panel`).toBeUndefined();
    }
    expect(Object.keys(NAV_MEGA).sort()).toEqual(['/discussion', '/videos', '/zones']);
  });

  it("stays small — a panel lists a section's real halves, not its filters", () => {
    expect(allLinks().length).toBeLessThanOrEqual(8);
    for (const menu of Object.values(NAV_MEGA)) {
      expect(menu.columns.length).toBeLessThanOrEqual(1);
      for (const col of menu.columns) expect(col.links.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('hrefs match the pages that read them', () => {
  it('videos: bare /videos is the Geek Videos tab and carries no tab param', () => {
    const links = NAV_MEGA['/videos'];
    expect(links.kind).toBe('links');
    expect(links.columns[0].links.map((l) => l.href)).toEqual(['/videos', '/videos?tab=shorts']);
  });

  it('videos: the shorts link carries none of the params that beat ?tab', () => {
    // app/videos/page.tsx: `isBrowse` (q/category/sort/page) short-circuits
    // BEFORE the `tab === 'shorts'` branch, so any of them silently wins.
    const href = NAV_MEGA['/videos'].columns[0].links[1].href;
    const params = new URL(href, 'http://x').searchParams;
    expect(params.get('tab')).toBe('shorts');
    for (const k of ['q', 'category', 'sort', 'page']) expect(params.has(k)).toBe(false);
  });

  it('discussion: exactly the two tabs DiscussionTabs renders', () => {
    const menu = NAV_MEGA['/discussion'];
    expect(menu.columns[0].links.map((l) => l.href)).toEqual(['/discussion', '/discussion?tab=forum']);
    // 动态 is the DEFAULT tab; its canonical URL has no `tab` at all, which is
    // what `DiscussionTabs.select('posts')` produces (`sp.delete('tab')`).
    expect(new URL('/discussion', 'http://x').searchParams.has('tab')).toBe(false);
  });

  it("discussion: reuses the destination page's own tab strings", () => {
    const specs = NAV_MEGA['/discussion'].columns[0].links.map((l) => l.t);
    expect(specs).toEqual(['discussion:tab_posts', 'discussion:tab_forum']);
  });

  it("zones: the 研究所 grid, plus the hub's own tabs", () => {
    expect(NAV_MEGA['/zones'].kind).toBe('labs');
    expect(NAV_MEGA['/zones'].columns[0].links.map((l) => l.href)).toEqual([
      '/zones',
      '/zones?tab=boards',
      '/zones?tab=mine',
    ]);
  });

  it('labHref encodes the lab once, as a single comma-joinable param', () => {
    expect(labHref('计算视觉研究所')).toBe(
      `/zones?tab=boards&lab=${encodeURIComponent('计算视觉研究所')}`,
    );
    // `firstParam` keeps only the first value of a repeated key, so the href
    // must never repeat `lab`.
    const params = new URL(labHref('A&B'), 'http://x').searchParams;
    expect(params.getAll('lab')).toEqual(['A&B']);
  });
});

describe('every label resolves in all three locales', () => {
  const cats = Object.fromEntries(LOCALES.map((l) => [l, messages(l)]));

  it('has a string for each `<ns>:<key>` spec', () => {
    for (const spec of labelSpecs()) {
      for (const locale of LOCALES) {
        expect(typeof lookup(cats[locale], spec), `${locale} ${spec}`).toBe('string');
      }
    }
  });

  it('only names namespaces that reach the client bundle', () => {
    // A namespace outside CLIENT_MESSAGE_NAMESPACES renders as a raw key path
    // in the browser instead of throwing, so nothing else would catch this.
    for (const spec of labelSpecs()) {
      const ns = spec.slice(0, spec.indexOf(':'));
      expect(CLIENT_MESSAGE_NAMESPACES as readonly string[], spec).toContain(ns);
    }
  });

  it('leaves no orphan nav.mega_* keys behind', () => {
    const src =
      readFileSync(resolve(__dirname, '..', 'components', 'nav-mega-items.ts'), 'utf8') +
      readFileSync(resolve(__dirname, '..', 'components', 'NavMegaPanel.tsx'), 'utf8');
    const nav = (cats['zh-CN'].nav ?? {}) as Record<string, string>;
    const orphans = Object.keys(nav).filter((k) => k.startsWith('mega_') && !src.includes(k));
    expect(orphans, `nav.mega_* keys with no reader: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('the 研究所 grid answers 「这里我在哪里填一下」', () => {
  it('takes its list from lib/org.ts, not a second copy in lib/zones/labs.ts', async () => {
    // The tile list USED to live in lib/zones/labs.ts as `CURATED_LABS` — a
    // second source of truth for the same six 研究所, free to disagree with the
    // hub rail and the create form. It now defers to `INSTITUTES`.
    vi.doMock('@/lib/db', () => ({ prisma: {} }));
    const labs = await import('@/lib/zones/labs');
    expect('CURATED_LABS' in labs, 'CURATED_LABS must not come back').toBe(false);
    expect(labs.LAB_TILE_MAX).toBe(INSTITUTE_TILE_MAX);
    expect(INSTITUTES.length).toBeLessThanOrEqual(INSTITUTE_TILE_MAX);
  });

  it('ships six 研究所, unique and trimmed, each with its 实验室', () => {
    expect(INSTITUTES.length).toBe(6);
    const names = instituteNames();
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toBe(n.trim()); // a stray space is a different `Zone.lab` bucket
      expect(n.length).toBeGreaterThan(0);
    }
    for (const inst of INSTITUTES) {
      if (inst.image) expect(inst.image.startsWith('/labs/'), inst.image).toBe(true);
      for (const lab of inst.labs) expect(lab).toBe(lab.trim());
      expect(labsOf(inst.name)).toEqual(inst.labs);
    }
  });

  it('the panel reserves exactly one skeleton per configured 研究所', () => {
    // NavMegaPanel cannot import lib/zones/labs.ts (Prisma), so it reads the cap
    // from lib/org.ts instead of hard-coding 6. Pin that it still does.
    const src = readFileSync(resolve(__dirname, '..', 'components', 'NavMegaPanel.tsx'), 'utf8');
    expect(src).toContain('const LAB_SKELETONS = INSTITUTE_TILE_MAX;');
    // lib/zones/labs.ts may only be reached for its TYPE (erased at build) —
    // a value import would pull Prisma into the client bundle.
    for (const line of src.split('\n').filter((l) => l.includes("from '@/lib/zones/labs'"))) {
      expect(line.trim().startsWith('import type '), line).toBe(true);
    }
  });
});
