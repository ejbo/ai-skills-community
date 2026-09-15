// 个人主页 — the pure halves of lib/profile/queries.ts + lib/profile/pins.ts, the
// profile href builder, and the discussion excerpt fix. The domain loaders are
// mocked away: what is pinned here is WHO may see WHICH section, that the tab
// list follows from it, that the merged comment keyset neither skips nor repeats
// a row across four tables, and that pins re-gate per viewer.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/zones/post-queries', () => ({ countZoneFeed: vi.fn(), listZoneFeed: vi.fn() }));
vi.mock('@/lib/event-queries', () => ({ countEventsByAuthor: vi.fn(), listEventsByAuthor: vi.fn() }));
vi.mock('@/lib/vote-queries', () => ({
  countVoteActivitiesByCreator: vi.fn(),
  listVoteActivitiesByCreator: vi.fn(),
}));

import {
  COMMENT_KINDS,
  PREVIEW_VISITOR_ID,
  commentAfterWhere,
  decodeCommentCursor,
  deriveProfileTabs,
  emptySectionCounts,
  encodeCommentCursor,
  isHiddenButVisible,
  mergeActivity,
  mergeCommentPages,
  pageWindow,
  parseProfileCursor,
  parseProfilePage,
  resolveProfileViewer,
  type CommentAfterWhere,
  type ProfileActivityItem,
  type ProfileCommentItem,
  type ProfileCommentKind,
} from '@/lib/profile/queries';
import {
  PIN_KIND_SECTION,
  applyPinWrite,
  orderResolvedPins,
  pruneDeadPins,
  pruneProfilePins,
  queryablePinIds,
  samePins,
  setProfilePin,
  type PinCardData,
} from '@/lib/profile/pins';
import { postsFigure } from '@/lib/profile/queries';
import { prisma } from '@/lib/db';
import {
  MAX_PINS,
  PIN_KINDS,
  PROFILE_SECTIONS,
  parseProfileLayout,
  resolveProfileTab,
  type ProfileLayout,
  type ProfileSection,
} from '@/lib/profile/shared';
import { excerptOf } from '@/lib/discussion-queries';
import { profileHref } from '@/app/users/[handle]/_components/profile-href';

const OWNER = 'owner-1';
const layoutHiding = (...hidden: ProfileSection[]): ProfileLayout => parseProfileLayout({ hidden });
const member = (id: string, permissions: string[] = []) => ({ id, roleKey: 'member', permissions });

describe('resolveProfileViewer', () => {
  const layout = layoutHiding('docs', 'shelf');

  it('anonymous: no login-only sections, no hidden sections, no gate id', () => {
    const v = resolveProfileViewer({ sessionUser: null, profileUserId: OWNER, layout });
    expect(v.loggedIn).toBe(false);
    expect(v.isOwner).toBe(false);
    expect(v.gateViewerId).toBeNull();
    for (const s of ['videos', 'zones', 'votes', 'docs', 'shelf'] as const) expect(v.allowed).not.toContain(s);
    expect(v.allowed).toContain('skills');
    expect(v.allowed).toContain('comments');
  });

  it('signed-in member: login-only sections open, hidden ones stay closed', () => {
    const v = resolveProfileViewer({ sessionUser: member('m-1'), profileUserId: OWNER, layout });
    expect(v.loggedIn).toBe(true);
    expect(v.gateViewerId).toBe('m-1');
    expect(v.allowed).toEqual(expect.arrayContaining(['videos', 'zones', 'votes']));
    expect(v.allowed).not.toContain('docs');
    expect(v.canSeeHidden).toBe(false);
  });

  it('owner: sees their hidden sections (badged) and gets owner tooling', () => {
    const v = resolveProfileViewer({ sessionUser: member(OWNER), profileUserId: OWNER, layout });
    expect(v.isOwner).toBe(true);
    expect(v.allowed).toHaveLength(PROFILE_SECTIONS.length);
    expect(isHiddenButVisible(v, 'docs')).toBe(true);
    expect(isHiddenButVisible(v, 'skills')).toBe(false);
  });

  it('identity holder: sees hidden sections but is not the owner', () => {
    const v = resolveProfileViewer({ sessionUser: member('admin', ['identity']), profileUserId: OWNER, layout });
    expect(v.isOwner).toBe(false);
    expect(v.canSeeIdentity).toBe(true);
    expect(v.allowed).toContain('docs');
  });

  it('访客视角: the owner loses every privilege, and the gate id matches no row', () => {
    for (const as of ['visitor', ['visitor']]) {
      const v = resolveProfileViewer({
        sessionUser: member(OWNER, ['identity']),
        profileUserId: OWNER,
        as,
        layout,
      });
      expect(v.isRealOwner).toBe(true);
      expect(v.previewAsVisitor).toBe(true);
      expect(v.isOwner).toBe(false);
      expect(v.canSeeIdentity).toBe(false);
      expect(v.canSeeHidden).toBe(false);
      expect(v.allowed).not.toContain('docs');
      expect(v.allowed).toContain('zones'); // still a SIGNED-IN visitor
      expect(v.gateViewerId).toBe(PREVIEW_VISITOR_ID);
      expect(v.gateViewerId).not.toBe(OWNER);
    }
  });

  it('?as=visitor from anyone but the owner is ignored', () => {
    const v = resolveProfileViewer({ sessionUser: member('m-2'), profileUserId: OWNER, as: 'visitor', layout });
    expect(v.previewAsVisitor).toBe(false);
    expect(v.gateViewerId).toBe('m-2');
  });

  it('allowed keeps the member’s own section order', () => {
    const custom = parseProfileLayout({ order: ['shelf', 'events', 'skills'], hidden: [] });
    const v = resolveProfileViewer({ sessionUser: null, profileUserId: OWNER, layout: custom });
    expect(v.allowed.slice(0, 3)).toEqual(['shelf', 'events', 'skills']);
  });
});

describe('deriveProfileTabs', () => {
  const layout = parseProfileLayout(null);

  it('visitors get 概览 + only sections with content, never 工作台', () => {
    const v = resolveProfileViewer({ sessionUser: member('m-1'), profileUserId: OWNER, layout });
    const counts = { ...emptySectionCounts(), posts: 3, skills: 2, videos: 1 };
    const tabs = deriveProfileTabs(v, counts);
    expect(tabs).toEqual(['overview', 'skills', 'posts', 'videos']);
    expect(resolveProfileTab('workspace', tabs)).toBe('overview');
    expect(resolveProfileTab('docs', tabs)).toBe('overview');
    expect(resolveProfileTab('videos', tabs)).toBe('videos');
  });

  it('the owner gets every allowed section (empty ones carry a CTA) and 工作台 last', () => {
    const v = resolveProfileViewer({ sessionUser: member(OWNER), profileUserId: OWNER, layout });
    const tabs = deriveProfileTabs(v, emptySectionCounts());
    expect(tabs[0]).toBe('overview');
    expect(tabs[tabs.length - 1]).toBe('workspace');
    expect(tabs).toHaveLength(PROFILE_SECTIONS.length + 2);
    expect(resolveProfileTab('workspace', tabs)).toBe('workspace');
  });

  it('anonymous visitors never get a login-only tab even when it has content', () => {
    const v = resolveProfileViewer({ sessionUser: null, profileUserId: OWNER, layout });
    const tabs = deriveProfileTabs(v, { ...emptySectionCounts(), videos: 9, zones: 4, votes: 2 });
    expect(tabs).toEqual(['overview']);
  });
});

describe('paging helpers', () => {
  it('parseProfilePage: garbage → 1, arrays read the first value, floats truncate', () => {
    expect(parseProfilePage(undefined)).toBe(1);
    expect(parseProfilePage('abc')).toBe(1);
    expect(parseProfilePage('0')).toBe(1);
    expect(parseProfilePage('-3')).toBe(1);
    expect(parseProfilePage('2.9')).toBe(2);
    expect(parseProfilePage(['4', '9'])).toBe(4);
  });

  it('parseProfileCursor: bounded strings only', () => {
    expect(parseProfileCursor('')).toBeNull();
    expect(parseProfileCursor('x'.repeat(201))).toBeNull();
    expect(parseProfileCursor(['a|b'])).toBe('a|b');
  });

  it('pageWindow clamps an out-of-range page into [1, pageCount]', () => {
    expect(pageWindow(0, 5, 20)).toEqual({ page: 1, pageCount: 1, skip: 0 });
    expect(pageWindow(45, 9, 20)).toEqual({ page: 3, pageCount: 3, skip: 40 });
  });
});

describe('mergeActivity', () => {
  const item = (key: string, at: string): ProfileActivityItem => ({
    key,
    kind: 'post',
    title: key,
    context: null,
    href: `/x/${key}`,
    at,
  });

  it('merges newest first, drops duplicates and unparsable dates, caps at take', () => {
    const a = [item('post:1', '2026-09-10T10:00:00Z'), item('post:3', '2026-09-01T10:00:00Z')];
    const b = [item('post:2', '2026-09-12T10:00:00Z'), item('post:1', '2026-09-10T10:00:00Z'), item('post:bad', 'nope')];
    expect(mergeActivity([a, b], 10).map((i) => i.key)).toEqual(['post:2', 'post:1', 'post:3']);
    expect(mergeActivity([a, b], 2)).toHaveLength(2);
  });

  it('breaks timestamp ties by key so server output is stable', () => {
    const at = '2026-09-10T10:00:00Z';
    expect(mergeActivity([[item('b', at)], [item('a', at)]], 5).map((i) => i.key)).toEqual(['a', 'b']);
  });
});

describe('merged comment keyset', () => {
  it('cursor round-trips and rejects garbage', () => {
    const raw = encodeCommentCursor({ createdAt: '2026-09-10T10:00:00.000Z', kind: 'topic_reply', id: 'abc123' });
    expect(decodeCommentCursor(raw)).toEqual({ at: new Date('2026-09-10T10:00:00.000Z'), kind: 'topic_reply', id: 'abc123' });
    for (const bad of ['', 'x', 'nope|post_comment|a', '2026-09-10T10:00:00Z|bogus|a', '2026-09-10T10:00:00Z|post_comment|a b', 'a|b|c|d']) {
      expect(decodeCommentCursor(bad)).toBeNull();
    }
  });

  // In-memory stand-in for the four tables, applying the SAME where fragment Prisma gets.
  function matches(row: { createdAt: Date; id: string }, where: CommentAfterWhere): boolean {
    const cmp = (c: { lt: Date } | { lte: Date }) =>
      'lt' in c ? row.createdAt.getTime() < c.lt.getTime() : row.createdAt.getTime() <= c.lte.getTime();
    if (where.createdAt && !cmp(where.createdAt)) return false;
    if (where.OR) {
      return where.OR.some((clause) =>
        clause.createdAt instanceof Date
          ? row.createdAt.getTime() === clause.createdAt.getTime() && row.id < (clause as { id: { lt: string } }).id.lt
          : cmp(clause.createdAt),
      );
    }
    return true;
  }

  it('pages through four tables with colliding timestamps without skipping or repeating a row', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 8, 1, 0, m));
    const tables: Record<ProfileCommentKind, { id: string; createdAt: Date }[]> = {
      post_comment: [
        { id: 'p1', createdAt: t(10) },
        { id: 'p2', createdAt: t(10) },
        { id: 'p3', createdAt: t(4) },
      ],
      topic_reply: [
        { id: 'r1', createdAt: t(10) },
        { id: 'r2', createdAt: t(7) },
      ],
      feedback_comment: [
        { id: 'f1', createdAt: t(10) },
        { id: 'f2', createdAt: t(1) },
        { id: 'f3', createdAt: t(7) },
      ],
      doc_comment: [{ id: 'd1', createdAt: t(4) }],
    };
    const toItem = (kind: ProfileCommentKind, r: { id: string; createdAt: Date }): ProfileCommentItem => ({
      key: `${kind}:${r.id}`,
      kind,
      id: r.id,
      excerpt: '',
      contextTitle: '',
      href: '',
      createdAt: r.createdAt.toISOString(),
    });
    const fetchPage = (cursorRaw: string | null, limit: number) => {
      const cursor = decodeCommentCursor(cursorRaw);
      const lists = COMMENT_KINDS.map((kind) =>
        tables[kind]
          .filter((r) => matches(r, commentAfterWhere(cursor, kind)))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(0, limit + 1)
          .map((r) => toItem(kind, r)),
      );
      return mergeCommentPages(lists, limit);
    };

    const all = mergeCommentPages(
      COMMENT_KINDS.map((kind) => tables[kind].map((r) => toItem(kind, r))),
      100,
    ).items.map((i) => i.key);
    expect(all).toHaveLength(9);

    for (const limit of [1, 2, 3, 4]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard++) {
        const page = fetchPage(cursor, limit);
        seen.push(...page.items.map((i) => i.key));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(all);
    }
  });

  it('no next cursor when everything fit', () => {
    const one: ProfileCommentItem = {
      key: 'post_comment:a',
      kind: 'post_comment',
      id: 'a',
      excerpt: '',
      contextTitle: '',
      href: '',
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    expect(mergeCommentPages([[one], [], [], []], 5).nextCursor).toBeNull();
  });
});

describe('pins', () => {
  const card = (kind: PinCardData['kind'], id: string): PinCardData => ({
    kind,
    id,
    href: `/${kind}/${id}`,
    title: id,
    excerpt: '',
    visual: { type: 'none' },
    figures: [],
    at: null,
    flag: null,
    context: null,
    eventTime: null,
  });

  it('every pin kind maps to a real profile section', () => {
    for (const kind of PIN_KINDS) expect(PROFILE_SECTIONS).toContain(PIN_KIND_SECTION[kind]);
  });

  it('keeps the member’s order and drops pins the gate did not return', () => {
    const pins = [
      { kind: 'doc' as const, id: 'd1' },
      { kind: 'skill' as const, id: 's1' },
      { kind: 'skill' as const, id: 'gone' },
      { kind: 'post' as const, id: 'p1' },
    ];
    const found = new Map([
      ['skill:s1', card('skill', 's1')],
      ['doc:d1', card('doc', 'd1')],
      ['post:p1', card('post', 'p1')],
    ]);
    expect(orderResolvedPins(pins, found, [...PROFILE_SECTIONS]).map((c) => c.id)).toEqual(['d1', 's1', 'p1']);
  });

  it('drops pins whose section this viewer may not see — and never queries them', () => {
    const pins = [
      { kind: 'short' as const, id: 'v1' },
      { kind: 'skill' as const, id: 's1' },
      { kind: 'zonePost' as const, id: 'z1' },
      { kind: 'skill' as const, id: 's2' },
    ];
    const anonymous = resolveProfileViewer({ sessionUser: null, profileUserId: OWNER, layout: parseProfileLayout(null) });
    const byKind = queryablePinIds(pins, anonymous.allowed);
    expect([...byKind.keys()]).toEqual(['skill']);
    expect(byKind.get('skill')).toEqual(['s1', 's2']);

    const found = new Map([
      ['short:v1', card('short', 'v1')],
      ['skill:s1', card('skill', 's1')],
    ]);
    expect(orderResolvedPins(pins, found, anonymous.allowed).map((c) => c.id)).toEqual(['s1']);
  });
});

describe('dead pins (deleted / no longer public items still stored)', () => {
  type P = { kind: 'skill' | 'doc'; id: string };
  const skill = (id: string): P => ({ kind: 'skill', id });
  const full = (): P[] => Array.from({ length: MAX_PINS }, (_, i) => skill(`s${i}`));
  const keys = (pins: readonly { kind: string; id: string }[]) => pins.map((p) => `${p.kind}:${p.id}`);

  it('pinning into a full list prunes the dead pins and then succeeds', () => {
    const res = applyPinWrite(full(), skill('new'), true, new Set(['skill:s1', 'skill:s4']));
    expect(res.error).toBeNull();
    expect(keys(res.pins)).toEqual(['skill:s0', 'skill:s2', 'skill:s3', 'skill:s5', 'skill:new']);
  });

  it('keeps dead pins while there is room — a re-processing doc must not lose its place to an unrelated click', () => {
    const current = [skill('a'), { kind: 'doc' as const, id: 'reprocessing' }];
    const res = applyPinWrite(current, skill('b'), true, new Set(['doc:reprocessing']));
    expect(res.error).toBeNull();
    expect(keys(res.pins)).toEqual(['skill:a', 'doc:reprocessing', 'skill:b']);
  });

  it('a full list with nothing dead is still pins_full, unchanged', () => {
    const res = applyPinWrite(full(), skill('new'), true, new Set());
    expect(res.error).toBe('pins_full');
    expect(samePins(res.pins, full())).toBe(true);
  });

  it('an unpin or a re-pin of a listed item never prunes anything', () => {
    const current = full();
    const dead = new Set(['skill:s1', 'skill:s2']);
    expect(samePins(applyPinWrite(current, skill('s2'), true, dead).pins, current)).toBe(true);
    expect(keys(applyPinWrite(current, skill('s0'), false, dead).pins)).toEqual(keys(current.slice(1)));
  });

  it('pruneDeadPins keeps order and ignores unknown keys', () => {
    expect(keys(pruneDeadPins([skill('a'), skill('b'), skill('c')], new Set(['skill:b', 'doc:zzz'])))).toEqual([
      'skill:a',
      'skill:c',
    ]);
  });

  describe('transactional writes', () => {
    const db = prisma as unknown as Record<string, unknown>;
    let stored: unknown = null;
    const upserts: unknown[] = [];

    function installFakeDb() {
      upserts.length = 0;
      const userProfile = {
        findUnique: async () => (stored === null ? null : { pins: stored }),
        upsert: async (args: { update: { pins: unknown } }) => {
          upserts.push(args.update.pins);
          stored = args.update.pins;
        },
      };
      db.userProfile = userProfile;
      db.$transaction = async (fn: (tx: unknown) => unknown) => fn({ userProfile });
    }

    it('persists the pruned list and reports the real pins on pin', async () => {
      stored = full();
      installFakeDb();
      const res = await setProfilePin('u1', skill('new'), true, new Set(['skill:s0']));
      expect(res.error).toBeNull();
      expect(keys(res.pins)).toEqual(['skill:s1', 'skill:s2', 'skill:s3', 'skill:s4', 'skill:s5', 'skill:new']);
      expect(upserts).toHaveLength(1);
    });

    it('清理 removes only the keys found dead and counts them', async () => {
      stored = [skill('a'), skill('dead'), skill('added-meanwhile')];
      installFakeDb();
      const res = await pruneProfilePins('u1', new Set(['skill:dead']));
      expect(res.removed).toBe(1);
      expect(keys(res.pins)).toEqual(['skill:a', 'skill:added-meanwhile']);
    });

    it('writes nothing when nothing changed (idempotent retry, unpin of an absent id)', async () => {
      stored = [skill('a')];
      installFakeDb();
      await setProfilePin('u1', skill('a'), true);
      await setProfilePin('u1', skill('nope'), false);
      expect(upserts).toHaveLength(0);
    });
  });
});

describe('postsFigure (hero strip: 动态 + 话题 share one slot)', () => {
  const counts = { posts: 0, topics: 3 };
  it('names the sum only when both sections are visible, and links to the tab with content', () => {
    expect(postsFigure(true, true, counts)).toEqual({ key: 'postsTopics', value: 3, tab: 'topics' });
    expect(postsFigure(true, true, { posts: 2, topics: 3 })).toEqual({ key: 'postsTopics', value: 5, tab: 'posts' });
    expect(postsFigure(true, true, { posts: 0, topics: 0 })?.tab).toBe('posts');
  });
  it('a single visible section is labelled as that section and counts only it', () => {
    expect(postsFigure(true, false, { posts: 2, topics: 3 })).toEqual({ key: 'posts', value: 2, tab: 'posts' });
    expect(postsFigure(false, true, { posts: 2, topics: 3 })).toEqual({ key: 'topics', value: 3, tab: 'topics' });
    expect(postsFigure(false, false, counts)).toBeNull();
  });
});

describe('discussion excerptOf', () => {
  it('strips 站内引用 embed tokens (plain and escaped) and poll tokens', () => {
    const md = 'Intro line\n\n[embed:library:abc123]\n\n\\[embed:skill:my-skill\\]\n\n[poll:abcdefgh12]\n\nOutro';
    expect(excerptOf(md)).toBe('Intro line Outro');
  });

  it('strips raw HTML tags but keeps their text and link labels', () => {
    expect(excerptOf('<p>Hello <b>world</b></p> see [the docs](https://x.test)')).toBe('Hello world see the docs');
  });

  it('keeps the existing behaviour for ordinary markdown', () => {
    expect(excerptOf('# Title\n\n- **bold** item\n\n```js\ncode()\n```\n![img](/a.png) done')).toBe('Title bold item done');
    expect(excerptOf('一二三四五六', 3)).toBe('一二三…');
  });
});

describe('profileHref', () => {
  it('the default tab carries no param and 访客视角 survives navigation', () => {
    expect(profileHref('alice')).toBe('/users/alice');
    expect(profileHref('alice', { tab: 'overview' })).toBe('/users/alice');
    expect(profileHref('alice', { tab: 'skills', page: 2 })).toBe('/users/alice?tab=skills&page=2');
    expect(profileHref('alice', { tab: 'zones', cursor: '2026-09-01T00:00:00.000Z|abc', visitor: true })).toBe(
      '/users/alice?tab=zones&cursor=2026-09-01T00%3A00%3A00.000Z%7Cabc&as=visitor',
    );
    expect(profileHref('alice', { page: 1, visitor: false })).toBe('/users/alice');
  });

  it('视频 keeps both pagers’ positions: long videos on ?page=, shorts on ?cursor=', () => {
    expect(profileHref('alice', { tab: 'videos', page: 3, cursor: 'c1' })).toBe('/users/alice?tab=videos&page=3&cursor=c1');
  });
});
