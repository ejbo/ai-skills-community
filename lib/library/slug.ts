// Slug generation for library docs. Mirrors lib/video/slug.ts: lowercase ascii
// with hyphens, nanoid fallback for CJK-only titles, nanoid suffix on collision.

import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';

/** Lowercase ascii + hyphens; collapse/trim separators; cap length. */
function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * Produce a unique slug for a new library doc. A Chinese-only title yields a
 * too-short latin slug (< 3 chars) and falls back to `doc-<nanoid>`.
 */
export async function uniqueDocSlug(title: string): Promise<string> {
  const latin = slugify(title);
  const base = latin.length >= 3 ? latin : `doc-${nanoid(8).toLowerCase()}`;

  let candidate = base;
  // Bounded loop; nanoid(6) makes collisions astronomically unlikely.
  for (let i = 0; i < 20; i++) {
    const existing = await prisma.libraryDoc.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${nanoid(6).toLowerCase()}`;
  }
  return `${base}-${nanoid(12).toLowerCase()}`;
}
