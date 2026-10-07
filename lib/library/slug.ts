// 知识库 slugs — title-derived (docs/contracts/slugs.md, lib/slug.ts).
//
// Owner, 2026-10-07: 「中文标题的链接现在是一串 hash，希望链接能看出文章内容」. A doc's
// slug is its title — `大模型推理优化实践`, `attention-is-all-you-need` — never
// `doc-<nanoid>`. Two rules specific to the library:
//  - The row is created BEFORE extraction knows the real title (a URL's
//    provisional title is its path, a file's is its filename), so ingest
//    re-derives the slug from the extracted title in the same request, before
//    anyone has been handed the link (`reslugFromTitle`).
//  - After that the slug is frozen: editing the title later keeps the link.
//    The old hash slugs are moved once by `backfillLibraryDocSlugs` and kept as
//    SlugAlias rows, so links already shared still open (route redirects).

import { prisma } from '@/lib/db';
import { decodeSlugParam } from '@/lib/slug';
import { freeTitleSlug, resolveSlugAlias, retireSlug } from '@/lib/slug-server';

/** Static siblings under /library/ that a doc slug must never shadow. */
const RESERVED = ['shelf'] as const;
/** Legacy hash slugs from the ascii-only generator: `doc-<nanoid(8)>`, optionally `-<nanoid(6)>`. */
const LEGACY_HASH_SLUG = /^doc-[a-z0-9_-]{8}(?:-[a-z0-9_-]{6,12})?$/;

function takenUnder(base: string): Promise<string[]> {
  return prisma.libraryDoc
    .findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })
    .then((rows) => rows.map((r) => r.slug));
}

/** A unique title slug for a new library doc. */
export function uniqueDocSlug(title: string): Promise<string> {
  return freeTitleSlug({ kind: 'library_doc', title, fallback: 'doc', reserved: RESERVED, takenUnder });
}

/**
 * Re-derive the slug from the REAL title once extraction found it. Called by
 * ingest before the creating request returns, so the uploader's first link is
 * already the readable one — no alias needed. A no-op when nothing would change.
 */
export async function reslugFromTitle(docId: string): Promise<string | null> {
  const doc = await prisma.libraryDoc.findUnique({ where: { id: docId }, select: { slug: true, title: true } });
  if (!doc) return null;
  const next = await freeTitleSlug({
    kind: 'library_doc',
    title: doc.title,
    fallback: 'doc',
    reserved: RESERVED,
    // The doc's own current slug is not "taken" against itself.
    takenUnder: (base) => takenUnder(base).then((s) => s.filter((x) => x !== doc.slug)),
  });
  if (next === doc.slug) return doc.slug;
  try {
    await prisma.libraryDoc.update({ where: { id: docId }, data: { slug: next } });
    return next;
  } catch {
    return doc.slug; // lost a race for that slug — the provisional one still works
  }
}

/**
 * Resolve a /library/[slug] param. `aliased` = the param is a retired slug and
 * the caller should redirect to `slug` — but only AFTER its own read gate
 * passed, so a redirect never reveals a hidden doc's title.
 */
export async function resolveDocSlugParam(raw: string): Promise<{ slug: string; aliased: boolean }> {
  const slug = decodeSlugParam(raw);
  const live = await prisma.libraryDoc.findUnique({ where: { slug }, select: { id: true } });
  if (live) return { slug, aliased: false };
  const itemId = await resolveSlugAlias('library_doc', slug);
  if (!itemId) return { slug, aliased: false };
  const doc = await prisma.libraryDoc.findUnique({ where: { id: itemId }, select: { slug: true } });
  return doc ? { slug: doc.slug, aliased: true } : { slug, aliased: false };
}

/** The path segment for a slug (Unicode slugs are percent-encoded for redirects/Location headers). */
export function docPath(slug: string, suffix = ''): string {
  return `/library/${encodeURIComponent(slug)}${suffix}`;
}

/**
 * One-time move from hash slugs (`doc-<nanoid>`) to title slugs; the old slug
 * becomes a SlugAlias so every shared link keeps working. Idempotent.
 */
export async function backfillLibraryDocSlugs(opts: { dry?: boolean } = {}): Promise<{ updated: number }> {
  const rows = await prisma.libraryDoc.findMany({
    where: { slug: { startsWith: 'doc-' } },
    select: { id: true, slug: true, title: true },
  });
  let updated = 0;
  for (const row of rows) {
    if (!LEGACY_HASH_SLUG.test(row.slug)) continue;
    const next = await freeTitleSlug({ kind: 'library_doc', title: row.title, fallback: 'doc', reserved: RESERVED, takenUnder });
    if (next === row.slug || next === 'doc' || /^doc-\d+$/.test(next)) continue; // title gave nothing readable
    if (opts.dry) {
      console.log(`[library] ${row.slug} → ${next}`);
      updated += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await retireSlug('library_doc', row.slug, row.id, '', tx);
      await tx.libraryDoc.update({ where: { id: row.id }, data: { slug: next } });
    });
    updated += 1;
  }
  return { updated };
}
