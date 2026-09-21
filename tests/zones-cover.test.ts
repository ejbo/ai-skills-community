// 帖子封面的版式 + 裁切 (lib/zones/post-cover.ts, on top of the shared cover
// contract in lib/media/cover-pos.ts). Three things are pinned here because each
// one is a way this feature goes wrong quietly:
//   1. a LOCKED stub ships no framing — 'portrait' next to `coverUrl: null` would
//      still tell a viewer who may not read the post that it has a cover;
//   2. a NEW image never inherits the old image's crop, and removing the cover
//      resets both columns whatever the client sent;
//   3. both routes accept exactly the contract's closed value sets — `coverPos`
//      reaches a style attribute, so "close enough" strings are a 400, not a fix.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POST_COVER_FRAMING,
  initialCoverFraming,
  nextCoverFraming,
  parseCoverFramingInput,
  zonePostCoverFraming,
} from '@/lib/zones/post-cover';
import { defaultCoverFor, postCoverRatio } from '@/lib/media/cover-pos';
import { ZONE_MEDIA_KEY_RE } from '@/lib/zones/shared';

// An in-memory prisma just deep enough for createZonePost / updateZonePost to run
// their transaction (same shape as tests/zones-coauthor-notify.test.ts): what the
// write paths hand to `zonePost.create` / `zonePost.update` is the thing under test.
const db = vi.hoisted(() => {
  const state = { existing: null as Record<string, unknown> | null };
  const tx = {
    zonePost: {
      create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 'new-post', attachments: [] as unknown[] })),
      update: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    zonePostAuthor: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    zonePostViewer: { createMany: vi.fn(async () => ({ count: 0 })), deleteMany: vi.fn(async () => ({ count: 0 })) },
    zonePostAttachment: { deleteMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    zone: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    user: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => ({ id: 'author', handle: 'author', displayName: '张三' })) },
    zoneMember: { findMany: vi.fn(async () => []) },
    zoneRole: { findUnique: vi.fn(async () => ({ permissions: ['comment'] })) },
    zonePostViewer: { findMany: vi.fn(async () => []) },
    zonePost: { findUnique: vi.fn(async () => state.existing), count: vi.fn(async () => 1) },
    zone: { count: vi.fn(async () => 0) },
    zonePostAttachment: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { state, tx, prisma };
});

vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/lib/notifications', () => ({ notifyCoauthor: vi.fn(), notifyMention: vi.fn() }));
// lib/mention-notify → lib/video/access → lib/auth, which validates the whole env.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/zones/storage', () => ({
  // Every well-formed key is "on disk" — cover validation itself is not under test.
  statZoneMediaAsync: vi.fn(async () => ({ size: 1, contentType: 'image/png' })),
  isValidZoneMediaKey: (key: string, kind?: string) => ZONE_MEDIA_KEY_RE.test(key) && (!kind || key.startsWith(`${kind}/`)),
  zoneMediaPublicUrl: (key: string) => `/api/zones/media/${key}`,
  zoneMediaKeyFromUrl: () => null,
  deleteZoneMediaFile: vi.fn(),
}));
vi.mock('@/lib/zones/columns', () => ({ getOrCreateColumn: vi.fn(), recountZoneColumns: vi.fn() }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn() }));
vi.mock('@/lib/zones/office-preview', () => ({ scheduleOfficePreview: vi.fn() }));
vi.mock('@/lib/zones/queries', () => ({ readableZoneWhere: vi.fn(() => ({})), zoneOrgTree: vi.fn() }));

import { coverAspectSchema, coverPosSchema } from '@/lib/zones/post-cover-schema';
import {
  createZonePost,
  toZonePostCardView,
  updateZonePost,
  zonePostInputSchema,
  type ZonePostCardRow,
  type ZonePostInput,
} from '@/lib/zones/post-queries';

const COVER = '/api/zones/media/image/NXTWcaU4d6EKJryOHdOSq.png';
const KEY_A = 'image/NXTWcaU4d6EKJryOHdOSq.png';
const KEY_B = 'image/V1StGXR8_Z5jdHi6B-myT.jpg';

describe('zonePostCoverFraming — what a view ships', () => {
  it('passes a stored framing through when the viewer may see the cover', () => {
    expect(zonePostCoverFraming({ coverUrl: COVER, coverAspect: 'portrait', coverPos: 'contain' }, false)).toEqual({
      coverAspect: 'portrait',
      coverPos: 'contain',
    });
    expect(zonePostCoverFraming({ coverUrl: COVER, coverAspect: 'landscape', coverPos: '30% 70%' }, false)).toEqual({
      coverAspect: 'landscape',
      coverPos: '30% 70%',
    });
  });

  it('resets to the defaults on a locked stub, and when there is no cover at all', () => {
    expect(zonePostCoverFraming({ coverUrl: COVER, coverAspect: 'portrait', coverPos: '10% 90%' }, true)).toEqual(
      DEFAULT_POST_COVER_FRAMING,
    );
    expect(zonePostCoverFraming({ coverUrl: null, coverAspect: 'portrait', coverPos: 'contain' }, false)).toEqual(
      DEFAULT_POST_COVER_FRAMING,
    );
  });

  it('renders a drifted stored value as the default instead of shipping it', () => {
    expect(
      zonePostCoverFraming({ coverUrl: COVER, coverAspect: 'square', coverPos: 'center; background:url(//evil)' }, false),
    ).toEqual(DEFAULT_POST_COVER_FRAMING);
    expect(zonePostCoverFraming({ coverUrl: COVER, coverAspect: null, coverPos: null }, false)).toEqual(
      DEFAULT_POST_COVER_FRAMING,
    );
  });

  it('never hands out the shared default object itself', () => {
    const a = zonePostCoverFraming({ coverUrl: null }, false);
    a.coverPos = 'contain';
    expect(DEFAULT_POST_COVER_FRAMING.coverPos).toBe('');
  });
});

describe('parseCoverFramingInput — the write boundary', () => {
  it('reads "not mentioned" as nothing to write', () => {
    expect(parseCoverFramingInput({})).toEqual({});
    expect(parseCoverFramingInput({ coverAspect: undefined, coverPos: undefined })).toEqual({});
  });

  it('accepts the three pos shapes and both aspects, normalising percentages', () => {
    expect(parseCoverFramingInput({ coverAspect: 'portrait', coverPos: 'contain' })).toEqual({
      coverAspect: 'portrait',
      coverPos: 'contain',
    });
    expect(parseCoverFramingInput({ coverPos: '' })).toEqual({ coverPos: '' });
    expect(parseCoverFramingInput({ coverPos: '050% 5%' })).toEqual({ coverPos: '50% 5%' });
    expect(parseCoverFramingInput({ coverAspect: 'landscape' })).toEqual({ coverAspect: 'landscape' });
  });

  it('rejects anything outside the closed sets — never "fixes" it', () => {
    for (const coverAspect of ['square', 'PORTRAIT', 'portrait ', 3, {}, ['portrait']]) {
      expect(parseCoverFramingInput({ coverAspect }), String(coverAspect)).toBeNull();
    }
    for (const coverPos of ['center', '50% 120%', '101% 0%', '50%', '50px 50px', '-5% 5%', '50% 50%;color:red', 'cover', 7, {}]) {
      expect(parseCoverFramingInput({ coverPos }), String(coverPos)).toBeNull();
    }
    // One bad field poisons the pair: a half-applied framing is not what the author chose.
    expect(parseCoverFramingInput({ coverAspect: 'portrait', coverPos: 'middle' })).toBeNull();
  });
});

describe('nextCoverFraming — what an update stores', () => {
  it('resets both columns when the cover is removed, whatever was sent', () => {
    expect(
      nextCoverFraming({ existingCoverKey: KEY_A, nextCoverKey: null, sent: { coverAspect: 'portrait', coverPos: '10% 10%' } }),
    ).toEqual(DEFAULT_POST_COVER_FRAMING);
    expect(nextCoverFraming({ existingCoverKey: null, nextCoverKey: null, sent: {} })).toEqual(DEFAULT_POST_COVER_FRAMING);
  });

  it('writes nothing for a post that has no cover (framing alone is meaningless)', () => {
    expect(nextCoverFraming({ existingCoverKey: null, nextCoverKey: undefined, sent: { coverAspect: 'portrait', coverPos: 'contain' } })).toEqual({});
  });

  it('never lets a new image inherit the old image\'s crop', () => {
    // Replaced without saying how to frame it → back to the defaults.
    expect(nextCoverFraming({ existingCoverKey: KEY_A, nextCoverKey: KEY_B, sent: {} })).toEqual(DEFAULT_POST_COVER_FRAMING);
    // Replaced WITH a framing → what was sent, defaults for the rest.
    expect(nextCoverFraming({ existingCoverKey: KEY_A, nextCoverKey: KEY_B, sent: { coverAspect: 'portrait' } })).toEqual({
      coverAspect: 'portrait',
      coverPos: '',
    });
    // The first cover a post ever gets is a "different image" too.
    expect(nextCoverFraming({ existingCoverKey: null, nextCoverKey: KEY_A, sent: { coverPos: 'contain' } })).toEqual({
      coverAspect: 'landscape',
      coverPos: 'contain',
    });
  });

  it('leaves the framing alone when the patch does not mention it', () => {
    // The composer re-sends the same key on every save.
    expect(nextCoverFraming({ existingCoverKey: KEY_A, nextCoverKey: KEY_A, sent: {} })).toEqual({});
    // A patch that does not touch the cover at all (title-only edit, API client).
    expect(nextCoverFraming({ existingCoverKey: KEY_A, nextCoverKey: undefined, sent: {} })).toEqual({});
  });

  it('applies exactly the fields that were sent for an unchanged image', () => {
    expect(nextCoverFraming({ existingCoverKey: KEY_A, nextCoverKey: KEY_A, sent: { coverPos: '20% 80%' } })).toEqual({
      coverPos: '20% 80%',
    });
    expect(nextCoverFraming({ existingCoverKey: KEY_A, nextCoverKey: undefined, sent: { coverAspect: 'portrait' } })).toEqual({
      coverAspect: 'portrait',
    });
  });
});

describe('initialCoverFraming — what a create stores', () => {
  it('is the defaults without a cover and the sent values over the defaults with one', () => {
    expect(initialCoverFraming(null, { coverAspect: 'portrait', coverPos: 'contain' })).toEqual(DEFAULT_POST_COVER_FRAMING);
    expect(initialCoverFraming(KEY_A, {})).toEqual(DEFAULT_POST_COVER_FRAMING);
    expect(initialCoverFraming(KEY_A, { coverAspect: 'portrait', coverPos: 'contain' })).toEqual({
      coverAspect: 'portrait',
      coverPos: 'contain',
    });
  });
});

describe('the request schemas share the contract', () => {
  it('coverAspectSchema / coverPosSchema accept the closed sets only', () => {
    expect(coverAspectSchema.safeParse('portrait').success).toBe(true);
    expect(coverAspectSchema.safeParse('landscape').success).toBe(true);
    expect(coverAspectSchema.safeParse('square').success).toBe(false);
    expect(coverPosSchema.safeParse('').success).toBe(true);
    expect(coverPosSchema.safeParse('contain').success).toBe(true);
    expect(coverPosSchema.safeParse('0% 100%').success).toBe(true);
    expect(coverPosSchema.safeParse('50% 101%').success).toBe(false);
    expect(coverPosSchema.safeParse('center').success).toBe(false);
    expect(coverPosSchema.safeParse(50).success).toBe(false);
  });

  it('zonePostInputSchema: omitted ⇒ undefined (create defaults apply), junk ⇒ a named issue', () => {
    const base = { title: '一篇足够长的标题', bodyMd: 'hello' };
    const plain = zonePostInputSchema.safeParse(base);
    expect(plain.success).toBe(true);
    if (plain.success) {
      expect(plain.data.coverAspect).toBeUndefined();
      expect(plain.data.coverPos).toBeUndefined();
    }

    const framed = zonePostInputSchema.safeParse({ ...base, coverKey: KEY_A, coverAspect: 'portrait', coverPos: 'contain' });
    expect(framed.success).toBe(true);
    if (framed.success) expect(framed.data).toMatchObject({ coverAspect: 'portrait', coverPos: 'contain' });

    const badPos = zonePostInputSchema.safeParse({ ...base, coverPos: 'top left' });
    expect(badPos.success).toBe(false);
    if (!badPos.success) expect(badPos.error.issues[0]?.message).toBe('invalid_cover_pos');

    const badAspect = zonePostInputSchema.safeParse({ ...base, coverAspect: 'wide' });
    expect(badAspect.success).toBe(false);
    if (!badAspect.success) expect(badAspect.error.issues[0]?.message).toBe('invalid_cover_aspect');
  });
});

describe('toZonePostCardView — the cover and its framing travel together', () => {
  const author = { handle: 'ada', displayName: 'Ada', avatarUrl: null, department: null, lab: null, isPrivate: false };
  const now = new Date('2026-09-18T08:00:00.000Z');
  const row: ZonePostCardRow = {
    id: 'p1',
    zoneId: 'z1',
    type: 'article',
    title: '海报帖',
    summary: '摘要',
    coverUrl: COVER,
    coverAspect: 'portrait',
    coverPos: '40% 10%',
    linkUrl: null,
    tags: [],
    status: 'published',
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    editedAt: null,
    editedById: null,
    editedBy: null,
    pinned: false,
    locked: false,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    bookmarkCount: 0,
    bodyMd: 'body',
    visibility: 'restricted',
    columnId: null,
    column: null,
    authorId: 'u1',
    author,
    coauthors: [],
    attachments: [],
    zone: { id: 'z1', slug: 'lab', name: 'Lab', iconUrl: null, themeColor: null },
  };
  const ctx = { viewerId: 'u2', canSeeIdentity: false, liked: new Set<string>(), bookmarked: new Set<string>() };

  it('ships the stored framing to a viewer who may read the post', () => {
    const view = toZonePostCardView(row, ctx);
    expect(view).toMatchObject({ coverUrl: COVER, coverAspect: 'portrait', coverPos: '40% 10%', accessLocked: false });
  });

  it('a locked stub carries neither the cover nor its framing', () => {
    const view = toZonePostCardView(row, { ...ctx, lockedIds: new Set(['p1']) });
    expect(view).toMatchObject({ coverUrl: null, coverAspect: 'landscape', coverPos: '', accessLocked: true });
  });

  it('a row whose stored framing drifted renders as the default', () => {
    const view = toZonePostCardView({ ...row, coverAspect: 'diagonal', coverPos: '200% 5%' }, ctx);
    expect(view).toMatchObject({ coverUrl: COVER, coverAspect: 'landscape', coverPos: '' });
  });
});

describe('createZonePost / updateZonePost — what actually reaches the row', () => {
  const ZONE = {
    id: 'z1',
    slug: 'edge-inference',
    name: '边缘推理',
    ownerId: 'owner',
    visibility: 'public' as const,
    joinPolicy: 'open' as const,
    allowGuestComments: true,
    deletedAt: null,
  };
  const input = (over: Partial<ZonePostInput> = {}): ZonePostInput => ({
    type: 'article',
    title: '推理时延优化',
    summary: '',
    bodyMd: '',
    coverKey: null,
    linkUrl: null,
    tags: [],
    coauthorIds: [],
    attachments: [],
    status: 'draft',
    columnId: null,
    columnName: null,
    visibility: 'zone',
    designatedUserIds: [],
    regenerateAccessCode: false,
    ...over,
  });
  const existingPost = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    zoneId: ZONE.id,
    authorId: 'author',
    type: 'article',
    title: '推理时延优化',
    summary: '',
    bodyMd: 'body',
    coverKey: KEY_A,
    linkUrl: null,
    columnId: null,
    visibility: 'zone',
    accessCode: null,
    status: 'published',
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    deletedAt: null,
    coauthors: [] as { userId: string }[],
    zone: { ...ZONE },
    attachments: [] as unknown[],
    ...over,
  });
  const created = () => db.tx.zonePost.create.mock.calls[0]?.[0].data ?? {};
  const updated = () => db.tx.zonePost.update.mock.calls[0]?.[0].data ?? {};

  beforeEach(() => {
    db.state.existing = null;
    vi.clearAllMocks();
  });

  it('create: stores the sent framing next to a cover, the defaults without one', async () => {
    await createZonePost(ZONE, 'author', input({ coverKey: KEY_A, coverAspect: 'portrait', coverPos: 'contain' }));
    expect(created()).toMatchObject({ coverKey: KEY_A, coverAspect: 'portrait', coverPos: 'contain' });

    vi.clearAllMocks();
    // Callers that predate the fields (seed scripts) send neither.
    await createZonePost(ZONE, 'author', input({ coverKey: KEY_A }));
    expect(created()).toMatchObject({ coverAspect: 'landscape', coverPos: '' });

    vi.clearAllMocks();
    await createZonePost(ZONE, 'author', input({ coverKey: null, coverAspect: 'portrait', coverPos: '10% 10%' }));
    expect(created()).toMatchObject({ coverKey: null, coverAspect: 'landscape', coverPos: '' });
  });

  it('update: re-framing a PUBLISHED post writes the framing and does not stamp 「最后编辑」', async () => {
    db.state.existing = existingPost();
    await updateZonePost('p1', { coverAspect: 'portrait', coverPos: '30% 70%' }, { actorId: 'moderator', canModerate: true });
    const data = updated();
    expect(data).toMatchObject({ coverAspect: 'portrait', coverPos: '30% 70%' });
    expect(data).not.toHaveProperty('editedAt');
    expect(data).not.toHaveProperty('editedBy');
    // The cover itself was not part of the patch.
    expect(data).not.toHaveProperty('coverKey');
  });

  it('update: a patch that does not mention framing leaves both columns alone', async () => {
    db.state.existing = existingPost();
    await updateZonePost('p1', { coverKey: KEY_A, tags: ['x'] }, { actorId: 'author' });
    expect(updated()).not.toHaveProperty('coverAspect');
    expect(updated()).not.toHaveProperty('coverPos');
  });

  it('update: removing the cover resets the framing; a new image starts clean', async () => {
    db.state.existing = existingPost();
    await updateZonePost('p1', { coverKey: null, coverAspect: 'portrait', coverPos: 'contain' }, { actorId: 'author' });
    expect(updated()).toMatchObject({ coverKey: null, coverUrl: null, coverAspect: 'landscape', coverPos: '' });

    vi.clearAllMocks();
    db.state.existing = existingPost();
    await updateZonePost('p1', { coverKey: KEY_B }, { actorId: 'author' });
    expect(updated()).toMatchObject({ coverKey: KEY_B, coverAspect: 'landscape', coverPos: '' });
  });

  it('lib backstop: junk framing is a 400 for callers that skip the route schema', async () => {
    db.state.existing = existingPost();
    await expect(updateZonePost('p1', { coverPos: 'top left' }, { actorId: 'author' })).rejects.toMatchObject({
      code: 'invalid_input',
      status: 400,
    });
    await expect(createZonePost(ZONE, 'author', input({ coverKey: KEY_A, coverAspect: 'wide' }))).rejects.toMatchObject({
      code: 'invalid_input',
      status: 400,
    });
    expect(db.tx.zonePost.update).not.toHaveBeenCalled();
    expect(db.tx.zonePost.create).not.toHaveBeenCalled();
  });
});

describe('the composer starts a picked image from its shape', () => {
  it('a tall poster starts as 竖版 + 完整显示; anything else keeps the historical default', () => {
    expect(defaultCoverFor(1080, 1920)).toEqual({ aspect: 'portrait', pos: 'contain' });
    expect(defaultCoverFor(1200, 1600)).toEqual({ aspect: 'portrait', pos: 'contain' });
    expect(defaultCoverFor(1920, 1080)).toEqual({ aspect: 'landscape', pos: '' });
    expect(defaultCoverFor(1000, 1000)).toEqual({ aspect: 'landscape', pos: '' });
    // Unmeasurable (decode failed) ⇒ the same default, never a throw.
    expect(defaultCoverFor(0, 0)).toEqual({ aspect: 'landscape', pos: '' });
  });

  it('frames: 2:1 banner for 横版, 3:4 poster for 竖版 — the editor and the sheet preview share this', () => {
    expect(postCoverRatio('landscape')).toBe(2);
    expect(postCoverRatio('portrait')).toBe(3 / 4);
  });
});
