// `[embed:file:<ref>]` resolves by attachment ROW ID or by STORAGE KEY, both
// under the same post gate, and the answer is keyed by the ref form that was
// asked for. Pinned with an in-memory prisma + stubbed gates so the resolver's
// own branching (id/key split, empty-OR guard, per-row decision fan-out) is
// what runs — not the database.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbedRef } from '@/lib/zones/shared';

interface FakeAttachment {
  id: string;
  key: string;
  kind: 'image' | 'video' | 'file';
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  posterUrl: string | null;
  previewStatus: 'none' | 'pending' | 'ready' | 'failed' | 'unsupported';
  previewUrl: string | null;
  post: {
    id: string;
    zoneId: string;
    authorId: string;
    status: 'draft' | 'published';
    visibility: 'zone' | 'members' | 'restricted';
    deletedAt: Date | null;
    zone: { id: string; slug: string; visibility: 'public' | 'members'; deletedAt: Date | null };
  };
}

const db = vi.hoisted(() => {
  const state: { rows: FakeAttachment[] } = { rows: [] };
  return {
    state,
    zonePostAttachment: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ id?: { in: string[] }; key?: { in: string[] } }>; post: { deletedAt: null } } }) => {
        const ids = new Set(where.OR.flatMap((c) => c.id?.in ?? []));
        const keys = new Set(where.OR.flatMap((c) => c.key?.in ?? []));
        return state.rows
          .filter((r) => r.post.deletedAt === null && (ids.has(r.id) || keys.has(r.key)))
          .map((r) => ({ ...r, post: { ...r.post, zone: { ...r.post.zone } } }));
      }),
    },
  };
});

const gates = vi.hoisted(() => ({
  // The zone gate: public zones read for everyone, members-only zones only for `member`.
  resolveZoneAccess: vi.fn(async (zone: { visibility: string }, viewer: { id: string | null; siteAdmin: boolean }) => ({
    canRead: viewer.siteAdmin || zone.visibility === 'public' || viewer.id === 'member',
  })),
  // The post gate mirrors what the real one does with the pre-decided access object.
  canSeeZonePost: vi.fn(async (_post: unknown, access: { canRead: boolean }) => access.canRead),
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/zones/access', () => ({
  ZONE_ACCESS_SELECT: {},
  resolveZoneAccess: gates.resolveZoneAccess,
}));
vi.mock('@/lib/zones/post-queries', () => ({
  ZONE_POST_ACCESS_SELECT: {},
  canSeeZonePost: gates.canSeeZonePost,
  readableZoneWhere: vi.fn(() => ({})),
  zonePostVisibilityWhere: vi.fn(() => ({})),
  // Shape-faithful subset of the real mapper (the test asserts on id/url/name only).
  toAttachmentView: (row: FakeAttachment) => ({
    id: row.id,
    kind: row.kind,
    url: row.url,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    posterUrl: row.posterUrl,
    ext: '',
    previewStatus: row.previewStatus,
    previewUrl: row.previewStatus === 'ready' ? row.previewUrl : null,
  }),
}));
// The other kinds' resolvers are never reached by a `file` ref; their modules
// pull in env/prisma at import time, so stub them rather than load them.
vi.mock('@/lib/event-queries', () => ({ eventViewerFromSession: vi.fn(), getEventDetail: vi.fn() }));
vi.mock('@/lib/library-queries', () => ({ BROWSABLE_DOC_WHERE: {}, canReadDoc: vi.fn(), libraryViewerFromSession: vi.fn() }));
vi.mock('@/lib/pack-queries', () => ({ INSTALLABLE_SKILL_WHERE: {} }));
vi.mock('@/lib/skill-queries', () => ({ DISCOVERABLE_SKILL_WHERE: {}, SKILL_CARD_SELECT: {} }));
vi.mock('@/lib/video/access', () => ({ canViewVideo: vi.fn(), videoActorFrom: vi.fn() }));
vi.mock('@/lib/video/queries', () => ({ VIDEO_DETAIL_INCLUDE: {} }));
vi.mock('@/lib/video/shorts-queries', () => ({ SHORT_FEED_SELECT: {}, annotateShortsViewer: vi.fn(), toShortView: vi.fn() }));
vi.mock('@/lib/zones/link-preview', () => ({ getLinkPreview: vi.fn() }));

import { resolveEmbeds, type EmbedContext } from '@/lib/zones/embeds';

const KEY = 'file/V1StGXR8_Z5jdHi6B-myT.pdf';
const IMAGE_KEY = 'image/abc123_xyz.png';

function row(over: Partial<FakeAttachment> & { id: string; key: string }): FakeAttachment {
  return {
    kind: 'file',
    url: `/api/zones/media/${over.key}`,
    name: 'Report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1234,
    width: null,
    height: null,
    posterUrl: null,
    previewStatus: 'none',
    previewUrl: null,
    post: {
      id: 'post1',
      zoneId: 'zone1',
      authorId: 'author',
      status: 'published',
      visibility: 'zone',
      deletedAt: null,
      zone: { id: 'zone1', slug: 'edge-inference', visibility: 'public', deletedAt: null },
    },
    ...over,
  };
}

function ctx(id: string | null, siteAdmin = false): EmbedContext {
  return { viewer: { id, siteAdmin, canSeeIdentity: false }, session: null };
}

const file = (ref: string): EmbedRef => ({ kind: 'file', ref });

beforeEach(() => {
  db.state.rows = [];
  vi.clearAllMocks();
});

describe('resolveEmbeds — file refs by id or storage key', () => {
  it('resolves both forms of one row, each answer keyed by the ref that asked', async () => {
    db.state.rows.push(row({ id: 'row1', key: KEY }));
    const out = await resolveEmbeds([file(KEY), file('row1')], ctx('member'));

    expect(out[`file:${KEY}`]).toMatchObject({ kind: 'file', ref: KEY, ok: true, data: { id: 'row1', url: `/api/zones/media/${KEY}`, postId: 'post1', zoneSlug: 'edge-inference' } });
    expect(out['file:row1']).toMatchObject({ kind: 'file', ref: 'row1', ok: true, data: { id: 'row1' } });
    // one query, one gate decision per ROW — the fan-out to ref forms is free
    expect(db.zonePostAttachment.findMany).toHaveBeenCalledTimes(1);
    expect(gates.canSeeZonePost).toHaveBeenCalledTimes(1);
  });

  it('splits ids and keys into separate IN clauses and never sends an empty one', async () => {
    db.state.rows.push(row({ id: 'row1', key: KEY }));
    await resolveEmbeds([file(KEY)], ctx('member'));
    const onlyKeys = db.zonePostAttachment.findMany.mock.calls[0][0].where;
    expect(onlyKeys.OR).toEqual([{ key: { in: [KEY] } }]);
    expect(onlyKeys.post).toEqual({ deletedAt: null });

    vi.clearAllMocks();
    await resolveEmbeds([file('row1')], ctx('member'));
    expect(db.zonePostAttachment.findMany.mock.calls[0][0].where.OR).toEqual([{ id: { in: ['row1'] } }]);

    vi.clearAllMocks();
    await resolveEmbeds([file('row1'), file(IMAGE_KEY)], ctx('member'));
    expect(db.zonePostAttachment.findMany.mock.calls[0][0].where.OR).toEqual([{ id: { in: ['row1'] } }, { key: { in: [IMAGE_KEY] } }]);
  });

  it('a forbidden viewer gets `forbidden` for the key form exactly like the id form', async () => {
    db.state.rows.push(
      row({ id: 'row1', key: KEY, post: { ...row({ id: 'x', key: 'file/x.pdf' }).post, zone: { id: 'zone2', slug: 'private-lab', visibility: 'members', deletedAt: null } } }),
    );
    const out = await resolveEmbeds([file(KEY), file('row1')], ctx('outsider'));
    expect(out[`file:${KEY}`]).toEqual({ kind: 'file', ref: KEY, ok: false, reason: 'forbidden' });
    expect(out['file:row1']).toEqual({ kind: 'file', ref: 'row1', ok: false, reason: 'forbidden' });

    const member = await resolveEmbeds([file(KEY)], ctx('member'));
    expect(member[`file:${KEY}`]).toMatchObject({ ok: true, data: { id: 'row1' } });
  });

  it('an unknown key or id is `not_found`; a malformed file ref is `invalid` and never queried', async () => {
    db.state.rows.push(row({ id: 'row1', key: KEY }));
    const out = await resolveEmbeds([file('file/nope_missing.pdf'), file('row9'), file('cover/x.jpg'), file('file/x')], ctx('member'));
    expect(out['file:file/nope_missing.pdf']).toEqual({ kind: 'file', ref: 'file/nope_missing.pdf', ok: false, reason: 'not_found' });
    expect(out['file:row9']).toEqual({ kind: 'file', ref: 'row9', ok: false, reason: 'not_found' });
    expect(out['file:cover/x.jpg']).toEqual({ kind: 'file', ref: 'cover/x.jpg', ok: false, reason: 'invalid' });
    expect(out['file:file/x']).toEqual({ kind: 'file', ref: 'file/x', ok: false, reason: 'invalid' });

    vi.clearAllMocks();
    const none = await resolveEmbeds([file('cover/x.jpg')], ctx('member'));
    expect(none['file:cover/x.jpg']).toMatchObject({ ok: false, reason: 'invalid' });
    expect(db.zonePostAttachment.findMany).not.toHaveBeenCalled();
  });

  it('a soft-deleted post hides its attachments under both ref forms', async () => {
    db.state.rows.push(row({ id: 'row1', key: KEY, post: { ...row({ id: 'x', key: 'file/x.pdf' }).post, deletedAt: new Date() } }));
    const out = await resolveEmbeds([file(KEY), file('row1')], ctx('member', true));
    expect(out[`file:${KEY}`]).toMatchObject({ ok: false, reason: 'not_found' });
    expect(out['file:row1']).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('a deleted zone only answers to a site admin', async () => {
    const dead = row({ id: 'row1', key: KEY });
    dead.post.zone.deletedAt = new Date();
    db.state.rows.push(dead);
    expect((await resolveEmbeds([file(KEY)], ctx('member')))[`file:${KEY}`]).toMatchObject({ ok: false, reason: 'not_found' });
    expect((await resolveEmbeds([file(KEY)], ctx('admin', true)))[`file:${KEY}`]).toMatchObject({ ok: true, data: { id: 'row1' } });
  });

  it('decides zone access once per zone even when many rows of it are asked for', async () => {
    db.state.rows.push(row({ id: 'row1', key: KEY }), row({ id: 'row2', key: IMAGE_KEY, kind: 'image' }));
    const out = await resolveEmbeds([file(KEY), file(IMAGE_KEY), file('row1'), file('row2')], ctx('member'));
    expect(Object.values(out).every((e) => e.ok)).toBe(true);
    expect(gates.resolveZoneAccess).toHaveBeenCalledTimes(1);
    expect(gates.canSeeZonePost).toHaveBeenCalledTimes(2);
  });
});
