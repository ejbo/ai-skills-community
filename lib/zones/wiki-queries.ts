// 技术专区 Wiki — page tree + revisions.
//
// Pages form a tree (parentId / sortOrder), slugs are unique per zone (a
// collision gets a `-2`, `-3`… suffix), every content save snapshots title +
// body into ZoneWikiRevision (restore = save the snapshot again with a note),
// deletes are soft and re-parent the children so no page is orphaned.
// Embeds in the body resolve exactly like post bodies (lib/zones/embeds.ts).

import { Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import type { Session } from 'next-auth';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import type { ZoneSiteViewer } from './access';
import { resolveEmbeds } from './embeds';
import { ZoneError } from './queries';
import { ZONE_LIMITS, collectEmbedRefs, extractHeadings, isValidWikiSlug, slugifyAscii } from './shared';
import type { WikiPageView, WikiRevisionView, WikiTreeNode } from './types';

const WIKI_SLUG_MAX = 60;
const randomSlugPart = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

function iso(d: Date): string {
  return d.toISOString();
}

// ── Tree ─────────────────────────────────────────────────────────────────────

const TREE_SELECT = {
  id: true,
  slug: true,
  title: true,
  parentId: true,
  sortOrder: true,
  updatedAt: true,
} satisfies Prisma.ZoneWikiPageSelect;

type TreeRow = Prisma.ZoneWikiPageGetPayload<{ select: typeof TREE_SELECT }>;

function buildTree(rows: TreeRow[]): WikiTreeNode[] {
  const nodes = new Map<string, WikiTreeNode>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      slug: r.slug,
      title: r.title,
      parentId: r.parentId,
      sortOrder: r.sortOrder,
      updatedAt: iso(r.updatedAt),
      children: [],
    });
  }
  const roots: WikiTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    // A parent that is deleted / missing promotes the child to the root level.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byOrder = (a: WikiTreeNode, b: WikiTreeNode) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
  const sortDeep = (list: WikiTreeNode[]) => {
    list.sort(byOrder);
    for (const n of list) sortDeep(n.children);
  };
  sortDeep(roots);
  return roots;
}

export async function getWikiTree(zoneId: string): Promise<WikiTreeNode[]> {
  const rows = await prisma.zoneWikiPage.findMany({
    where: { zoneId, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    select: TREE_SELECT,
  });
  return buildTree(rows);
}

export function countWikiPages(zoneId: string): Promise<number> {
  return prisma.zoneWikiPage.count({ where: { zoneId, deletedAt: null } });
}

// ── Pages ────────────────────────────────────────────────────────────────────

const PAGE_SELECT = {
  id: true,
  zoneId: true,
  slug: true,
  title: true,
  bodyMd: true,
  parentId: true,
  sortOrder: true,
  revisionCount: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdBy: AUTHOR_IDENTITY_SELECT,
  updatedBy: AUTHOR_IDENTITY_SELECT,
} satisfies Prisma.ZoneWikiPageSelect;

type PageRow = Prisma.ZoneWikiPageGetPayload<{ select: typeof PAGE_SELECT }>;

export interface WikiPageContext {
  viewer: ZoneSiteViewer;
  session?: Session | null;
  locale?: string;
}

async function toPageView(row: PageRow, ctx: WikiPageContext): Promise<WikiPageView> {
  const embeds = await resolveEmbeds(collectEmbedRefs(row.bodyMd), {
    viewer: ctx.viewer,
    session: ctx.session ?? null,
    locale: ctx.locale,
  });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bodyMd: row.bodyMd,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    revisionCount: row.revisionCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    createdBy: toPublicAuthor(row.createdBy, ctx.viewer.canSeeIdentity),
    updatedBy: toPublicAuthor(row.updatedBy, ctx.viewer.canSeeIdentity),
    headings: extractHeadings(row.bodyMd),
    embeds,
  };
}

export async function getWikiPage(zoneId: string, slug: string, ctx: WikiPageContext): Promise<WikiPageView | null> {
  const row = await prisma.zoneWikiPage.findFirst({ where: { zoneId, slug, deletedAt: null }, select: PAGE_SELECT });
  return row ? toPageView(row, ctx) : null;
}

export async function getWikiPageById(pageId: string, ctx: WikiPageContext): Promise<WikiPageView | null> {
  const row = await prisma.zoneWikiPage.findFirst({ where: { id: pageId, deletedAt: null }, select: PAGE_SELECT });
  return row ? toPageView(row, ctx) : null;
}

// ── Input ────────────────────────────────────────────────────────────────────

export interface WikiPageInput {
  title: string;
  slug?: string;
  bodyMd: string;
  parentId?: string | null;
  note?: string;
}

export const wikiPageInputSchema = z.object({
  title: z.string().trim().min(1).max(ZONE_LIMITS.wikiTitleMax),
  slug: z.string().trim().max(WIKI_SLUG_MAX).optional(),
  bodyMd: z.string().max(ZONE_LIMITS.wikiBodyMax).default(''),
  parentId: z.string().min(1).max(64).nullable().optional(),
  note: z.string().trim().max(ZONE_LIMITS.wikiNoteMax).optional(),
}) satisfies z.ZodType<WikiPageInput, z.ZodTypeDef, unknown>;

// ── Slug / parent helpers ────────────────────────────────────────────────────

async function uniqueWikiSlug(zoneId: string, base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  for (let n = 2; n < 200; n++) {
    const clash = await prisma.zoneWikiPage.findFirst({
      where: { zoneId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    const suffix = `-${n}`;
    candidate = `${base.slice(0, WIKI_SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
  return `page-${randomSlugPart()}`;
}

function slugBaseFor(input: { slug?: string; title: string }): string {
  const explicit = (input.slug ?? '').trim().toLowerCase();
  if (explicit) {
    if (!isValidWikiSlug(explicit)) throw new ZoneError('wiki_slug_invalid', 400);
    return explicit;
  }
  const auto = slugifyAscii(input.title, WIKI_SLUG_MAX);
  return auto && isValidWikiSlug(auto) ? auto : `page-${randomSlugPart()}`;
}

async function assertParentInZone(zoneId: string, parentId: string): Promise<{ id: string; parentId: string | null }> {
  const parent = await prisma.zoneWikiPage.findFirst({
    where: { id: parentId, zoneId, deletedAt: null },
    select: { id: true, parentId: true },
  });
  if (!parent) throw new ZoneError('wiki_parent_invalid', 400);
  return parent;
}

/** True when `candidateParentId` is `pageId` itself or one of its descendants. */
async function wouldCycle(zoneId: string, pageId: string, candidateParentId: string): Promise<boolean> {
  if (candidateParentId === pageId) return true;
  const rows = await prisma.zoneWikiPage.findMany({
    where: { zoneId, deletedAt: null },
    select: { id: true, parentId: true },
  });
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  let cursor: string | null | undefined = candidateParentId;
  const guard = new Set<string>();
  while (cursor) {
    if (cursor === pageId) return true;
    if (guard.has(cursor)) return true; // pre-existing loop — refuse to extend it
    guard.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

async function nextSortOrder(zoneId: string, parentId: string | null): Promise<number> {
  const last = await prisma.zoneWikiPage.findFirst({
    where: { zoneId, parentId, deletedAt: null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function createWikiPage(
  zoneId: string,
  input: WikiPageInput,
  editorId: string,
): Promise<{ id: string; slug: string }> {
  const title = input.title.trim().slice(0, ZONE_LIMITS.wikiTitleMax);
  if (!title) throw new ZoneError('wiki_title_required', 400);
  const bodyMd = input.bodyMd ?? '';
  const parentId = input.parentId ?? null;
  if (parentId) await assertParentInZone(zoneId, parentId);
  const slug = await uniqueWikiSlug(zoneId, slugBaseFor({ slug: input.slug, title }));
  const sortOrder = await nextSortOrder(zoneId, parentId);
  const note = (input.note ?? '').trim().slice(0, ZONE_LIMITS.wikiNoteMax);

  try {
    const page = await prisma.$transaction(async (tx) => {
      const created = await tx.zoneWikiPage.create({
        data: {
          zoneId,
          slug,
          title,
          bodyMd,
          parentId,
          sortOrder,
          createdById: editorId,
          updatedById: editorId,
          revisionCount: 1,
        },
        select: { id: true, slug: true },
      });
      await tx.zoneWikiRevision.create({
        data: { pageId: created.id, editorId, title, bodyMd, note },
      });
      return created;
    });
    return page;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ZoneError('wiki_slug_taken', 409);
    }
    throw e;
  }
}

export async function updateWikiPage(pageId: string, input: Partial<WikiPageInput>, editorId: string): Promise<void> {
  const page = await prisma.zoneWikiPage.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true, zoneId: true, slug: true, title: true, bodyMd: true, parentId: true },
  });
  if (!page) throw new ZoneError('not_found', 404);

  const title = input.title !== undefined ? input.title.trim().slice(0, ZONE_LIMITS.wikiTitleMax) : page.title;
  if (!title) throw new ZoneError('wiki_title_required', 400);
  const bodyMd = input.bodyMd !== undefined ? input.bodyMd : page.bodyMd;
  const contentSave = input.title !== undefined || input.bodyMd !== undefined;

  let parentId = page.parentId;
  let sortOrder: number | undefined;
  if (input.parentId !== undefined && input.parentId !== page.parentId) {
    parentId = input.parentId;
    if (parentId) {
      await assertParentInZone(page.zoneId, parentId);
      if (await wouldCycle(page.zoneId, page.id, parentId)) throw new ZoneError('wiki_cycle', 400);
    }
    sortOrder = await nextSortOrder(page.zoneId, parentId);
  }

  let slug = page.slug;
  if (input.slug !== undefined) {
    const wanted = input.slug.trim().toLowerCase();
    if (wanted && wanted !== page.slug) {
      if (!isValidWikiSlug(wanted)) throw new ZoneError('wiki_slug_invalid', 400);
      slug = await uniqueWikiSlug(page.zoneId, wanted, page.id);
      if (slug !== wanted) throw new ZoneError('wiki_slug_taken', 409);
    }
  }
  const note = (input.note ?? '').trim().slice(0, ZONE_LIMITS.wikiNoteMax);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.zoneWikiPage.update({
        where: { id: page.id },
        data: {
          title,
          bodyMd,
          slug,
          parentId,
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          updatedById: editorId,
          ...(contentSave ? { revisionCount: { increment: 1 } } : {}),
        },
      });
      if (contentSave) {
        await tx.zoneWikiRevision.create({ data: { pageId: page.id, editorId, title, bodyMd, note } });
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ZoneError('wiki_slug_taken', 409);
    }
    throw e;
  }
}

/** Soft delete; children move up to the deleted page's parent. */
export async function deleteWikiPage(pageId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const page = await tx.zoneWikiPage.findFirst({
      where: { id: pageId, deletedAt: null },
      select: { id: true, zoneId: true, parentId: true },
    });
    if (!page) return;
    const r = await tx.zoneWikiPage.updateMany({ where: { id: page.id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (r.count === 0) return;
    await tx.zoneWikiPage.updateMany({
      where: { zoneId: page.zoneId, parentId: page.id, deletedAt: null },
      data: { parentId: page.parentId },
    });
  });
}

export async function reorderWikiPages(
  zoneId: string,
  orders: { id: string; parentId: string | null; sortOrder: number }[],
): Promise<void> {
  if (orders.length === 0) return;
  const ids = [...new Set(orders.map((o) => o.id))];
  if (ids.length !== orders.length) throw new ZoneError('wiki_reorder_invalid', 400);

  const rows = await prisma.zoneWikiPage.findMany({
    where: { zoneId, deletedAt: null },
    select: { id: true, parentId: true },
  });
  const inZone = new Set(rows.map((r) => r.id));
  for (const o of orders) {
    if (!inZone.has(o.id)) throw new ZoneError('wiki_reorder_invalid', 400);
    if (o.parentId && !inZone.has(o.parentId)) throw new ZoneError('wiki_parent_invalid', 400);
    if (o.parentId === o.id) throw new ZoneError('wiki_cycle', 400);
    if (!Number.isFinite(o.sortOrder)) throw new ZoneError('wiki_reorder_invalid', 400);
  }

  // Cycle check over the MERGED parent map (existing tree + requested moves).
  const parentOf = new Map<string, string | null>(rows.map((r) => [r.id, r.parentId]));
  for (const o of orders) parentOf.set(o.id, o.parentId);
  for (const start of parentOf.keys()) {
    const seen = new Set<string>();
    let cursor: string | null | undefined = start;
    while (cursor) {
      if (seen.has(cursor)) throw new ZoneError('wiki_cycle', 400);
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  await prisma.$transaction(
    orders.map((o) =>
      prisma.zoneWikiPage.updateMany({
        where: { id: o.id, zoneId, deletedAt: null },
        data: { parentId: o.parentId, sortOrder: Math.trunc(o.sortOrder) },
      }),
    ),
  );
}

// ── Revisions ────────────────────────────────────────────────────────────────

const REVISION_SELECT = {
  id: true,
  pageId: true,
  title: true,
  note: true,
  createdAt: true,
  editor: AUTHOR_IDENTITY_SELECT,
} satisfies Prisma.ZoneWikiRevisionSelect;

type RevisionRow = Prisma.ZoneWikiRevisionGetPayload<{ select: typeof REVISION_SELECT }>;

function toRevisionView(r: RevisionRow, canSeeIdentity: boolean): WikiRevisionView {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    createdAt: iso(r.createdAt),
    editor: toPublicAuthor(r.editor, canSeeIdentity),
  };
}

export async function listWikiRevisions(pageId: string, take = 50, canSeeIdentity = false): Promise<WikiRevisionView[]> {
  const rows = await prisma.zoneWikiRevision.findMany({
    where: { pageId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(200, Math.max(1, Math.trunc(take) || 50)),
    select: REVISION_SELECT,
  });
  return rows.map((r) => toRevisionView(r, canSeeIdentity));
}

export async function getWikiRevision(
  pageId: string,
  revisionId: string,
  canSeeIdentity = false,
): Promise<WikiRevisionView | null> {
  const row = await prisma.zoneWikiRevision.findFirst({
    where: { id: revisionId, pageId },
    select: { ...REVISION_SELECT, bodyMd: true },
  });
  if (!row) return null;
  return { ...toRevisionView(row, canSeeIdentity), bodyMd: row.bodyMd };
}

/** Restore = a fresh save of the snapshot (history is append-only; the current state is never rewritten). */
export async function restoreWikiRevision(pageId: string, revisionId: string, editorId: string): Promise<void> {
  const rev = await prisma.zoneWikiRevision.findFirst({
    where: { id: revisionId, pageId },
    select: { title: true, bodyMd: true, createdAt: true },
  });
  if (!rev) throw new ZoneError('not_found', 404);
  const stamp = rev.createdAt.toISOString().replace('T', ' ').slice(0, 16);
  await updateWikiPage(pageId, { title: rev.title, bodyMd: rev.bodyMd, note: `恢复自 ${stamp}` }, editorId);
}
