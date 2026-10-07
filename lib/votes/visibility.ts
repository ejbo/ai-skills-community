// 投票活动的可见范围闸门 (docs/contracts/audience.md, docs/contracts/votes.md#可见范围).
//
// Deliberately light (prisma + lib/audience only — no env, no session): the translation
// registry (lib/translate/sources.ts) runs this REAL gate, and so do its tests.
// lib/vote-queries.ts re-exports it, so routes import it from there.

import type { Prisma } from '@prisma/client';
import { audienceItemIds, isInAudience } from '@/lib/audience';
import { canSeeByVisibility, type ContentVisibility } from '@/lib/audience-shared';
import type { DomainViewer } from '@/lib/permissions';

/** `canManage` = `votes` permission; same shape as lib/vote-queries.ts#VoteViewer. */
type VoteViewer = DomainViewer;

// ONE gate for every read of an activity: the detail payload, every /api/votes/[id]/**
// route a non-owner can hit, and the vote_comment translation loader all call
// `canSeeVoteActivity`; every LIST (hub tabs, 精选, 个人主页, pins) builds its WHERE with
// `listVisibilityWhere`. Visibility is an extra narrowing on top of the old rules —
// deleted ⇒ gone, draft ⇒ creator/admin only — never a replacement for them.

/** The columns `canSeeVoteActivity` needs; select at least these. */
export const VOTE_GATE_SELECT = {
  id: true,
  creatorId: true,
  status: true,
  visibility: true,
  deletedAt: true,
} as const satisfies Prisma.VoteActivitySelect;

export interface VoteGateRow {
  id: string;
  creatorId: string;
  status: 'draft' | 'published';
  visibility: ContentVisibility;
  deletedAt: Date | null;
}

/** Creator or `votes` manager — the people who always see an activity, hidden or not. */
export function isVoteOwner(row: { creatorId: string }, viewer: VoteViewer): boolean {
  return viewer.canManage || (Boolean(viewer.id) && viewer.id === row.creatorId);
}

/**
 * May this viewer see the activity at all? deleted ⇒ no; draft ⇒ owner only; then
 * 可见范围: public ⇒ everyone (the /votes surface is login-walled anyway), private (隐藏)
 * ⇒ owner only, audience ⇒ owner + the people on the ContentAudience list.
 */
export async function canSeeVoteActivity(row: VoteGateRow, viewer: VoteViewer): Promise<boolean> {
  if (row.deletedAt) return false;
  const isOwner = isVoteOwner(row, viewer);
  if (row.status === 'draft' && !isOwner) return false;
  if (isOwner || row.visibility === 'public') return true;
  if (row.visibility !== 'audience') return false;
  return canSeeByVisibility({
    visibility: row.visibility,
    isOwner,
    inAudience: await isInAudience('vote', row.id, viewer.id),
  });
}

/**
 * The visibility half of a LIST query. Public rows, plus `audience` rows that name the
 * viewer (or that the viewer created — the creator is on every list implicitly).
 * `private` (隐藏) rows never appear in browse lists — not even for their creator or an
 * admin: they live in 我发起的 and /manage/votes, which is the point of hiding one.
 */
export async function listVisibilityWhere(viewer: VoteViewer): Promise<Prisma.VoteActivityWhereInput> {
  const ids = await audienceItemIds('vote', viewer.id);
  const audience: Prisma.VoteActivityWhereInput[] = [];
  if (ids.length) audience.push({ visibility: 'audience', id: { in: ids } });
  if (viewer.id) audience.push({ visibility: 'audience', creatorId: viewer.id });
  return { OR: [{ visibility: 'public' }, ...audience] };
}
