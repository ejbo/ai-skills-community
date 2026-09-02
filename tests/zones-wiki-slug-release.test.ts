// Wiki slugs are unique per zone among LIVE pages. `@@unique([zoneId, slug])`
// also counts soft-deleted rows, so a slug a deleted row still holds — a row
// deleted before `deleteWikiPage` started renaming on delete, on any deployed
// DB — must be released INSIDE the write transaction, or the fixed-slug 版规
// page (`rules`) could never be recreated. Pinned with an in-memory prisma that
// enforces the unique index the way Postgres does (P2002).
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Page {
  id: string;
  zoneId: string;
  slug: string;
  title: string;
  bodyMd: string;
  parentId: string | null;
  sortOrder: number;
  createdById: string;
  updatedById: string;
  revisionCount: number;
  deletedAt: Date | null;
}

const db = vi.hoisted(() => {
  const state: { pages: Page[]; revisions: number; seq: number } = { pages: [], revisions: 0, seq: 0 };
  type Where = Partial<{
    id: string | { not: string };
    zoneId: string;
    slug: string;
    parentId: string | null;
    deletedAt: null | { not: null };
  }>;
  const matches = (p: Page, w: Where) => {
    if (w.id !== undefined) {
      if (typeof w.id === 'string' ? p.id !== w.id : p.id === w.id.not) return false;
    }
    if (w.zoneId !== undefined && p.zoneId !== w.zoneId) return false;
    if (w.slug !== undefined && p.slug !== w.slug) return false;
    if (w.parentId !== undefined && p.parentId !== w.parentId) return false;
    if (w.deletedAt !== undefined) {
      if (w.deletedAt === null ? p.deletedAt !== null : p.deletedAt === null) return false;
    }
    return true;
  };
  const unique = (zoneId: string, slug: string, exceptId?: string) => {
    if (state.pages.some((p) => p.zoneId === zoneId && p.slug === slug && p.id !== exceptId)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on (zoneId, slug)', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }
  };
  const zoneWikiPage = {
    findFirst: vi.fn(async ({ where }: { where: Where }) => state.pages.find((p) => matches(p, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Where }) => state.pages.filter((p) => matches(p, where))),
    count: vi.fn(async ({ where }: { where: Where }) => state.pages.filter((p) => matches(p, where)).length),
    create: vi.fn(async ({ data }: { data: Omit<Page, 'id' | 'deletedAt'> }) => {
      unique(data.zoneId, data.slug);
      const page: Page = { ...data, id: `page${++state.seq}`, deletedAt: null };
      state.pages.push(page);
      return page;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Page> & { revisionCount?: unknown } }) => {
      const page = state.pages.find((p) => p.id === where.id);
      if (!page) throw new Error('not found');
      if (data.slug !== undefined) unique(page.zoneId, data.slug, page.id);
      const { revisionCount, ...rest } = data;
      Object.assign(page, rest);
      if (revisionCount && typeof revisionCount === 'object') page.revisionCount += 1;
      return page;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Page> }) => {
      const hits = state.pages.filter((p) => matches(p, where));
      for (const p of hits) {
        if (data.slug !== undefined) unique(p.zoneId, data.slug, p.id);
        Object.assign(p, data);
      }
      return { count: hits.length };
    }),
  };
  const zoneWikiRevision = { create: vi.fn(async () => ({ id: `rev${++state.revisions}` })) };
  const client = { zoneWikiPage, zoneWikiRevision };
  return {
    state,
    ...client,
    $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
  };
});

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/zones/embeds', () => ({ resolveEmbeds: vi.fn(async () => ({})) }));
vi.mock('@/lib/zones/queries', async () => ({ ZoneError: (await import('@/lib/zones/errors')).ZoneError }));

import { createWikiPage, deleteWikiPage, updateWikiPage } from '@/lib/zones/wiki-queries';

const ZONE = 'zone1';

function seed(over: Partial<Page> & { slug: string }): Page {
  const page: Page = {
    id: `seed${++db.state.seq}`,
    zoneId: ZONE,
    title: over.slug,
    bodyMd: '',
    parentId: null,
    sortOrder: 0,
    createdById: 'u1',
    updatedById: 'u1',
    revisionCount: 1,
    deletedAt: null,
    ...over,
  };
  db.state.pages.push(page);
  return page;
}

const slugs = () => db.state.pages.map((p) => `${p.slug}${p.deletedAt ? ' (deleted)' : ''}`);

beforeEach(() => {
  db.state.pages = [];
  db.state.revisions = 0;
  db.state.seq = 0;
  vi.clearAllMocks();
});

describe('wiki slug release', () => {
  it('a slug held only by a LEGACY soft-deleted row is handed to the new page and the old row renamed', async () => {
    const legacy = seed({ slug: 'rules', deletedAt: new Date('2026-08-01') });
    const created = await createWikiPage(ZONE, { title: '版规', slug: 'rules', bodyMd: '## 1' }, 'u2');
    expect(created.slug).toBe('rules');
    expect(legacy.slug).toBe(`rules~del-${legacy.id.slice(-8)}`);
    expect(legacy.deletedAt).not.toBeNull();
    expect(slugs()).toEqual([`rules~del-${legacy.id.slice(-8)} (deleted)`, 'rules']);
  });

  it('a LIVE page still gets the -2 suffix, and is never touched', async () => {
    seed({ slug: 'rules' });
    const created = await createWikiPage(ZONE, { title: '版规', slug: 'rules', bodyMd: '' }, 'u2');
    expect(created.slug).toBe('rules-2');
    expect(slugs()).toEqual(['rules', 'rules-2']);
  });

  it('delete → recreate lands on the same slug (the delete already renamed the row)', async () => {
    const first = await createWikiPage(ZONE, { title: '版规', slug: 'rules', bodyMd: '' }, 'u2');
    await deleteWikiPage(first.id);
    expect(slugs()).toEqual([`rules~del-${first.id.slice(-8)} (deleted)`]);
    const again = await createWikiPage(ZONE, { title: '版规', slug: 'rules', bodyMd: '' }, 'u2');
    expect(again.slug).toBe('rules');
    expect(again.id).not.toBe(first.id);
  });

  it('an auto slug from the title releases a legacy row too', async () => {
    const legacy = seed({ slug: 'hello-world', deletedAt: new Date() });
    const created = await createWikiPage(ZONE, { title: 'Hello World', bodyMd: '' }, 'u2');
    expect(created.slug).toBe('hello-world');
    expect(legacy.slug).toMatch(/^hello-world~del-/);
  });

  it('renaming a page onto a legacy-deleted slug releases it; onto a live slug is wiki_slug_taken', async () => {
    const page = seed({ slug: 'draft' });
    const legacy = seed({ slug: 'guide', deletedAt: new Date() });
    await updateWikiPage(page.id, { slug: 'guide' }, 'u2');
    expect(page.slug).toBe('guide');
    expect(legacy.slug).toMatch(/^guide~del-/);

    seed({ slug: 'taken' });
    await expect(updateWikiPage(page.id, { slug: 'taken' }, 'u2')).rejects.toMatchObject({ code: 'wiki_slug_taken', status: 409 });
    expect(page.slug).toBe('guide');
  });

  it('the release happens INSIDE the write transaction, before the row is written', async () => {
    seed({ slug: 'rules', deletedAt: new Date() });
    await createWikiPage(ZONE, { title: '版规', slug: 'rules', bodyMd: '' }, 'u2');
    const order = [...db.zoneWikiPage.update.mock.invocationCallOrder, ...db.zoneWikiPage.create.mock.invocationCallOrder];
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.zoneWikiPage.update).toHaveBeenCalledTimes(1);
    expect(order[0]).toBeLessThan(order[1]);
  });
});
