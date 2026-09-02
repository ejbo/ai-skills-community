// `link` is the one embed kind whose resolution leaves the box. Server-side
// pre-resolution of a body must therefore (a) answer every CACHED url from one
// batched read, (b) start at most MAX_LIVE_LINK_FETCHES_PER_PASS live fetches
// per pass, together, and (c) leave the rest OUT of the result so the card
// fetches them through the budgeted route. Pinned with an in-memory cache
// table and a controllable getLinkPreview.
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePreviewUrl } from '@/lib/zones/og-parse';
import type { EmbedRef } from '@/lib/zones/shared';
import type { EmbedLinkData } from '@/lib/zones/types';

type Row = { urlHash: string; url: string; title: string; description: string; imageUrl: string | null; siteName: string; ok: boolean };

const db = vi.hoisted(() => {
  const state: { rows: Row[]; fail: boolean } = { rows: [], fail: false };
  return {
    state,
    zoneLinkPreview: {
      findMany: vi.fn(async ({ where }: { where: { urlHash: { in: string[] } } }) => {
        if (state.fail) throw new Error('db down');
        return state.rows.filter((r) => where.urlHash.in.includes(r.urlHash));
      }),
    },
  };
});

const preview = vi.hoisted(() => {
  const pending = new Map<string, (data: EmbedLinkData) => void>();
  return {
    pending,
    getLinkPreview: vi.fn(
      (url: string) =>
        new Promise<EmbedLinkData>((resolve) => {
          pending.set(url, resolve);
        }),
    ),
    // Same hash as link-preview.ts — the resolver imports the real function, the
    // test only needs the fake table keyed the same way.
    linkPreviewHash: (normalized: string) => createHash('sha256').update(normalized).digest('hex'),
  };
});

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/zones/link-preview', () => ({ getLinkPreview: preview.getLinkPreview, linkPreviewHash: preview.linkPreviewHash }));
vi.mock('@/lib/zones/access', () => ({ ZONE_ACCESS_SELECT: {}, resolveZoneAccess: vi.fn() }));
vi.mock('@/lib/zones/post-queries', () => ({
  ZONE_POST_ACCESS_SELECT: {},
  canSeeZonePost: vi.fn(),
  readableZoneWhere: vi.fn(() => ({})),
  zonePostVisibilityWhere: vi.fn(() => ({})),
  toAttachmentView: vi.fn(),
}));
vi.mock('@/lib/event-queries', () => ({ eventViewerFromSession: vi.fn(), getEventDetail: vi.fn() }));
vi.mock('@/lib/library-queries', () => ({ BROWSABLE_DOC_WHERE: {}, canReadDoc: vi.fn(), libraryViewerFromSession: vi.fn() }));
vi.mock('@/lib/pack-queries', () => ({ INSTALLABLE_SKILL_WHERE: {} }));
vi.mock('@/lib/skill-queries', () => ({ DISCOVERABLE_SKILL_WHERE: {}, SKILL_CARD_SELECT: {} }));
vi.mock('@/lib/video/access', () => ({ canViewVideo: vi.fn(), videoActorFrom: vi.fn() }));
vi.mock('@/lib/video/queries', () => ({ VIDEO_DETAIL_INCLUDE: {} }));
vi.mock('@/lib/video/shorts-queries', () => ({ SHORT_FEED_SELECT: {}, annotateShortsViewer: vi.fn(), toShortView: vi.fn() }));

import { MAX_LIVE_LINK_FETCHES_PER_PASS, resolveEmbed, resolveEmbeds, type EmbedContext } from '@/lib/zones/embeds';

const N = MAX_LIVE_LINK_FETCHES_PER_PASS;
const url = (i: number) => `https://example.org/page/${i}`;
const link = (u: string): EmbedRef => ({ kind: 'link', ref: u });
const ctx: EmbedContext = { viewer: { id: 'member', siteAdmin: false, canSeeIdentity: false }, session: null };

function cachedRow(u: string, ok = true): Row {
  const normalized = normalizePreviewUrl(u)!;
  return {
    urlHash: preview.linkPreviewHash(normalized),
    url: normalized,
    title: ok ? `Title ${u}` : '',
    description: ok ? 'desc' : '',
    imageUrl: ok ? 'https://cdn.example.org/x.png' : null,
    siteName: ok ? 'Example' : '',
    ok,
  };
}

function settle(u: string, over: Partial<EmbedLinkData> = {}) {
  const resolve = preview.pending.get(u);
  if (!resolve) throw new Error(`no pending fetch for ${u}`);
  resolve({ url: u, hostname: 'example.org', title: `Live ${u}`, description: '', imageUrl: null, siteName: '', ...over });
  preview.pending.delete(u);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  db.state.rows = [];
  db.state.fail = false;
  preview.pending.clear();
  vi.clearAllMocks();
});

describe('resolveEmbeds — link pre-resolution budget', () => {
  it('answers cached urls from ONE batched read and never calls getLinkPreview for them', async () => {
    const urls = Array.from({ length: 50 }, (_, i) => url(i));
    db.state.rows = urls.map((u) => cachedRow(u));
    const out = await resolveEmbeds(urls.map(link), ctx);
    expect(Object.keys(out)).toHaveLength(50);
    expect(out[`link:${url(7)}`]).toEqual({
      kind: 'link',
      ref: url(7),
      ok: true,
      data: { url: url(7), hostname: 'example.org', title: `Title ${url(7)}`, description: 'desc', imageUrl: 'https://cdn.example.org/x.png', siteName: 'Example' },
    });
    expect(db.zoneLinkPreview.findMany).toHaveBeenCalledTimes(1);
    expect(db.zoneLinkPreview.findMany.mock.calls[0][0].where.urlHash.in).toHaveLength(50);
    expect(preview.getLinkPreview).not.toHaveBeenCalled();
  });

  it(`starts at most ${N} live fetches per pass, together, and leaves the rest to the card`, async () => {
    const urls = Array.from({ length: N + 3 }, (_, i) => url(i));
    const run = resolveEmbeds(urls.map(link), ctx);
    await tick();
    // all N launched before any answered (the cap IS the concurrency), in body order
    expect(preview.getLinkPreview).toHaveBeenCalledTimes(N);
    expect(preview.getLinkPreview.mock.calls.map((c) => c[0])).toEqual(urls.slice(0, N));
    for (const u of urls.slice(0, N)) settle(u);
    const out = await run;
    for (const u of urls.slice(0, N)) expect(out[`link:${u}`]).toMatchObject({ ok: true, data: { title: `Live ${u}` } });
    // deferred: NO entry at all (not a not_found placeholder) — ZoneMarkdown hands
    // an absent key to the card, which fetches through the budgeted route
    for (const u of urls.slice(N)) expect(u in out ? out[`link:${u}`] : undefined).toBeUndefined();
    expect(Object.keys(out)).toHaveLength(N);
    expect(preview.getLinkPreview).toHaveBeenCalledTimes(N);
  });

  it('cached urls do not spend the live budget; a failed cache row does', async () => {
    const cached = Array.from({ length: 20 }, (_, i) => url(100 + i));
    const failed = url(200);
    const fresh = Array.from({ length: N }, (_, i) => url(300 + i));
    db.state.rows = [...cached.map((u) => cachedRow(u)), cachedRow(failed, false)];
    const refs = [...cached, failed, ...fresh];
    const run = resolveEmbeds(refs.map(link), ctx);
    await tick();
    // the failed row took one slot, so the LAST fresh url is deferred
    expect(preview.getLinkPreview.mock.calls.map((c) => c[0])).toEqual([failed, ...fresh.slice(0, N - 1)]);
    for (const u of [failed, ...fresh.slice(0, N - 1)]) settle(u);
    const out = await run;
    expect(Object.keys(out)).toHaveLength(20 + N);
    expect(out[`link:${fresh[N - 1]}`]).toBeUndefined();
    for (const u of cached) expect(out[`link:${u}`]).toMatchObject({ ok: true });
  });

  it('a throwing fetch is `error`, a DB outage still resolves under the cap', async () => {
    preview.getLinkPreview.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const out = await resolveEmbeds([link(url(1))], ctx);
    expect(out[`link:${url(1)}`]).toEqual({ kind: 'link', ref: url(1), ok: false, reason: 'error' });

    vi.clearAllMocks();
    db.state.fail = true;
    db.state.rows = [cachedRow(url(2))];
    const run = resolveEmbeds([link(url(2)), link(url(3))], ctx);
    await tick();
    expect(preview.getLinkPreview).toHaveBeenCalledTimes(2);
    settle(url(2));
    settle(url(3));
    expect(Object.keys(await run)).toHaveLength(2);
  });

  it('a single ref (the route path) is never deferred, and an invalid url never queries', async () => {
    const run = resolveEmbed('link', url(9), ctx);
    await tick();
    settle(url(9));
    expect(await run).toMatchObject({ kind: 'link', ref: url(9), ok: true });

    vi.clearAllMocks();
    const bad = await resolveEmbeds([link('ftp://example.org/x')], ctx);
    expect(bad['link:ftp://example.org/x']).toMatchObject({ ok: false, reason: 'invalid' });
    expect(db.zoneLinkPreview.findMany).not.toHaveBeenCalled();
  });
});
