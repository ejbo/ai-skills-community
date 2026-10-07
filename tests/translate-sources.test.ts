import { beforeEach, describe, expect, it, vi } from 'vitest';

// 站内翻译 — the kind registry. "Translatable exactly when readable": every loader
// must re-run its surface's own read gate, so each kind gets (a) the readable
// case, (b) a missing row, (c) its main denial case — and, where the gate is a
// domain helper, a check that the loader CALLS it with the row it loaded and
// honours the answer. A loader that skipped its gate fails here.

type Row = Record<string, unknown> | null;

const h = vi.hoisted(() => ({
  rows: {} as Record<string, Row>,
  calls: [] as { model: string; args: { where?: unknown; select?: Record<string, unknown>; include?: unknown } }[],
  canSeeZonePost: true,
  zoneCanRead: true,
  canReadDoc: true,
}));

vi.mock('@/lib/db', () => {
  const model = (name: string) => ({
    findUnique: vi.fn(async (args: { where?: unknown; select?: Record<string, unknown> }) => {
      h.calls.push({ model: name, args });
      return h.rows[name] ?? null;
    }),
  });
  return {
    prisma: Object.fromEntries(
      [
        'post',
        'postComment',
        'discussionTopic',
        'discussionReply',
        'feedback',
        'feedbackComment',
        'videoComment',
        'zonePost',
        'zonePostComment',
        'libraryComment',
        'libraryHighlight',
        'libraryNoteReply',
        'libraryProgress',
        'voteComment',
        'contentAudience',
      ].map((m) => [m, model(m)]),
    ),
  };
});

// lib/video/access.ts is pure apart from importing the session helper.
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }));

const zones = vi.hoisted(() => ({
  resolveZoneAccess: vi.fn(),
  canSeeZonePost: vi.fn(),
}));
vi.mock('@/lib/zones/access', async () => {
  const { can } = await import('@/lib/permissions');
  return {
    ZONE_ACCESS_SELECT: { id: true, ownerId: true, visibility: true, deletedAt: true },
    zoneSiteViewer: (user: ({ id: string } & PermissionHolder) | null) => ({
      id: user?.id ?? null,
      siteAdmin: can(user, 'zones'),
      canSeeIdentity: can(user, 'identity'),
    }),
    resolveZoneAccess: zones.resolveZoneAccess,
  };
});
vi.mock('@/lib/zones/post-queries', () => ({
  ZONE_POST_ACCESS_SELECT: { id: true, authorId: true, status: true, deletedAt: true, visibility: true, coauthors: { select: { userId: true } } },
  canSeeZonePost: zones.canSeeZonePost,
}));

const library = vi.hoisted(() => ({ canReadDoc: vi.fn() }));
vi.mock('@/lib/library-queries', async () => {
  const { hasPermission } = await import('@/lib/permissions');
  return {
    canReadDoc: library.canReadDoc,
    libraryViewerFromSession: (session: { user?: { id: string } & PermissionHolder } | null) =>
      session?.user ? { id: session.user.id, canManage: hasPermission(session.user, 'library') } : null,
  };
});

import type { PermissionHolder } from '@/lib/permissions';
import { TRANSLATE_SOURCES } from '@/lib/translate/sources';
import { TRANSLATE_KINDS, type TranslateKind } from '@/lib/translate/shared';

const member = { id: 'u-member', roleKey: 'member', permissions: [] as string[] };
const other = { id: 'u-other', roleKey: 'member', permissions: [] as string[] };
const staff = (perm: string) => ({ id: 'u-staff', roleKey: 'ops', permissions: [perm] });

const liveDoc = { id: 'doc1', uploaderId: 'u-uploader', visibility: 'public', status: 'ready', deletedAt: null };
const zone = { id: 'z1', ownerId: 'u-owner', visibility: 'public', deletedAt: null };
const zonePostGate = { id: 'zp1', authorId: 'u-author', status: 'published', deletedAt: null, visibility: 'zone', coauthors: [] };
const publishedVideo = { status: 'published', visibility: 'public', uploaderId: 'u-up', deletedAt: null, isShort: false };

beforeEach(() => {
  h.rows = {};
  h.calls = [];
  zones.resolveZoneAccess.mockReset().mockImplementation(async () => ({ canRead: h.zoneCanRead, canModerate: false }));
  zones.canSeeZonePost.mockReset().mockImplementation(async () => h.canSeeZonePost);
  library.canReadDoc.mockReset().mockImplementation(async () => h.canReadDoc);
  h.canSeeZonePost = true;
  h.zoneCanRead = true;
  h.canReadDoc = true;
});

describe('registry shape', () => {
  it('has exactly one loader per declared kind', () => {
    expect(Object.keys(TRANSLATE_SOURCES).sort()).toEqual(Object.keys(TRANSLATE_KINDS).sort());
    for (const load of Object.values(TRANSLATE_SOURCES)) expect(typeof load).toBe('function');
  });

  it('an anonymous viewer never reaches a private kind — not even a DB read', async () => {
    const privateKinds = (Object.keys(TRANSLATE_KINDS) as TranslateKind[]).filter((k) => !TRANSLATE_KINDS[k].public);
    expect(privateKinds.length).toBeGreaterThan(0);
    for (const kind of privateKinds) {
      expect(await TRANSLATE_SOURCES[kind]('any-id', null), kind).toBeNull();
    }
    expect(h.calls).toEqual([]);
  });

  it('a junk id is null without a read', async () => {
    for (const kind of Object.keys(TRANSLATE_KINDS) as TranslateKind[]) {
      expect(await TRANSLATE_SOURCES[kind]('', member)).toBeNull();
      expect(await TRANSLATE_SOURCES[kind](undefined as unknown as string, member)).toBeNull();
    }
    expect(h.calls).toEqual([]);
  });

  it('only declared field names leave the registry, trimmed, and an all-empty item is null', async () => {
    // A loader that (wrongly) returned an extra key could not leak it: the wrapper filters by the kind's fields.
    h.rows.discussionTopic = { title: '  标题  ', bodyMd: '   ' };
    expect(await TRANSLATE_SOURCES.topic('t1', null)).toEqual({ title: '标题' });
    h.rows.discussionTopic = { title: ' ', bodyMd: '' };
    expect(await TRANSLATE_SOURCES.topic('t1', null)).toBeNull();
    for (const kind of Object.keys(TRANSLATE_KINDS) as TranslateKind[]) {
      const declared = Object.keys(TRANSLATE_KINDS[kind].fields);
      expect(declared.length, kind).toBeGreaterThan(0);
    }
  });

  it('never includes whole rows — every read is a minimal select keyed by id', async () => {
    h.rows.post = { bodyMd: 'x' };
    h.rows.zonePost = { ...zonePostGate, title: 't', summary: 's', bodyMd: 'b', zone };
    await TRANSLATE_SOURCES.post('p1', null);
    await TRANSLATE_SOURCES.zone_post('zp1', member);
    for (const c of h.calls) {
      expect(c.args.include, c.model).toBeUndefined();
      expect(c.args.select, c.model).toBeDefined();
      expect(c.args.where).toEqual({ id: expect.any(String) });
    }
  });
});

describe('动态 / 讨论 / 意见反馈 (public, hard-deleted: existence + visible)', () => {
  it('post', async () => {
    h.rows.post = { bodyMd: '一条动态' };
    expect(await TRANSLATE_SOURCES.post('p1', null)).toEqual({ body: '一条动态' });
    expect(await TRANSLATE_SOURCES.post('p1', member)).toEqual({ body: '一条动态' });
    h.rows.post = null;
    expect(await TRANSLATE_SOURCES.post('gone', member)).toBeNull();
  });

  it('topic (title + body) and feedback (title + body)', async () => {
    h.rows.discussionTopic = { title: '主题', bodyMd: '正文' };
    expect(await TRANSLATE_SOURCES.topic('t1', null)).toEqual({ title: '主题', body: '正文' });
    h.rows.discussionTopic = null;
    expect(await TRANSLATE_SOURCES.topic('t1', null)).toBeNull();

    h.rows.feedback = { title: '建议', bodyMd: '详情' };
    expect(await TRANSLATE_SOURCES.feedback('f1', null)).toEqual({ title: '建议', body: '详情' });
    h.rows.feedback = null;
    expect(await TRANSLATE_SOURCES.feedback('f1', null)).toBeNull();
  });

  it.each([
    ['post_comment', 'postComment'],
    ['topic_reply', 'discussionReply'],
    ['feedback_comment', 'feedbackComment'],
  ] as const)('%s: visible only — a tombstone is not content', async (kind, model) => {
    h.rows[model] = { bodyMd: '一条评论', status: 'visible' };
    expect(await TRANSLATE_SOURCES[kind]('c1', null)).toEqual({ body: '一条评论' });
    h.rows[model] = { bodyMd: '', status: 'deleted' };
    expect(await TRANSLATE_SOURCES[kind]('c1', member)).toBeNull();
    // even if a tombstone somehow kept its text
    h.rows[model] = { bodyMd: 'leftover', status: 'deleted' };
    expect(await TRANSLATE_SOURCES[kind]('c1', member)).toBeNull();
    h.rows[model] = null;
    expect(await TRANSLATE_SOURCES[kind]('gone', member)).toBeNull();
  });
});

describe('video_comment (canViewVideo — the real function)', () => {
  const row = (over: Record<string, unknown> = {}, video: Record<string, unknown> = {}) => ({
    bodyMd: '讲得好',
    status: 'visible',
    ...over,
    video: { ...publishedVideo, ...video },
  });

  it('readable: a published public video (long or short)', async () => {
    h.rows.videoComment = row();
    expect(await TRANSLATE_SOURCES.video_comment('vc1', member)).toEqual({ body: '讲得好' });
    h.rows.videoComment = row({}, { isShort: true, visibility: 'unlisted' });
    expect(await TRANSLATE_SOURCES.video_comment('vc1', member)).toEqual({ body: '讲得好' });
  });

  it('missing / hidden / deleted comment', async () => {
    h.rows.videoComment = null;
    expect(await TRANSLATE_SOURCES.video_comment('vc1', member)).toBeNull();
    h.rows.videoComment = row({ status: 'hidden' });
    expect(await TRANSLATE_SOURCES.video_comment('vc1', member)).toBeNull();
    h.rows.videoComment = row({ status: 'deleted' });
    expect(await TRANSLATE_SOURCES.video_comment('vc1', member)).toBeNull();
  });

  it('a draft / private video is closed to members, open to its uploader and to the right manager', async () => {
    h.rows.videoComment = row({}, { status: 'draft' });
    expect(await TRANSLATE_SOURCES.video_comment('vc1', member)).toBeNull();
    expect(await TRANSLATE_SOURCES.video_comment('vc1', { ...member, id: 'u-up' })).toEqual({ body: '讲得好' });
    expect(await TRANSLATE_SOURCES.video_comment('vc1', staff('videos'))).toEqual({ body: '讲得好' });
    // `shorts` does not manage a LONG video
    expect(await TRANSLATE_SOURCES.video_comment('vc1', staff('shorts'))).toBeNull();

    h.rows.videoComment = row({}, { visibility: 'private' });
    expect(await TRANSLATE_SOURCES.video_comment('vc1', member)).toBeNull();
    h.rows.videoComment = row({}, { visibility: 'private', isShort: true });
    expect(await TRANSLATE_SOURCES.video_comment('vc1', staff('shorts'))).toEqual({ body: '讲得好' });
  });

  it('a deleted video is closed to everyone, managers included (the list route 404s it)', async () => {
    h.rows.videoComment = row({}, { deletedAt: new Date() });
    expect(await TRANSLATE_SOURCES.video_comment('vc1', member)).toBeNull();
    expect(await TRANSLATE_SOURCES.video_comment('vc1', staff('videos'))).toBeNull();
  });
});

describe('zone_post / zone_comment (resolveZoneAccess + canSeeZonePost)', () => {
  const post = (over: Record<string, unknown> = {}, z: Record<string, unknown> = {}) => ({
    ...zonePostGate,
    title: '标题',
    summary: '摘要',
    bodyMd: '正文',
    ...over,
    zone: { ...zone, ...z },
  });

  it('readable: title + summary + body, and the gate saw THIS row, THIS zone, THIS viewer', async () => {
    h.rows.zonePost = post();
    expect(await TRANSLATE_SOURCES.zone_post('zp1', member)).toEqual({ title: '标题', summary: '摘要', body: '正文' });
    expect(zones.resolveZoneAccess).toHaveBeenCalledTimes(1);
    expect(zones.resolveZoneAccess.mock.calls[0][0]).toMatchObject({ id: 'z1' });
    expect(zones.resolveZoneAccess.mock.calls[0][1]).toMatchObject({ id: 'u-member', siteAdmin: false });
    expect(zones.canSeeZonePost).toHaveBeenCalledTimes(1);
    const [gateRow, access, viewer] = zones.canSeeZonePost.mock.calls[0];
    expect(gateRow).toMatchObject({ id: 'zp1', authorId: 'u-author', status: 'published', visibility: 'zone', coauthors: [] });
    expect(access).toEqual({ canRead: true, canModerate: false });
    expect(viewer).toMatchObject({ id: 'u-member' });
  });

  it('the select carries every column the gate needs', async () => {
    h.rows.zonePost = post();
    await TRANSLATE_SOURCES.zone_post('zp1', member);
    const select = h.calls.find((c) => c.model === 'zonePost')!.args.select!;
    for (const col of ['id', 'authorId', 'status', 'deletedAt', 'visibility', 'coauthors', 'zone', 'title', 'summary', 'bodyMd']) {
      expect(select[col], col).toBeTruthy();
    }
  });

  it('hidden / locked (canSeeZonePost false) ⇒ null — a stub viewer never gets the body', async () => {
    h.rows.zonePost = post({ visibility: 'restricted' });
    h.canSeeZonePost = false;
    expect(await TRANSLATE_SOURCES.zone_post('zp1', member)).toBeNull();
    expect(zones.canSeeZonePost).toHaveBeenCalledTimes(1);
  });

  it('missing row; soft-deleted post and deleted zone exist only for site staff', async () => {
    h.rows.zonePost = null;
    expect(await TRANSLATE_SOURCES.zone_post('zp1', member)).toBeNull();

    h.rows.zonePost = post({ deletedAt: new Date() });
    expect(await TRANSLATE_SOURCES.zone_post('zp1', member)).toBeNull();
    expect(zones.canSeeZonePost).not.toHaveBeenCalled();
    expect(await TRANSLATE_SOURCES.zone_post('zp1', staff('zones'))).toEqual({ title: '标题', summary: '摘要', body: '正文' });

    zones.canSeeZonePost.mockClear();
    h.rows.zonePost = post({}, { deletedAt: new Date() });
    expect(await TRANSLATE_SOURCES.zone_post('zp1', member)).toBeNull();
    expect(zones.canSeeZonePost).not.toHaveBeenCalled();
  });

  const comment = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}, z: Record<string, unknown> = {}) => ({
    bodyMd: '学习了',
    status: 'visible',
    ...over,
    post: { ...zonePostGate, ...p, zone: { ...zone, ...z } },
  });

  it('zone_comment: readable, and gated on the PARENT post', async () => {
    h.rows.zonePostComment = comment();
    expect(await TRANSLATE_SOURCES.zone_comment('zc1', member)).toEqual({ body: '学习了' });
    expect(zones.canSeeZonePost.mock.calls[0][0]).toMatchObject({ id: 'zp1', visibility: 'zone' });
  });

  it('zone_comment: tombstone / missing / unreadable zone / post the viewer cannot see / deleted post', async () => {
    h.rows.zonePostComment = comment({ status: 'deleted' });
    expect(await TRANSLATE_SOURCES.zone_comment('zc1', member)).toBeNull();
    h.rows.zonePostComment = null;
    expect(await TRANSLATE_SOURCES.zone_comment('zc1', member)).toBeNull();

    h.rows.zonePostComment = comment();
    h.zoneCanRead = false;
    expect(await TRANSLATE_SOURCES.zone_comment('zc1', member)).toBeNull();
    h.zoneCanRead = true;

    h.canSeeZonePost = false;
    expect(await TRANSLATE_SOURCES.zone_comment('zc1', member)).toBeNull();
    h.canSeeZonePost = true;

    // The comments LIST route 404s a deleted post for everyone — staff included.
    h.rows.zonePostComment = comment({}, { deletedAt: new Date() });
    expect(await TRANSLATE_SOURCES.zone_comment('zc1', staff('zones'))).toBeNull();

    h.rows.zonePostComment = comment({}, {}, { deletedAt: new Date() });
    expect(await TRANSLATE_SOURCES.zone_comment('zc1', member)).toBeNull();
  });
});

describe('知识库', () => {
  it('library_comment: the DETAIL page gate — ready, not deleted, private only for uploader / managers', async () => {
    const row = (doc: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
      bodyMd: '好文',
      status: 'visible',
      ...over,
      doc: { ...liveDoc, ...doc },
    });
    h.rows.libraryComment = row();
    expect(await TRANSLATE_SOURCES.library_comment('lc1', member)).toEqual({ body: '好文' });
    // restricted: the page (and its comments) is shown to every member — canReadDoc is NOT this surface's gate
    h.rows.libraryComment = row({ visibility: 'restricted' });
    h.canReadDoc = false;
    expect(await TRANSLATE_SOURCES.library_comment('lc1', member)).toEqual({ body: '好文' });

    h.rows.libraryComment = row({ visibility: 'private' });
    expect(await TRANSLATE_SOURCES.library_comment('lc1', member)).toBeNull();
    expect(await TRANSLATE_SOURCES.library_comment('lc1', { ...member, id: 'u-uploader' })).toEqual({ body: '好文' });
    expect(await TRANSLATE_SOURCES.library_comment('lc1', staff('library'))).toEqual({ body: '好文' });

    h.rows.libraryComment = row({ deletedAt: new Date() });
    expect(await TRANSLATE_SOURCES.library_comment('lc1', staff('library'))).toBeNull();
    h.rows.libraryComment = row({ status: 'processing' });
    expect(await TRANSLATE_SOURCES.library_comment('lc1', member)).toBeNull();
    h.rows.libraryComment = row({}, { status: 'deleted' });
    expect(await TRANSLATE_SOURCES.library_comment('lc1', member)).toBeNull();
    h.rows.libraryComment = null;
    expect(await TRANSLATE_SOURCES.library_comment('lc1', member)).toBeNull();
  });

  const note = (over: Record<string, unknown> = {}, doc: Record<string, unknown> = {}) => ({
    noteText: '这段很关键',
    userId: 'u-other',
    ...over,
    doc: { ...liveDoc, ...doc },
  });

  it('library_note: someone else’s note needs canReadDoc AND shareNotes', async () => {
    h.rows.libraryHighlight = note();
    h.rows.libraryProgress = { shareNotes: true };
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toEqual({ body: '这段很关键' });
    expect(library.canReadDoc).toHaveBeenCalledTimes(1);
    expect(library.canReadDoc.mock.calls[0][0]).toMatchObject({ id: 'doc1', uploaderId: 'u-uploader', visibility: 'public' });
    expect(library.canReadDoc.mock.calls[0][1]).toEqual({ id: 'u-member', canManage: false });
    const progress = h.calls.find((c) => c.model === 'libraryProgress')!;
    expect(progress.args.where).toEqual({ userId_docId: { userId: 'u-other', docId: 'doc1' } });

    h.rows.libraryProgress = { shareNotes: false };
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toBeNull();
    h.rows.libraryProgress = null;
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toBeNull();
  });

  it('library_note: my own unshared note is mine to translate; an unreadable doc closes everything', async () => {
    h.rows.libraryHighlight = note({ userId: 'u-member' });
    h.rows.libraryProgress = { shareNotes: false };
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toEqual({ body: '这段很关键' });
    expect(h.calls.some((c) => c.model === 'libraryProgress')).toBe(false);

    h.canReadDoc = false;
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toBeNull();
    h.canReadDoc = true;

    h.rows.libraryHighlight = note({ userId: 'u-member' }, { deletedAt: new Date() });
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toBeNull();
    h.rows.libraryHighlight = note({ userId: 'u-member' }, { status: 'failed' });
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toBeNull();
  });

  it('library_note: a highlight with no note text, or no row', async () => {
    h.rows.libraryHighlight = note({ noteText: null, userId: 'u-member' });
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toBeNull();
    h.rows.libraryHighlight = note({ noteText: '   ', userId: 'u-member' });
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toBeNull();
    h.rows.libraryHighlight = null;
    expect(await TRANSLATE_SOURCES.library_note('n1', member)).toBeNull();
  });

  it('library_note_reply: readable only while its annotation is', async () => {
    const reply = (over: Record<string, unknown> = {}, owner = 'u-other') => ({
      bodyMd: '同意',
      status: 'visible',
      ...over,
      highlight: { userId: owner, doc: liveDoc },
    });
    h.rows.libraryNoteReply = reply();
    h.rows.libraryProgress = { shareNotes: true };
    expect(await TRANSLATE_SOURCES.library_note_reply('r1', other)).toEqual({ body: '同意' });

    // the annotation's owner stopped sharing ⇒ its replies go with it
    h.rows.libraryProgress = { shareNotes: false };
    expect(await TRANSLATE_SOURCES.library_note_reply('r1', member)).toBeNull();
    // …except for the owner, who still sees their own thread
    expect(await TRANSLATE_SOURCES.library_note_reply('r1', other)).toEqual({ body: '同意' });

    h.rows.libraryProgress = { shareNotes: true };
    h.canReadDoc = false;
    expect(await TRANSLATE_SOURCES.library_note_reply('r1', member)).toBeNull();
    h.canReadDoc = true;

    h.rows.libraryNoteReply = reply({ status: 'deleted' });
    expect(await TRANSLATE_SOURCES.library_note_reply('r1', member)).toBeNull();
    h.rows.libraryNoteReply = null;
    expect(await TRANSLATE_SOURCES.library_note_reply('r1', member)).toBeNull();
  });
});

describe('vote_comment (the comments LIST gate + the detail payload’s draft + 可见范围 gate)', () => {
  const row = (activity: Record<string, unknown> = {}, entry: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
    body: '这张拍得真好',
    activityId: 'a1',
    ...over,
    activity: { id: 'a1', deletedAt: null, status: 'published', visibility: 'public', creatorId: 'u-creator', ...activity },
    entry: { activityId: 'a1', hidden: false, status: 'approved', ...entry },
  });

  beforeEach(() => {
    h.rows.contentAudience = null;
  });

  it('隐藏 (private): creator and `votes` managers only — a listed member is still out', async () => {
    h.rows.voteComment = row({ visibility: 'private' });
    h.rows.contentAudience = { userId: member.id };
    expect(await TRANSLATE_SOURCES.vote_comment('v1', member)).toBeNull();
    expect(await TRANSLATE_SOURCES.vote_comment('v1', staff('votes'))).toEqual({ body: '这张拍得真好' });
    expect(await TRANSLATE_SOURCES.vote_comment('v1', { ...member, id: 'u-creator' })).toEqual({ body: '这张拍得真好' });
  });

  it('指定成员可见 (audience): readable exactly when the ContentAudience row exists', async () => {
    h.rows.voteComment = row({ visibility: 'audience' });
    expect(await TRANSLATE_SOURCES.vote_comment('v1', member)).toBeNull();
    h.rows.contentAudience = { userId: member.id };
    expect(await TRANSLATE_SOURCES.vote_comment('v1', member)).toEqual({ body: '这张拍得真好' });
    const lookup = h.calls.filter((c) => c.model === 'contentAudience').pop();
    expect(lookup?.args.where).toEqual({ kind_itemId_userId: { kind: 'vote', itemId: 'a1', userId: member.id } });
  });

  it('readable on a published activity’s approved, visible entry', async () => {
    h.rows.voteComment = row();
    expect(await TRANSLATE_SOURCES.vote_comment('v1', member)).toEqual({ body: '这张拍得真好' });
  });

  it('missing / deleted activity / a comment whose entry belongs to another activity', async () => {
    h.rows.voteComment = null;
    expect(await TRANSLATE_SOURCES.vote_comment('v1', member)).toBeNull();
    h.rows.voteComment = row({ deletedAt: new Date() });
    expect(await TRANSLATE_SOURCES.vote_comment('v1', staff('votes'))).toBeNull();
    h.rows.voteComment = row({}, { activityId: 'another' });
    expect(await TRANSLATE_SOURCES.vote_comment('v1', staff('votes'))).toBeNull();
  });

  it.each([
    ['hidden entry', {}, { hidden: true }],
    ['pending entry', {}, { status: 'pending' }],
    ['rejected entry', {}, { status: 'rejected' }],
    ['draft activity', { status: 'draft' }, {}],
  ] as const)('%s: managers only (`votes` permission or the creator)', async (_name, activity, entry) => {
    h.rows.voteComment = row(activity, entry);
    expect(await TRANSLATE_SOURCES.vote_comment('v1', member)).toBeNull();
    expect(await TRANSLATE_SOURCES.vote_comment('v1', staff('votes'))).toEqual({ body: '这张拍得真好' });
    expect(await TRANSLATE_SOURCES.vote_comment('v1', { ...member, id: 'u-creator' })).toEqual({ body: '这张拍得真好' });
    // another domain's permission is not this one
    expect(await TRANSLATE_SOURCES.vote_comment('v1', staff('videos'))).toBeNull();
  });
});
