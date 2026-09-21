// 帖子封面的版式 + 裁切 — the zone-post half of the shared cover contract
// (lib/media/cover-pos.ts: aspect 'landscape' | 'portrait', pos '' | 'contain' |
// 'x% y%'). Pure and client-safe: no prisma, no env, no next-intl. The read
// mapper (toZonePostCardView), both write paths (createZonePost /
// updateZonePost) and the unit test all go through these three functions, so
// "what a view ships" and "what a save stores" are decided in ONE place.
//
// Framing is PRESENTATION, not content: changing it never stamps editedAt /
// editedById (updateZonePost's `contentChanged` is title + body only).

import {
  coverAspectOf,
  coverPosOf,
  parseCoverAspect,
  parseCoverPos,
  type CoverAspect,
} from '@/lib/media/cover-pos';

export interface ZonePostCoverFraming {
  coverAspect: CoverAspect;
  coverPos: string;
}

export const DEFAULT_POST_COVER_FRAMING: ZonePostCoverFraming = { coverAspect: 'landscape', coverPos: '' };

/**
 * READ side — the framing a view ships. A locked stub (`restricted`, no grant)
 * carries no cover, so it carries no framing either: shipping 'portrait' next
 * to `coverUrl: null` would still tell a viewer who may not read the post that
 * it has a cover and what shape it is. Stored values are read through the *Of
 * helpers, so a drifted row renders as the default instead of reaching a style
 * attribute.
 */
export function zonePostCoverFraming(
  row: { coverUrl: string | null; coverAspect?: string | null; coverPos?: string | null },
  locked: boolean,
): ZonePostCoverFraming {
  if (locked || !row.coverUrl) return { ...DEFAULT_POST_COVER_FRAMING };
  return { coverAspect: coverAspectOf(row.coverAspect), coverPos: coverPosOf(row.coverPos) };
}

/**
 * WRITE side, step 1 — validate what a caller sent. `undefined` = not mentioned.
 * Returns null when either value is outside the contract's closed sets (the
 * caller answers 400 `invalid_input`); never normalises junk into a default,
 * because a silently "fixed" crop is a crop the author did not choose.
 */
export function parseCoverFramingInput(input: {
  coverAspect?: unknown;
  coverPos?: unknown;
}): Partial<ZonePostCoverFraming> | null {
  const out: Partial<ZonePostCoverFraming> = {};
  if (input.coverAspect !== undefined) {
    const a = parseCoverAspect(input.coverAspect);
    if (a === null) return null;
    out.coverAspect = a;
  }
  if (input.coverPos !== undefined) {
    const p = parseCoverPos(input.coverPos);
    if (p === null) return null;
    out.coverPos = p;
  }
  return out;
}

/**
 * WRITE side, step 2 — what an UPDATE stores. Returns only the columns to
 * write (`{}` = leave the row alone).
 *
 *   nextCoverKey undefined  the patch did not touch the cover
 *                null       the cover was removed
 *                string     the (validated) key after this save
 *
 *  · removed            → both columns back to the defaults, whatever was sent
 *  · no cover at all    → framing is meaningless; nothing is written
 *  · a DIFFERENT image  → what was sent, defaults for the rest: a crop chosen on
 *                         the old image must never be applied to the new one
 *  · same image / cover untouched → only what was sent (a patch that does not
 *                         mention framing leaves it alone)
 */
export function nextCoverFraming(args: {
  existingCoverKey: string | null;
  nextCoverKey: string | null | undefined;
  sent: Partial<ZonePostCoverFraming>;
}): Partial<ZonePostCoverFraming> {
  const { existingCoverKey, nextCoverKey, sent } = args;
  if (nextCoverKey === null) return { ...DEFAULT_POST_COVER_FRAMING };
  const finalKey = nextCoverKey === undefined ? existingCoverKey : nextCoverKey;
  if (!finalKey) return {};
  if (nextCoverKey !== undefined && nextCoverKey !== existingCoverKey) {
    return {
      coverAspect: sent.coverAspect ?? DEFAULT_POST_COVER_FRAMING.coverAspect,
      coverPos: sent.coverPos ?? DEFAULT_POST_COVER_FRAMING.coverPos,
    };
  }
  return { ...sent };
}

/** What a CREATE stores: defaults without a cover, else what was sent over the defaults. */
export function initialCoverFraming(coverKey: string | null, sent: Partial<ZonePostCoverFraming>): ZonePostCoverFraming {
  if (!coverKey) return { ...DEFAULT_POST_COVER_FRAMING };
  return {
    coverAspect: sent.coverAspect ?? DEFAULT_POST_COVER_FRAMING.coverAspect,
    coverPos: sent.coverPos ?? DEFAULT_POST_COVER_FRAMING.coverPos,
  };
}
