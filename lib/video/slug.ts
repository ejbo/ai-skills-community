// Slugs for videos — the house title-slug contract (docs/contracts/slugs.md):
// the URL is the title (CJK kept as is, `大模型推理实战`), collisions get -2/-3,
// and there is no random fallback any more (it used to be `v-<nanoid>` for every
// Chinese title — the link said nothing about the video).

import { prisma } from '@/lib/db';
import { decodeSlugParam, titleSlug } from '@/lib/slug';
import { freeTitleSlug, resolveSlugAlias, retireSlug } from '@/lib/slug-server';

/** Static siblings of /videos/[slug] a slug must never shadow. */
export const VIDEO_RESERVED_SLUGS = ['shorts'] as const;

/** Old hash slugs (`v-<nanoid8>`, optionally with a `-<nanoid6>` collision tail) — what the backfill replaces. */
export const LEGACY_VIDEO_SLUG_RE = /^v-[a-z0-9_-]{8}(?:-[a-z0-9_-]{6})?$/;

/**
 * A unique slug for a new video. An admin-typed `desired` slug wins when it has
 * any letters/digits; otherwise the title.
 */
export function uniqueVideoSlug(title: string, desired?: string, exceptId?: string): Promise<string> {
  const source = desired && titleSlug(desired) ? desired : title;
  return freeTitleSlug({
    kind: 'video',
    title: source,
    fallback: 'video',
    reserved: VIDEO_RESERVED_SLUGS,
    takenUnder: (base) =>
      prisma.video
        .findMany({
          where: { slug: { startsWith: base }, ...(exceptId ? { id: { not: exceptId } } : {}) },
          select: { slug: true },
        })
        .then((rows) => rows.map((r) => r.slug)),
  });
}

/**
 * The live slug a `/videos/[slug]` param names. Page params arrive still
 * percent-encoded (Next 14), so this decodes first; a retired slug resolves
 * through SlugAlias and `aliased` tells the page to redirect — AFTER its gate.
 */
export async function resolveVideoSlugParam(param: string): Promise<{ slug: string; aliased: boolean }> {
  const slug = decodeSlugParam(param);
  const live = await prisma.video.findUnique({ where: { slug }, select: { id: true } });
  if (live) return { slug, aliased: false };
  const id = await resolveSlugAlias('video', slug);
  if (!id) return { slug, aliased: false };
  const row = await prisma.video.findUnique({ where: { id }, select: { slug: true } });
  return row ? { slug: row.slug, aliased: true } : { slug, aliased: false };
}

/**
 * Backfill: replace legacy `v-<nanoid>` slugs with title slugs, retiring the old
 * one into SlugAlias so links already shared keep working. Shorts are included
 * (their notification links still say /videos/<slug>). Idempotent.
 */
export async function backfillVideoSlugs(opts: { dry?: boolean } = {}): Promise<{ updated: number }> {
  const rows = await prisma.video.findMany({ select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } });
  let updated = 0;
  for (const row of rows) {
    if (!LEGACY_VIDEO_SLUG_RE.test(row.slug)) continue;
    if (!titleSlug(row.title)) continue; // nothing readable to move to
    const next = await uniqueVideoSlug(row.title, undefined, row.id);
    if (next === row.slug) continue;
    console.log(`[video] ${row.slug} → ${next}`);
    updated += 1;
    if (opts.dry) continue;
    await prisma.$transaction(async (tx) => {
      await tx.video.update({ where: { id: row.id }, data: { slug: next } });
      await retireSlug('video', row.slug, row.id, '', tx);
    });
  }
  return { updated };
}
