import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  employeeDirectory: { findMany: vi.fn() },
  user: { findMany: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  accountMatchKey,
  buildUserAccountIndex,
  canonicalAccountText,
  findDirectoryEntries,
  linkedAccountKeys,
  sameAccount,
  syncAllEntriesToUsers,
  syncDirectoryToUserAtLogin,
  syncEntryToUsers,
} from '@/lib/employee-directory';
import { normalizeAccountNumber } from '@/lib/employee-admin';

beforeEach(() => {
  db.employeeDirectory.findMany.mockReset();
  db.user.findMany.mockReset();
  db.user.updateMany.mockReset();
});

describe('accountMatchKey', () => {
  it('keys a W3 account and the bare employee number identically', () => {
    expect(accountMatchKey('z84412632')).toBe('84412632');
    expect(accountMatchKey('Z84412632')).toBe('84412632');
    expect(accountMatchKey('84412632')).toBe('84412632');
    expect(accountMatchKey('  z84412632 \n')).toBe('84412632');
  });

  it('keeps leading zeros — keys are strings, never numbers', () => {
    expect(accountMatchKey('l00412632')).toBe('00412632');
    expect(accountMatchKey('00412632')).not.toBe(accountMatchKey('412632'));
  });

  it('keeps contractor-style numbers apart from employee numbers', () => {
    expect(accountMatchKey('zwx1234567')).toBe('1234567');
    expect(accountMatchKey('zwx1234567')).not.toBe(accountMatchKey('z01234567'));
  });

  it('folds fullwidth letters/digits (NFKC) and ignores whitespace', () => {
    expect(accountMatchKey('ｚ８４４１２６３２')).toBe('84412632');
    expect(accountMatchKey('8441 2632')).toBe('84412632');
    expect(accountMatchKey('Test Acct')).toBe('testacct');
  });

  it('falls back to lowercased text for digit-less values', () => {
    expect(accountMatchKey('TestAccount')).toBe('testaccount');
    expect(accountMatchKey('testaccount')).toBe('testaccount');
  });

  it('is null for blank input', () => {
    expect(accountMatchKey('')).toBeNull();
    expect(accountMatchKey('   ')).toBeNull();
    expect(accountMatchKey(null)).toBeNull();
    expect(accountMatchKey(undefined)).toBeNull();
  });
});

describe('sameAccount', () => {
  it('matches across letter prefix and case', () => {
    expect(sameAccount('z84412632', '84412632')).toBe(true);
    expect(sameAccount('Z84412632', 'z84412632')).toBe(true);
    expect(sameAccount('abc', 'ABC')).toBe(true);
  });

  it('never matches blanks or different numbers', () => {
    expect(sameAccount('', '')).toBe(false);
    expect(sameAccount(null, null)).toBe(false);
    expect(sameAccount('z84412632', 'z84412633')).toBe(false);
    expect(sameAccount('123', 'abc')).toBe(false);
  });
});

const row = (over: Record<string, unknown>) => ({
  id: 'id',
  name: '张三',
  accountNumber: null as string | null,
  department: '',
  lab: '',
  avatarUrl: '',
  isActive: true,
  createdById: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
});

describe('findDirectoryEntries', () => {
  it('pre-filters by digits with contains and re-checks the key exactly', async () => {
    db.employeeDirectory.findMany.mockResolvedValue([
      row({ id: 'a', accountNumber: 'z84412632' }),
      row({ id: 'noise', accountNumber: 'z184412632' }), // contains but digits differ
    ]);
    const found = await findDirectoryEntries('84412632');
    expect(db.employeeDirectory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountNumber: { contains: '84412632' } } }),
    );
    expect(found.map((e) => e.id)).toEqual(['a']);
  });

  it('orders legacy duplicates most-recently-updated first (the same winner 全量同步 picks)', async () => {
    db.employeeDirectory.findMany.mockResolvedValue([
      row({ id: 'new-letter', accountNumber: 'z84412632', updatedAt: new Date('2026-03-01') }),
      row({ id: 'old-exact', accountNumber: '84412632', updatedAt: new Date('2026-01-01') }),
    ]);
    const found = await findDirectoryEntries('84412632');
    expect(db.employeeDirectory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] }),
    );
    expect(found.map((e) => e.id)).toEqual(['new-letter', 'old-exact']);
  });

  it('uses an insensitive equality for digit-less keys and honors activeOnly', async () => {
    db.employeeDirectory.findMany.mockResolvedValue([row({ id: 'a', accountNumber: 'testacct' })]);
    await findDirectoryEntries('TestAcct', { activeOnly: true });
    expect(db.employeeDirectory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountNumber: { equals: 'testacct', mode: 'insensitive' }, isActive: true },
      }),
    );
  });

  it('returns nothing for a blank 工号 without touching the DB', async () => {
    expect(await findDirectoryEntries('')).toEqual([]);
    expect(await findDirectoryEntries(null)).toEqual([]);
    expect(db.employeeDirectory.findMany).not.toHaveBeenCalled();
  });
});

describe('syncEntryToUsers', () => {
  const entry = { accountNumber: 'z84412632', department: '计算产品线', lab: '昇腾所', isActive: true };

  it('updates users whose bare uid matches the digits of the roster 工号', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'u1', huaweiW3Id: '84412632' },
      { id: 'u2', huaweiW3Id: '184412632' }, // contains-prefilter noise
    ]);
    db.user.updateMany.mockResolvedValue({ count: 1 });
    expect(await syncEntryToUsers(entry)).toBe(1);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { huaweiW3Id: { contains: '84412632' } } }),
    );
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1'] } },
      data: { department: '计算产品线', lab: '昇腾所' },
    });
  });

  it('writes nothing when no user matches', async () => {
    db.user.findMany.mockResolvedValue([]);
    expect(await syncEntryToUsers(entry)).toBe(0);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it('skips inactive entries and blank 工号', async () => {
    expect(await syncEntryToUsers({ ...entry, isActive: false })).toBe(0);
    expect(await syncEntryToUsers({ ...entry, accountNumber: null })).toBe(0);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('clears department/lab when the roster values are empty', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'u1', huaweiW3Id: '84412632' }]);
    db.user.updateMany.mockResolvedValue({ count: 1 });
    await syncEntryToUsers({ ...entry, department: '', lab: '' });
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { department: null, lab: null } }),
    );
  });

  it('uses a prebuilt index instead of querying users', async () => {
    const index = new Map([['84412632', ['u1', 'u9']]]);
    db.user.updateMany.mockResolvedValue({ count: 2 });
    expect(await syncEntryToUsers(entry, index)).toBe(2);
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['u1', 'u9'] } } }),
    );
  });
});

describe('buildUserAccountIndex / syncAllEntriesToUsers', () => {
  it('indexes users by key and applies entries oldest-updated first', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'u1', huaweiW3Id: '84412632' },
      { id: 'u2', huaweiW3Id: 'Z84412632' },
      { id: 'u3', huaweiW3Id: '00000001' },
    ]);
    const index = await buildUserAccountIndex();
    expect(index.get('84412632')).toEqual(['u1', 'u2']);
    expect(index.get('00000001')).toEqual(['u3']);

    db.employeeDirectory.findMany.mockResolvedValue([
      { accountNumber: 'z84412632', department: 'A', lab: '', isActive: true },
      { accountNumber: 'z99999999', department: 'B', lab: '', isActive: true }, // no user
    ]);
    db.user.updateMany.mockResolvedValue({ count: 2 });
    const result = await syncAllEntriesToUsers();
    expect(db.employeeDirectory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ updatedAt: 'asc' }, { id: 'desc' }] }),
    );
    expect(result).toEqual({ entriesWithAccount: 2, usersUpdated: 2 });
    expect(db.user.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('canonicalAccountText / normalizeAccountNumber', () => {
  it('stores an ASCII, whitespace-free, lowercase spelling but keeps the letter prefix', () => {
    expect(canonicalAccountText('  Ｚ８４４１ ２６３２ ')).toBe('z84412632');
    expect(normalizeAccountNumber('  Ｚ８４４１ ２６３２ ')).toBe('z84412632');
    expect(normalizeAccountNumber('Z84412632')).toBe('z84412632');
    expect(normalizeAccountNumber('   ')).toBeNull();
    expect(normalizeAccountNumber(undefined)).toBeNull();
  });

  it('stored form and query form agree, so the digits prefilter finds a fullwidth import', async () => {
    db.employeeDirectory.findMany.mockResolvedValue([
      row({ id: 'a', accountNumber: normalizeAccountNumber('ｚ８４４１２６３２') }),
    ]);
    expect((await findDirectoryEntries('84412632')).map((e) => e.id)).toEqual(['a']);
  });
});

describe('syncDirectoryToUserAtLogin', () => {
  it('finds the active roster row by digits and pushes 部门/研究所 onto the matching user', async () => {
    db.employeeDirectory.findMany.mockResolvedValue([
      row({ id: 'e', accountNumber: 'z84412632', department: '计算产品线', lab: '昇腾所' }),
    ]);
    db.user.findMany.mockResolvedValue([{ id: 'u1', huaweiW3Id: '84412632' }]);
    db.user.updateMany.mockResolvedValue({ count: 1 });
    await syncDirectoryToUserAtLogin(['84412632']);
    expect(db.employeeDirectory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountNumber: { contains: '84412632' }, isActive: true } }),
    );
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1'] } },
      data: { department: '计算产品线', lab: '昇腾所' },
    });
  });

  it('stops at the first candidate that has a roster row', async () => {
    db.employeeDirectory.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ id: 'e', accountNumber: '2' })]);
    db.user.findMany.mockResolvedValue([{ id: 'u', huaweiW3Id: '2' }]);
    db.user.updateMany.mockResolvedValue({ count: 1 });
    await syncDirectoryToUserAtLogin(['1', '2', '3']);
    expect(db.employeeDirectory.findMany).toHaveBeenCalledTimes(2);
    expect(db.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('never throws — a DB failure is logged and the login proceeds', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.employeeDirectory.findMany.mockRejectedValue(new Error('db down'));
    await expect(syncDirectoryToUserAtLogin(['84412632'])).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does nothing for blank candidates', async () => {
    await syncDirectoryToUserAtLogin([null, undefined, '  ']);
    expect(db.employeeDirectory.findMany).not.toHaveBeenCalled();
  });
});

describe('linkedAccountKeys', () => {
  it('returns the keys that have a registered user, via one OR-prefiltered query', async () => {
    db.user.findMany.mockResolvedValue([
      { huaweiW3Id: '84412632' },
      { huaweiW3Id: '184412632' }, // prefilter noise, not a wanted key
    ]);
    const linked = await linkedAccountKeys(['z84412632', 'L00412632', null, '']);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ huaweiW3Id: { contains: '84412632' } }, { huaweiW3Id: { contains: '00412632' } }] },
      }),
    );
    expect(linked).toEqual(new Set(['84412632']));
  });

  it('skips the query when nothing has a 工号', async () => {
    expect(await linkedAccountKeys([null, ''])).toEqual(new Set());
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
