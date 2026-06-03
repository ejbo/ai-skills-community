// Slug generation for videos. Mirrors the skill slugify idiom: lowercase ASCII
// with hyphens, collapse runs, trim, fall back to a nanoid when nothing usable
// remains, then ensure global uniqueness against the Video table by appending a
// short nanoid suffix on collision.

import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db';

/** Lowercase ascii + hyphens; collapse/trim separators; cap length. */
function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/**
 * Produce a unique slug for a new video. Prefers `desired` (slugified) then the
 * slugified `title`; falls back to a nanoid when neither yields ascii content.
 * Appends a short nanoid suffix while the slug already exists.
 */
export async function uniqueVideoSlug(title: string, desired?: string): Promise<string> {
  const base = slugify(desired ?? '') || slugify(title) || `v-${nanoid(8).toLowerCase()}`;

  let candidate = base;
  // Bounded loop; nanoid(6) makes collisions astronomically unlikely.
  for (let i = 0; i < 20; i++) {
    const existing = await prisma.video.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
    candidate = `${base}-${nanoid(6).toLowerCase()}`;
  }
  return `${base}-${nanoid(12).toLowerCase()}`;
}
