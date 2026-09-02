// The body-key union is a SECURITY boundary as much as a convenience: a
// `[embed:file:<storage key>]` token pasted into a body must never let a post
// claim a file another post owns (keys are visible in every download URL), and
// it must never fail the whole save either — the token simply stays a
// reference that renders under the embed gate. The explicit ledger stays
// strict. Pinned with an in-memory prisma + a stubbed disk.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_ROWS_PER_POST, ZONE_MEDIA_KEY_RE } from '@/lib/zones/shared';
import { ZoneError } from '@/lib/zones/errors';

const db = vi.hoisted(() => {
  const state: { rows: { key: string; postId: string }[]; post: Record<string, unknown> | null } = { rows: [], post: null };
  return {
    state,
    zonePost: {
      findUnique: vi.fn(async () => state.post),
    },
    zonePostAttachment: {
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] }; postId?: { not: string } } }) =>
        state.rows
          .filter((r) => where.key.in.includes(r.key) && (!where.postId || r.postId !== where.postId.not))
          .map((r) => ({ key: r.key })),
      ),
      count: vi.fn(async ({ where }: { where: { key: { in: string[] }; postId?: { not: string } } }) =>
        state.rows.filter((r) => where.key.in.includes(r.key) && (!where.postId || r.postId !== where.postId.not)).length,
      ),
    },
  };
});

const disk = vi.hoisted(() => ({
  files: new Map<string, number>(), // key → size
  statZoneMediaAsync: vi.fn(async (key: string) => {
    const size = disk.files.get(key);
    return size === undefined ? null : { size, contentType: 'application/octet-stream' };
  }),
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/zones/storage', () => ({
  statZoneMediaAsync: disk.statZoneMediaAsync,
  isValidZoneMediaKey: (key: string, kind?: string) => ZONE_MEDIA_KEY_RE.test(key) && (!kind || key.startsWith(`${kind}/`)),
  zoneMediaPublicUrl: (key: string) => `/api/zones/media/${key}`,
  zoneMediaKeyFromUrl: () => null,
  deleteZoneMediaFile: vi.fn(),
}));
// Neighbours post-queries pulls in at import time but this path never reaches.
vi.mock('@/lib/zones/columns', () => ({ getOrCreateColumn: vi.fn(), recountZoneColumns: vi.fn() }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn() }));
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
vi.mock('@/lib/zones/queries', () => ({ readableZoneWhere: vi.fn(() => ({})), zoneOrgTree: vi.fn() }));

import { resolvePostAttachments, updateZonePost } from '@/lib/zones/post-queries';

const A = 'file/V1StGXR8_Z5jdHi6B-myT.pdf';
const B = 'file/aFX-M3eTlAMBp4Rh7j0kX.md';
const IMG = 'image/NXTWcaU4d6EKJryOHdOSq.png';
const token = (key: string) => `[embed:file:${key}]`;
const ledger = (key: string, name = 'Given.pdf') => ({ key, name, mimeType: 'application/pdf', sizeBytes: 1 });

beforeEach(() => {
  db.state.rows = [];
  disk.files = new Map([
    [A, 1234],
    [B, 56],
    [IMG, 789],
  ]);
  vi.clearAllMocks();
});

describe('resolvePostAttachments — body keys are references, the ledger is a claim', () => {
  it('unions an unclaimed body key as a stub row: name from the key, size from disk', async () => {
    const out = await resolvePostAttachments([], `intro\n\n${token(A)}\n`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'file',
      key: A,
      url: `/api/zones/media/${A}`,
      name: 'V1StGXR8_Z5jdHi6B-myT.pdf',
      sizeBytes: 1234,
      previewStatus: 'none',
      sortOrder: 0,
      ext: 'pdf',
    });
  });

  it('DROPS a body key another post owns — the save succeeds without it', async () => {
    db.state.rows.push({ key: A, postId: 'other-post' });
    const out = await resolvePostAttachments([ledger(B)], `${token(A)}\n${token(B)}`);
    expect(out.map((a) => a.key)).toEqual([B]);
  });

  it('keeps a body key that already belongs to the post being edited', async () => {
    db.state.rows.push({ key: A, postId: 'this-post' });
    const out = await resolvePostAttachments([], token(A), { excludePostId: 'this-post' });
    expect(out.map((a) => a.key)).toEqual([A]);
    // …but the same key is foreign from any OTHER post's point of view
    expect(await resolvePostAttachments([], token(A), { excludePostId: 'another-post' })).toEqual([]);
  });

  it('drops a body key whose file is not on disk instead of failing the save', async () => {
    disk.files.delete(A);
    const out = await resolvePostAttachments([ledger(B)], `${token(A)}\n${token(B)}`);
    expect(out.map((a) => a.key)).toEqual([B]);
  });

  it('a body key the ledger already carries is neither duplicated nor re-checked', async () => {
    const out = await resolvePostAttachments([ledger(A, 'Report.pdf')], `${token(A)}\n${token(A)}`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: A, name: 'Report.pdf', sizeBytes: 1234 });
    expect(db.zonePostAttachment.findMany).not.toHaveBeenCalled();
  });

  it('row-id tokens never enter the union', async () => {
    const out = await resolvePostAttachments([], '[embed:file:clxyz123]');
    expect(out).toEqual([]);
    expect(db.zonePostAttachment.findMany).not.toHaveBeenCalled();
    expect(disk.statZoneMediaAsync).not.toHaveBeenCalled();
  });

  it('the LEDGER stays strict: a foreign or missing ledger row is attachments_invalid', async () => {
    db.state.rows.push({ key: A, postId: 'other-post' });
    await expect(resolvePostAttachments([ledger(A)], '')).rejects.toMatchObject({ code: 'attachments_invalid', status: 400 });
    disk.files.delete(B);
    await expect(resolvePostAttachments([ledger(B)], '')).rejects.toBeInstanceOf(ZoneError);
  });

  it('the row cap is re-checked AFTER the union under its own code', async () => {
    const many = Array.from({ length: MAX_ATTACHMENT_ROWS_PER_POST }, (_, i) => {
      const key = `file/ledger-${String(i).padStart(4, '0')}.pdf`;
      disk.files.set(key, 1);
      return ledger(key);
    });
    // the ledger alone is at the cap and resolves…
    expect(await resolvePostAttachments(many, '')).toHaveLength(MAX_ATTACHMENT_ROWS_PER_POST);
    // …one more key from the body tips it over — a distinct error, not "invalid"
    await expect(resolvePostAttachments(many, token(A))).rejects.toMatchObject({ code: 'attachments_too_many', status: 400 });
  });
});

describe('updateZonePost — the type gate has a lib-level backstop', () => {
  it('refuses a type change without canModerate before touching anything else', async () => {
    db.state.post = { id: 'p1', deletedAt: null, authorId: 'author', type: 'announcement', title: 'T', bodyMd: '', status: 'published', attachments: [], zone: {} };
    await expect(updateZonePost('p1', { type: 'article' }, { canModerate: false, actorId: 'author' })).rejects.toMatchObject({
      code: 'announcement_forbidden',
      status: 403,
    });
    await expect(updateZonePost('p1', { type: 'article' })).rejects.toMatchObject({ code: 'announcement_forbidden' });
    expect(db.zonePostAttachment.findMany).not.toHaveBeenCalled();
  });
});
