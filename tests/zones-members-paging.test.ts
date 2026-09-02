import { describe, expect, it } from 'vitest';
import {
  appendMembersPage,
  canLoadMoreMembers,
  dropMember,
  initialMembersPage,
  prependMember,
  replaceMember,
} from '@/app/zones/_components/members-paging';

type Row = { id: string; userId: string; name: string };
const row = (n: number, name = `m${n}`): Row => ({ id: `id${n}`, userId: `u${n}`, name });
const rows = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));

describe('members directory paging state', () => {
  it('starts with page 1 as the offset', () => {
    const s = initialMembersPage(rows(1, 3));
    expect(s.loaded).toBe(3);
    expect(s.exhausted).toBe(false);
    expect(s.appended).toBe(false);
    expect(canLoadMoreMembers(s, 10)).toBe(true);
    expect(canLoadMoreMembers(s, 3)).toBe(false);
  });

  it('appends unseen rows and advances the offset by what the server sent', () => {
    const s = appendMembersPage(initialMembersPage(rows(1, 3)), [row(3), row(4), row(5)]);
    expect(s.items.map((m) => m.id)).toEqual(['id1', 'id2', 'id3', 'id4', 'id5']);
    expect(s.loaded).toBe(6);
    expect(s.appended).toBe(true);
    expect(s.exhausted).toBe(false);
  });

  it('an empty page marks the stream exhausted whatever the total says', () => {
    const s = appendMembersPage(initialMembersPage(rows(1, 3)), []);
    expect(s.exhausted).toBe(true);
    expect(s.appended).toBe(false);
    expect(canLoadMoreMembers(s, 99)).toBe(false);
  });

  it('添加成员 prepends locally WITHOUT moving the server offset (the old items.length skip lost a member)', () => {
    const s = prependMember(initialMembersPage(rows(1, 3)), row(9, 'new'));
    expect(s.items[0].id).toBe('id9');
    expect(s.items).toHaveLength(4);
    // The server sorts the new member last: skip stays 3, so row 4 is still fetched.
    expect(s.loaded).toBe(3);
    const next = appendMembersPage(s, [row(4), row(9, 'new')]);
    expect(next.items.map((m) => m.id)).toEqual(['id9', 'id1', 'id2', 'id3', 'id4']);
    expect(next.loaded).toBe(5);
  });

  it('re-adding an existing member keeps a single row', () => {
    const s = prependMember(initialMembersPage(rows(1, 3)), row(2, 'renamed'));
    expect(s.items.map((m) => m.id)).toEqual(['id2', 'id1', 'id3']);
    expect(s.items[0].name).toBe('renamed');
    expect(s.loaded).toBe(3);
  });

  it('dropping a row steps the offset back with the shrunk server list', () => {
    const s = dropMember(initialMembersPage(rows(1, 3)), 'u2');
    expect(s.items.map((m) => m.id)).toEqual(['id1', 'id3']);
    expect(s.loaded).toBe(2);
    // Unknown rows change nothing.
    expect(dropMember(s, 'nobody')).toBe(s);
  });

  it('replace keeps order and offset', () => {
    const s = replaceMember(initialMembersPage(rows(1, 3)), row(2, 'edited'));
    expect(s.items.map((m) => m.name)).toEqual(['m1', 'edited', 'm3']);
    expect(s.loaded).toBe(3);
  });

  it('a 60-row page followed by an add still reaches every member and stops', () => {
    // 61 members on the server, page size 60: the old skip=items.length after a
    // prepend asked for skip=61 and never saw member 61.
    let s = initialMembersPage(rows(1, 60));
    s = prependMember(s, row(99, 'added'));
    expect(canLoadMoreMembers(s, 62)).toBe(true);
    s = appendMembersPage(s, [row(61), row(99, 'added')]);
    expect(s.items.some((m) => m.id === 'id61')).toBe(true);
    expect(s.loaded).toBe(62);
    expect(canLoadMoreMembers(s, 62)).toBe(false);
  });
});
