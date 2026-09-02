// `ZonePost.type` is hidden from every author-facing UI; the only writer left
// is the moderator's 设为公告 / 取消公告. The PATCH route must therefore gate
// EVERY change of `type` — into `announcement` and out of it — on canModerate,
// so an author cannot silently drop the zone notice a 版主 pinned on their
// post. Route handler run with its collaborators stubbed; the lib backstop is
// pinned in tests/zones-post-attachments.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Post = { id: string; zoneId: string; authorId: string; type: string; title: string; status: string; pinned: boolean; locked: boolean; deletedAt: Date | null; coauthors: { userId: string }[] };

const state = vi.hoisted(() => ({
  post: null as Post | null,
  access: { canModerate: false, canPost: true, canRead: true, siteAdmin: false, isMember: true },
  userId: 'author',
}));

const lib = vi.hoisted(() => ({
  updateZonePost: vi.fn(async () => undefined),
  setZonePostFlags: vi.fn(async () => undefined),
}));

vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'zh-CN') }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: state.userId } })) }));
vi.mock('@/lib/db', () => ({ prisma: { zonePost: { findUnique: vi.fn(async () => state.post) } } }));
vi.mock('@/lib/api-errors', () => ({ apiReason: vi.fn(async (key: string) => `reason:${key}`) }));
vi.mock('@/lib/audit', () => ({ logAdmin: vi.fn() }));
vi.mock('@/lib/zones/access', () => ({
  zoneContext: vi.fn(async () => ({ zone: { id: 'zone1', slug: 'edge-inference' }, access: state.access, viewer: { id: state.userId } })),
}));
vi.mock('@/lib/zones/queries', async () => ({ ZoneError: (await import('@/lib/zones/errors')).ZoneError }));
vi.mock('@/lib/zones/post-queries', () => ({
  MAX_DESIGNATED_VIEWERS: 50,
  getZonePostDetail: vi.fn(),
  softDeleteZonePost: vi.fn(),
  updateZonePost: lib.updateZonePost,
  setZonePostFlags: lib.setZonePostFlags,
}));

import { PATCH } from '@/app/api/zones/[slug]/posts/[postId]/route';

function post(over: Partial<Post> = {}): Post {
  return { id: 'p1', zoneId: 'zone1', authorId: 'author', type: 'article', title: 'T', status: 'published', pinned: false, locked: false, deletedAt: null, coauthors: [], ...over };
}

async function patch(body: Record<string, unknown>) {
  const req = new Request('http://localhost/api/zones/edge-inference/posts/p1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req, { params: { slug: 'edge-inference', postId: 'p1' } });
  return { status: res.status, body: (await res.json()) as { error?: string; reason?: string; ok?: boolean } };
}

beforeEach(() => {
  state.post = post();
  state.access = { canModerate: false, canPost: true, canRead: true, siteAdmin: false, isMember: true };
  state.userId = 'author';
  vi.clearAllMocks();
});

describe('PATCH /api/zones/[slug]/posts/[postId] — type changes are moderator-only', () => {
  it('an author cannot clear 公告 from their own post (out of announcement)', async () => {
    state.post = post({ type: 'announcement' });
    const r = await patch({ type: 'article' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'forbidden', reason: 'reason:zone_announcement_forbidden' });
    expect(lib.updateZonePost).not.toHaveBeenCalled();
  });

  it('…nor set it (into announcement), nor change the hidden type at all', async () => {
    expect((await patch({ type: 'announcement' })).body).toEqual({ error: 'forbidden', reason: 'reason:zone_announcement_forbidden' });
    const other = await patch({ type: 'report' });
    expect(other.status).toBe(403);
    expect(other.body).toEqual({ error: 'forbidden' });
    expect(lib.updateZonePost).not.toHaveBeenCalled();
  });

  it('a co-author is gated exactly like the author', async () => {
    state.userId = 'co';
    state.post = post({ type: 'announcement', coauthors: [{ userId: 'co' }] });
    expect((await patch({ type: 'article' })).status).toBe(403);
    expect((await patch({ title: 'Edited by co-author' })).status).toBe(200);
  });

  it('authors keep editing content; re-sending the unchanged type is a no-op, not a refusal', async () => {
    expect((await patch({ title: 'New title', bodyMd: 'x' })).body).toEqual({ ok: true });
    expect((await patch({ type: 'article', summary: 's' })).status).toBe(200);
    expect(lib.updateZonePost).toHaveBeenCalledTimes(2);
  });

  it('a moderator may move the type in both directions', async () => {
    state.access.canModerate = true;
    state.userId = 'mod';
    state.post = post({ type: 'announcement' });
    expect((await patch({ type: 'article' })).body).toEqual({ ok: true });
    state.post = post({ type: 'article' });
    expect((await patch({ type: 'announcement' })).body).toEqual({ ok: true });
    expect(lib.updateZonePost).toHaveBeenLastCalledWith('p1', { type: 'announcement' }, { canModerate: true, actorId: 'mod' });
  });

  it('publishing a draft that is already an announcement still needs moderate', async () => {
    state.post = post({ type: 'announcement', status: 'draft' });
    const r = await patch({ status: 'published' });
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe('reason:zone_announcement_forbidden');
  });
});
