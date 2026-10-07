// 技术专区 — the edit ENTRY follows the same policy as the edit WRITE.
//
// The reading page and the composer page used to decide with
// `post.isAuthor || access.canModerate`, while PATCH uses
// `canEditZonePostContent`. They differ in exactly one case: a CO-author of a
// post in a 版块 they cannot read. That person saw 编辑, got the composer, and
// only learned on save that PATCH answers 403. Both pages now ask
// `canViewerEditZonePost`, which reads the ids the public view does not carry
// and feeds the REAL policy — pinned here, together with the composer page's
// redirect, so the entry and the write cannot drift apart again.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { row: null as { authorId: string; coauthors: { userId: string }[] } | null };
  const prisma = {
    // findFirst: the page resolves its [postId] param (slug or id) before the gate.
    zonePost: { findUnique: vi.fn(async () => state.row), findFirst: vi.fn(async () => ({ id: 'p1', slug: null })) },
    zonePostAuthor: { findMany: vi.fn(async () => []) },
    zonePostViewer: { findMany: vi.fn(async () => []) },
    zone: { findUnique: vi.fn(async () => ({ allowMemberColumns: true })) },
  };
  return { state, prisma };
});

const page = vi.hoisted(() => ({
  access: { viewerId: 'u' as string | null, canRead: true, canModerate: false, canSeeIdentity: false },
  // Every real ZonePostDetailView carries summary + bodyMd; the page reads both.
  post: { id: 'p1', isAuthor: true, visibility: 'zone', summary: '', bodyMd: '' },
}));

vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
// post-queries' own neighbours — the policy never reaches them.
vi.mock('@/lib/zones/queries', async () => ({ ZoneError: (await import('@/lib/zones/errors')).ZoneError }));
vi.mock('@/lib/zones/columns', () => ({ getOrCreateColumn: vi.fn(), recountZoneColumns: vi.fn(), listZoneColumns: vi.fn(async () => []) }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn() }));
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
vi.mock('@/lib/zones/storage', () => ({
  statZoneMediaAsync: vi.fn(async () => null),
  isValidZoneMediaKey: () => false,
  zoneMediaPublicUrl: (key: string) => `/api/zones/media/${key}`,
  zoneMediaKeyFromUrl: () => null,
  deleteZoneMediaFile: vi.fn(),
}));

// The composer page's collaborators.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'zh-CN'), getTranslations: vi.fn(async () => (k: string) => k) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u', handle: 'u', displayName: 'U', avatarUrl: null } })) }));
vi.mock('@/lib/zones/access', () => ({
  zoneSiteViewer: vi.fn(() => ({ id: 'u', siteAdmin: false, canSeeIdentity: false })),
  loadZoneBySlug: vi.fn(async () => ({ id: 'z1', slug: 'edge-inference', name: '边缘推理' })),
  resolveZoneAccess: vi.fn(async () => page.access),
}));
vi.mock('@/app/zones/_components/post/PostComposer', () => ({ PostComposer: () => null }));

import { canViewerEditZonePost } from '@/lib/zones/post-edit';
import { autoPostSummary } from '@/lib/zones/post-summary';

vi.mock('@/lib/zones/post-queries', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/zones/post-queries')>();
  return { ...real, getZonePostDetail: vi.fn(async () => page.post) };
});

const EditZonePostPage = (await import('@/app/zones/[slug]/posts/[postId]/edit/page')).default;

function access(over: Partial<{ viewerId: string | null; canRead: boolean; canModerate: boolean }> = {}) {
  return { viewerId: 'u', canRead: true, canModerate: false, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.state.row = { authorId: 'author', coauthors: [{ userId: 'coauthor' }] };
});

describe('canViewerEditZonePost — the policy PATCH enforces, for the edit entries', () => {
  it('never offers edit to an anonymous viewer, and costs no query', async () => {
    expect(await canViewerEditZonePost({ postId: 'p1', isAuthor: false, access: access({ viewerId: null }) })).toBe(false);
    expect(await canViewerEditZonePost({ postId: 'p1', isAuthor: true, access: access({ viewerId: null, canModerate: true }) })).toBe(false);
    expect(db.prisma.zonePost.findUnique).not.toHaveBeenCalled();
  });

  it('answers a plain reader (not an author, not a moderator) without touching the DB', async () => {
    expect(await canViewerEditZonePost({ postId: 'p1', isAuthor: false, access: access({ viewerId: 'reader' }) })).toBe(false);
    expect(db.prisma.zonePost.findUnique).not.toHaveBeenCalled();
  });

  it('lets the 主作者 edit even where the zone gate would refuse them', async () => {
    expect(await canViewerEditZonePost({ postId: 'p1', isAuthor: true, access: access({ viewerId: 'author', canRead: false }) })).toBe(true);
  });

  it('lets a co-author edit while they can read the zone', async () => {
    expect(await canViewerEditZonePost({ postId: 'p1', isAuthor: true, access: access({ viewerId: 'coauthor' }) })).toBe(true);
  });

  it('REFUSES a co-author who cannot read the zone — the case `isAuthor || canModerate` got wrong', async () => {
    expect(await canViewerEditZonePost({ postId: 'p1', isAuthor: true, access: access({ viewerId: 'coauthor', canRead: false }) })).toBe(false);
  });

  it('lets a moderator edit someone else’s post', async () => {
    expect(await canViewerEditZonePost({ postId: 'p1', isAuthor: false, access: access({ viewerId: 'mod', canModerate: true }) })).toBe(true);
  });

  it('refuses when the post row is gone', async () => {
    db.state.row = null;
    expect(await canViewerEditZonePost({ postId: 'p1', isAuthor: true, access: access({ viewerId: 'author' }) })).toBe(false);
  });

  it('reads only the ids the policy needs, by primary key', async () => {
    await canViewerEditZonePost({ postId: 'p1', isAuthor: true, access: access({ viewerId: 'author' }) });
    expect(db.prisma.zonePost.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { authorId: true, coauthors: { select: { userId: true } } },
    });
  });
});

describe('composer page (/zones/<slug>/posts/<id>/edit) — gated on the same policy', () => {
  const params = { slug: 'edge-inference', postId: 'p1' };

  it('sends a co-author who cannot read the zone back to the post instead of opening a composer that 403s', async () => {
    page.access = { viewerId: 'coauthor', canRead: false, canModerate: false, canSeeIdentity: false };
    await expect(EditZonePostPage({ params })).rejects.toThrow('NEXT_REDIRECT /zones/edge-inference/posts/p1');
  });

  it('opens the composer for the 主作者', async () => {
    page.access = { viewerId: 'author', canRead: true, canModerate: false, canSeeIdentity: false };
    await expect(EditZonePostPage({ params })).resolves.toBeTruthy();
  });

  it('opens the composer for a moderator who is not an author', async () => {
    page.post = { ...page.post, isAuthor: false };
    page.access = { viewerId: 'mod', canRead: true, canModerate: true, canSeeIdentity: false };
    await expect(EditZonePostPage({ params })).resolves.toBeTruthy();
    page.post = { ...page.post, isAuthor: true };
  });
});

describe('composer page — 摘要 input shows only a summary the author typed', () => {
  const params = { slug: 'edge-inference', postId: 'p1' };
  const body = 'Attachments below: text after attachments';

  // The page returns <div><PostComposer post=…/></div>; read the prop it hands down.
  async function composerSummary(): Promise<string> {
    const el = (await EditZonePostPage({ params })) as { props: { children: { props: { post: { summary: string } } } } };
    return el.props.children.props.post.summary;
  }

  beforeEach(() => {
    page.access = { viewerId: 'author', canRead: true, canModerate: false, canSeeIdentity: false };
  });

  it('hands an auto excerpt back as blank, so the next save does not freeze it as typed text', async () => {
    page.post = { ...page.post, bodyMd: body, summary: autoPostSummary(body) };
    expect(await composerSummary()).toBe('');
  });

  it('keeps a typed summary', async () => {
    page.post = { ...page.post, bodyMd: body, summary: 'Written by hand.' };
    expect(await composerSummary()).toBe('Written by hand.');
  });
});
