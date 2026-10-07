// 投票活动的标题链接 (/votes/<标题>) — the vote half of the title-slug contract
// (lib/slug.ts, docs/contracts/slugs.md).
//
// - Assigned at creation from the title (`assignVoteSlug`).
// - While the activity is a DRAFT the slug follows title edits (`resyncDraftVoteSlug`) —
//   nobody else can open a draft, so no link can break and no alias is needed.
// - Once PUBLISHED it is frozen: a title edit never touches it.
// - `/votes/[id]` accepts a slug OR the cuid (old links, stored notification deep links,
//   embeds) through `resolveVoteParam`, and redirects to the canonical slug URL.
// - API routes stay id-based; every UI link goes through `voteHref` (lib/votes/shared.ts).

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { decodeSlugParam, looksLikeCuid } from '@/lib/slug';
import { freeTitleSlug, isSlugConflict, resolveSlugAlias } from '@/lib/slug-server';

type Db = Prisma.TransactionClient | typeof prisma;

/** Static segments under /votes that a slug must never shadow. */
const RESERVED = ['new'] as const;

/** The free slug for this title (excluding `selfId`'s own current slug from the taken set). */
export async function freeVoteSlug(title: string, opts: { selfId?: string; db?: Db } = {}): Promise<string> {
  const db = opts.db ?? prisma;
  return freeTitleSlug({
    kind: 'vote',
    title,
    fallback: 'vote',
    reserved: RESERVED,
    db,
    takenUnder: (base) =>
      db.voteActivity
        .findMany({
          where: { slug: { startsWith: base }, ...(opts.selfId ? { id: { not: opts.selfId } } : {}) },
          select: { slug: true },
        })
        .then((rows) => rows.map((r) => r.slug).filter((s): s is string => Boolean(s))),
  });
}

/**
 * Write a fresh title slug onto the row (create, draft rename, backfill). Retries once on a
 * unique-constraint race (two same-titled activities created in the same instant); a second
 * failure leaves the slug as it was — the id URL keeps working, nothing is lost.
 */
export async function assignVoteSlug(id: string, title: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const slug = await freeVoteSlug(title, { selfId: id });
      await prisma.voteActivity.update({ where: { id }, data: { slug } });
      return slug;
    } catch (e) {
      if (!isSlugConflict(e)) throw e;
    }
  }
  return null;
}

/**
 * A draft's slug follows its title. Published rows are frozen — call this only after a
 * title change, and it no-ops for anything that is not a draft.
 */
export async function resyncDraftVoteSlug(row: { id: string; status: string; slug: string | null }, title: string): Promise<void> {
  if (row.status !== 'draft') return;
  const next = await freeVoteSlug(title, { selfId: row.id });
  if (next === row.slug) return;
  await assignVoteSlug(row.id, title).catch(() => null);
}

/**
 * Every activity without a slug gets its title slug (published ones too — they never had one).
 * `dry`: compute and log `[vote] <id> → <slug>`, write nothing. (In dry mode two same-titled
 * rows may both print the bare slug — the real run gives the second one `-2`.)
 */
export async function backfillVoteSlugs(opts: { dry?: boolean } = {}): Promise<{ updated: number }> {
  const rows = await prisma.voteActivity.findMany({
    where: { slug: null },
    orderBy: { createdAt: 'asc' }, // the oldest of two same-titled activities keeps the bare slug
    select: { id: true, title: true },
  });
  let updated = 0;
  for (const row of rows) {
    if (opts.dry) {
      console.log(`[vote] ${row.id} → ${await freeVoteSlug(row.title, { selfId: row.id })}`);
      updated += 1;
      continue;
    }
    if (await assignVoteSlug(row.id, row.title)) updated += 1;
  }
  return { updated };
}

/**
 * Resolve a `/votes/[id]` route param — slug, cuid, or a retired slug — to the row id.
 * `canonical` is false when the caller should redirect to `voteHref(row)` instead (an id or
 * an alias was used while the row has a slug). Returns null when nothing matches.
 */
export async function resolveVoteParam(raw: string): Promise<{ id: string; slug: string | null; canonical: boolean } | null> {
  const param = decodeSlugParam(raw);
  if (!param) return null;
  const select = { id: true, slug: true } as const;
  if (looksLikeCuid(param)) {
    const byId = await prisma.voteActivity.findUnique({ where: { id: param }, select });
    if (byId) return { ...byId, canonical: !byId.slug };
  }
  const bySlug = await prisma.voteActivity.findUnique({ where: { slug: param }, select });
  if (bySlug) return { ...bySlug, canonical: true };
  const aliased = await resolveSlugAlias('vote', param);
  if (aliased) {
    const row = await prisma.voteActivity.findUnique({ where: { id: aliased }, select });
    if (row) return { ...row, canonical: !row.slug };
  }
  if (!looksLikeCuid(param)) {
    // A cuid-shaped check is only a lookup ORDER hint — an id that fails the shape test
    // (seeded / imported rows) must still resolve.
    const byId = await prisma.voteActivity.findUnique({ where: { id: param }, select });
    if (byId) return { ...byId, canonical: !byId.slug };
  }
  return null;
}
