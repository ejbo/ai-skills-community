// 知识库分类 — official (curated in 管理后台) + member-created, all in one table.
//
// `slug` is what LibraryDoc.categories stores, so renaming a category never
// rewrites documents. The 16 built-ins keep their old slugs and still render
// through the `labels.libCategory.*` messages; anything created later has no
// message key and renders its stored name (with an optional English twin).

import { prisma } from '@/lib/db';

export const MAX_CATEGORIES_PER_DOC = 4;
const CACHE_MS = 30_000;

export interface LibraryCategoryOption {
  slug: string;
  name: string;
  nameEn: string;
  official: boolean;
}

let cache: { at: number; rows: LibraryCategoryOption[] } | null = null;

export function bustCategoryCache(): void {
  cache = null;
}

/** Official first, then member-created; each block by sortOrder then name. */
export async function listLibraryCategories(): Promise<LibraryCategoryOption[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await prisma.libraryCategory.findMany({
    orderBy: [{ official: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    select: { slug: true, name: true, nameEn: true, official: true },
  });
  cache = { at: Date.now(), rows };
  return rows;
}

/** Keep only slugs that exist, deduped and capped. */
export function cleanCategorySlugs(v: unknown, known: Set<string>): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((s): s is string => typeof s === 'string' && known.has(s)))].slice(
    0,
    MAX_CATEGORIES_PER_DOC,
  );
}

export async function cleanCategoriesFromDb(v: unknown): Promise<string[]> {
  const known = new Set((await listLibraryCategories()).map((c) => c.slug));
  return cleanCategorySlugs(v, known);
}

/**
 * Slug for a member-supplied category name. Latin names slugify; a purely CJK
 * name has nothing to transliterate, so it falls back to a short stable hash of
 * the name — the slug is an identifier, never display text.
 */
export function slugifyCategory(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const latin = base.replace(/[^a-z0-9-]/g, '');
  if (latin.length >= 2) return latin.slice(0, 32);
  let hash = 0;
  for (const ch of name.trim()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `c${hash.toString(36)}`;
}

export type CreateCategoryResult =
  | { ok: true; category: LibraryCategoryOption; created: boolean }
  | { ok: false; error: 'invalid_name' | 'create_failed' };

/**
 * Find-or-create a member category. Matching an EXISTING name (either language,
 * case-insensitively) reuses it rather than minting a near-duplicate — the
 * whole point of a shared taxonomy is that two people typing 「大模型」 land on
 * the same bucket.
 */
export async function findOrCreateCategory(
  rawName: string,
  createdById: string | null,
): Promise<CreateCategoryResult> {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 24) return { ok: false, error: 'invalid_name' };

  const existing = await prisma.libraryCategory.findFirst({
    where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, { nameEn: { equals: name, mode: 'insensitive' } }] },
    select: { slug: true, name: true, nameEn: true, official: true },
  });
  if (existing) return { ok: true, category: existing, created: false };

  let slug = slugifyCategory(name);
  // Slug collisions are possible (two different names, same latin skeleton).
  for (let i = 0; i < 5; i++) {
    const taken = await prisma.libraryCategory.findUnique({ where: { slug }, select: { slug: true } });
    if (!taken) break;
    slug = `${slugifyCategory(name)}-${i + 2}`;
  }

  const select = { slug: true, name: true, nameEn: true, official: true } as const;
  const create = (author: string | null) =>
    prisma.libraryCategory.create({
      data: { slug, name, official: false, createdById: author, sortOrder: 200 },
      select,
    });

  try {
    const created = await create(createdById);
    bustCategoryCache();
    return { ok: true, category: created, created: true };
  } catch {
    // Lost a race — whoever won created the same name.
    const row = await prisma.libraryCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select,
    });
    if (row) return { ok: true, category: row, created: false };
    // Not a race: the only other way the insert fails is a dangling author (a
    // session JWT outliving its user row). The CATEGORY is still worth having —
    // authorship is metadata, not a precondition.
    if (createdById) {
      try {
        const created = await create(null);
        bustCategoryCache();
        return { ok: true, category: created, created: true };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: 'create_failed' };
  }
}
