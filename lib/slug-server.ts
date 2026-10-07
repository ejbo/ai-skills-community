// Server half of the title-slug contract (lib/slug.ts is the pure half).
//
// Each surface owns its own slug column and its own uniqueness scope; these
// helpers only do the two things every surface repeats: find the free slug for
// a title, and resolve a retired slug through SlugAlias.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { allocateSlug, decodeSlugParam, looksLikeCuid, titleSlug } from '@/lib/slug';

type Db = Prisma.TransactionClient | typeof prisma;

export type SlugKind = 'library_doc' | 'video' | 'wiki_page' | 'vote' | 'event' | 'zone_post' | 'topic' | 'feedback' | 'announcement';

/**
 * The free title slug. `takenUnder(base)` returns every live slug that starts
 * with `base` in the surface's uniqueness scope (one `startsWith` query); retired
 * slugs in SlugAlias are blocked too, so a new item can never steal an old link.
 */
export async function freeTitleSlug(opts: {
  kind: SlugKind;
  title: string;
  fallback: string;
  takenUnder: (base: string) => Promise<string[]>;
  reserved?: readonly string[];
  scope?: string;
  db?: Db;
}): Promise<string> {
  const db = opts.db ?? prisma;
  const base = titleSlug(opts.title) || opts.fallback;
  const [live, retired] = await Promise.all([
    opts.takenUnder(base),
    db.slugAlias.findMany({
      where: { kind: opts.kind, scope: opts.scope ?? '', slug: { startsWith: base } },
      select: { slug: true },
    }),
  ]);
  return allocateSlug(base, [...live, ...retired.map((r) => r.slug)], {
    fallback: opts.fallback,
    reserved: opts.reserved,
  });
}

/** The item a retired slug now points at, or null. */
export async function resolveSlugAlias(kind: SlugKind, slug: string, scope = ''): Promise<string | null> {
  if (!slug) return null;
  const row = await prisma.slugAlias.findUnique({
    where: { kind_scope_slug: { kind, scope, slug } },
    select: { itemId: true },
  });
  return row?.itemId ?? null;
}

/** Retire `slug` for `itemId` (idempotent). Call it whenever a visible slug is replaced. */
export async function retireSlug(kind: SlugKind, slug: string, itemId: string, scope = '', db: Db = prisma): Promise<void> {
  if (!slug) return;
  await db.slugAlias.upsert({
    where: { kind_scope_slug: { kind, scope, slug } },
    create: { kind, scope, slug, itemId },
    update: { itemId },
  });
}

/** True for a unique-constraint violation on a `slug` column — the caller re-picks and retries once. */
export function isSlugConflict(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === 'string' ? [target] : [];
  return fields.some((f) => f.toLowerCase().includes('slug'));
}

/** What a `[id]`-style route param resolved to. `canonical` = the param already IS the row's slug. */
export interface ResolvedSlugParam {
  id: string;
  slug: string | null;
  canonical: boolean;
}

/**
 * Resolve a route param that may be a title slug, a row id (old links,
 * notification deep links) or a retired slug. Only identifies the row — the
 * caller still runs its own access gate on `id`, and redirects to the canonical
 * slug (`!canonical && slug`) only AFTER that gate passes, so a redirect can
 * never reveal a hidden row's title.
 *
 * `find` looks one row up in the surface's own scope (e.g. within a zone).
 */
export async function resolveSlugParam(opts: {
  kind: SlugKind;
  param: string;
  scope?: string;
  find: (where: { id: string } | { slug: string }) => Promise<{ id: string; slug: string | null } | null>;
}): Promise<ResolvedSlugParam | null> {
  const param = decodeSlugParam(opts.param);
  if (!param) return null;
  const asResult = (row: { id: string; slug: string | null }, canonical: boolean): ResolvedSlugParam => ({
    id: row.id,
    slug: row.slug,
    canonical: canonical || !row.slug,
  });
  // A cuid-shaped param is almost certainly an id; anything else is tried as a
  // slug first, then as an id too (seeded/demo rows may carry hand-picked ids).
  const idFirst = looksLikeCuid(param);
  if (idFirst) {
    const byId = await opts.find({ id: param });
    if (byId) return asResult(byId, byId.slug === param);
  }
  const bySlug = await opts.find({ slug: param });
  if (bySlug) return asResult(bySlug, true);
  if (!idFirst) {
    const byId = await opts.find({ id: param });
    if (byId) return asResult(byId, byId.slug === param);
  }
  const aliased = await resolveSlugAlias(opts.kind, param, opts.scope ?? '');
  if (aliased) {
    const row = await opts.find({ id: aliased });
    if (row) return asResult(row, false);
  }
  return null;
}

/**
 * Create a row with a fresh title slug; on a slug unique-violation (two creates
 * racing for the same title) pick again once. `pick` must re-query the free slug.
 */
export async function createWithSlug<T>(pick: () => Promise<string>, create: (slug: string) => Promise<T>): Promise<T> {
  try {
    return await create(await pick());
  } catch (e) {
    if (!isSlugConflict(e)) throw e;
    return create(await pick());
  }
}
