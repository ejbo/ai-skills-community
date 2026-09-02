import { describe, expect, it } from 'vitest';
import {
  mayReadLibraryDoc,
  mayReadZonePost,
  type MentionCandidate,
  type ZoneMentionFacts,
} from '@/lib/mention-access';

// A mention must never notify someone who cannot READ the thing it lives in:
// the notification title carries the post/doc title, and the deep link would
// 404 anyway. These are the pure halves of the gates in lib/mention-notify.ts.

function person(id: string, role?: { roleKey: string; permissions: string[] }): MentionCandidate {
  return {
    id,
    handle: id,
    roleKey: role?.roleKey ?? 'member',
    permissions: role?.permissions ?? [],
  };
}

const SITE_ZONE_ADMIN = { roleKey: 'admin', permissions: ['zones'] };
const SUPER_ADMIN = { roleKey: 'super_admin', permissions: ['*'] };
const LIBRARY_MANAGER = { roleKey: 'admin', permissions: ['library'] };

function zoneFacts(over: Partial<ZoneMentionFacts> = {}): ZoneMentionFacts {
  return {
    zone: { ownerId: 'owner', visibility: 'public' },
    post: { authorId: 'author', coauthorIds: [], status: 'published', deletedAt: null, visibility: 'zone' },
    memberPermissions: new Map(),
    grantedIds: new Set(),
    ...over,
  };
}

describe('mayReadZonePost', () => {
  it('lets any member read a zone-wide post in a public zone', () => {
    expect(mayReadZonePost(person('stranger'), zoneFacts())).toBe(true);
  });

  it('hides a members-only ZONE from a non-member', () => {
    const facts = zoneFacts({ zone: { ownerId: 'owner', visibility: 'members' } });
    expect(mayReadZonePost(person('stranger'), facts)).toBe(false);
    expect(
      mayReadZonePost(person('joined'), {
        ...facts,
        memberPermissions: new Map([['joined', ['comment']]]),
      }),
    ).toBe(true);
  });

  it('hides a members-only POST inside a public zone from a non-member', () => {
    const facts = zoneFacts({
      post: {
        authorId: 'author',
        coauthorIds: [],
        status: 'published',
        deletedAt: null,
        visibility: 'members',
      },
    });
    expect(mayReadZonePost(person('stranger'), facts)).toBe(false);
    expect(
      mayReadZonePost(person('joined'), {
        ...facts,
        memberPermissions: new Map([['joined', ['comment']]]),
      }),
    ).toBe(true);
  });

  it('keeps a restricted post silent until the person actually holds a grant', () => {
    const facts = zoneFacts({
      post: {
        authorId: 'author',
        coauthorIds: [],
        status: 'published',
        deletedAt: null,
        visibility: 'restricted',
      },
      memberPermissions: new Map([
        ['ungranted', ['comment']],
        ['granted', ['comment']],
      ]),
      grantedIds: new Set(['granted']),
    });
    // `locked` (the 提取码 stub) is NOT readable — no ping.
    expect(mayReadZonePost(person('ungranted'), facts)).toBe(false);
    expect(mayReadZonePost(person('granted'), facts)).toBe(true);
  });

  it('always reaches the author, co-authors, the 主版主 and 版主 of the zone', () => {
    const facts = zoneFacts({
      zone: { ownerId: 'owner', visibility: 'members' },
      post: {
        authorId: 'author',
        coauthorIds: ['coauthor'],
        status: 'published',
        deletedAt: null,
        visibility: 'restricted',
      },
      memberPermissions: new Map([['mod', ['comment', 'moderate']]]),
    });
    expect(mayReadZonePost(person('author'), facts)).toBe(true);
    expect(mayReadZonePost(person('coauthor'), facts)).toBe(true);
    expect(mayReadZonePost(person('owner'), facts)).toBe(true);
    expect(mayReadZonePost(person('mod'), facts)).toBe(true);
  });

  it('lets the site `zones` permission through a members-only zone', () => {
    const facts = zoneFacts({ zone: { ownerId: 'owner', visibility: 'members' } });
    expect(mayReadZonePost(person('staff', SITE_ZONE_ADMIN), facts)).toBe(true);
    expect(mayReadZonePost(person('root', SUPER_ADMIN), facts)).toBe(true);
    // A DIFFERENT domain permission is not a zone bypass (permissions are orthogonal).
    expect(mayReadZonePost(person('vids', { roleKey: 'admin', permissions: ['videos'] }), facts)).toBe(
      false,
    );
  });

  it('says nothing about a draft or a soft-deleted post', () => {
    const draft = zoneFacts({
      post: { authorId: 'author', coauthorIds: [], status: 'draft', deletedAt: null, visibility: 'zone' },
    });
    expect(mayReadZonePost(person('stranger'), draft)).toBe(false);
    const removed = zoneFacts({
      post: {
        authorId: 'author',
        coauthorIds: [],
        status: 'published',
        deletedAt: new Date(),
        visibility: 'zone',
      },
    });
    expect(mayReadZonePost(person('stranger'), removed)).toBe(false);
  });
});

describe('mayReadLibraryDoc', () => {
  const doc = (visibility: string) => ({ id: 'doc1', uploaderId: 'uploader', visibility });
  const none = new Set<string>();

  it('opens a public doc to every member', () => {
    expect(mayReadLibraryDoc(person('anyone'), doc('public'), none)).toBe(true);
  });

  it('keeps a private doc to its uploader (and 知识库 managers)', () => {
    expect(mayReadLibraryDoc(person('anyone'), doc('private'), none)).toBe(false);
    expect(mayReadLibraryDoc(person('uploader'), doc('private'), none)).toBe(true);
    expect(mayReadLibraryDoc(person('staff', LIBRARY_MANAGER), doc('private'), none)).toBe(true);
  });

  it('admits a restricted doc only on an APPROVED access request', () => {
    const approved = new Set(['approved']);
    expect(mayReadLibraryDoc(person('pending'), doc('restricted'), approved)).toBe(false);
    expect(mayReadLibraryDoc(person('approved'), doc('restricted'), approved)).toBe(true);
  });

  it('does not treat an unrelated domain permission as library access', () => {
    const holder = person('mod', { roleKey: 'admin', permissions: ['discussion', 'identity'] });
    expect(mayReadLibraryDoc(holder, doc('private'), none)).toBe(false);
  });
});
