// 可见范围 / 指定成员可见 — the import-free, client-safe half (docs/contracts/audience.md).
// Pure on purpose: the composer UI, the server gates and the tests all read the same
// rules. The DB half (ContentAudience rows) lives in lib/audience.ts.
//
// Shape: a surface keeps a `visibility` column of the generic `ContentVisibility` enum on
// its OWN row (so its list queries can filter in SQL) and, for `audience`, names extra
// readers in the shared ContentAudience table. The owner and the surface's managers are
// implicit — they can always see the item and are never stored in the list.

import type { PublicAuthor } from '@/lib/user-identity';

export const CONTENT_VISIBILITIES = ['public', 'audience', 'private'] as const;
/** Mirrors the Prisma enum `ContentVisibility` (order = how the picker lists them). */
export type ContentVisibility = (typeof CONTENT_VISIBILITIES)[number];

export function isContentVisibility(v: unknown): v is ContentVisibility {
  return v === 'public' || v === 'private' || v === 'audience';
}

/** One listed member as the editor shows it — `userId` is what saves, `user` (already trimmed) is the chip. */
export interface AudiencePick {
  userId: string;
  user: PublicAuthor;
}

/** Hard cap per item — a named list, not a mailing list. */
export const MAX_AUDIENCE = 200;

/**
 * May this viewer see the item, as far as VISIBILITY goes? (Each surface still applies
 * its own other gates first — deleted, draft, …) `isOwner` = owner OR a manager of that
 * surface; `inAudience` only matters for `audience`.
 */
export function canSeeByVisibility(opts: {
  visibility: ContentVisibility;
  isOwner: boolean;
  inAudience: boolean;
}): boolean {
  if (opts.isOwner) return true;
  if (opts.visibility === 'public') return true;
  if (opts.visibility === 'audience') return opts.inAudience;
  return false;
}

/** The snapshot `newlyGrantedAudience` compares: is the item live, how visible, who is listed. */
export interface AudienceState {
  /** Live for its audience at all (e.g. a vote activity is published, not a draft). */
  live: boolean;
  visibility: ContentVisibility;
  audience: readonly string[];
}

/**
 * Who can see the item NOW only because of the list, and could not before — the people a
 * 「已对你可见」 notification is for. Covers every path with one rule: adding names, switching
 * the mode to `audience`, and publishing a draft that already had a list. Nobody is told
 * about something they still cannot open (draft, or the mode is not `audience`), and
 * nobody is re-told when the item was already public to them.
 */
export function newlyGrantedAudience(before: AudienceState, after: AudienceState): string[] {
  if (!after.live || after.visibility !== 'audience') return [];
  if (before.live && before.visibility === 'public') return [];
  const prev = new Set(before.live && before.visibility === 'audience' ? before.audience : []);
  return [...new Set(after.audience)].filter((id) => !prev.has(id));
}

/**
 * Normalize a requested list: trim, drop blanks, dedupe, drop the owner (implicit), cap.
 * Order is kept so the cap keeps what the editor showed first.
 */
export function normalizeAudienceIds(ids: readonly string[], ownerId: string | null, max = MAX_AUDIENCE): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || id === ownerId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
