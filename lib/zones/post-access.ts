// 技术专区 — 帖子可见性判定 (post visibility policy).
//
// IMPORT-FREE at runtime (type-only imports) and unit-tested in
// tests/zones-visibility.test.ts. This is the SINGLE decision function for
// "may this viewer open this post"; the SQL half that keeps a list query from
// ever fetching what this would hide lives in
// lib/zones/post-queries.ts#zonePostVisibilityWhere — the two must agree.
//
// Post visibility NARROWS within the zone; it can never widen it. The zone gate
// (`ZoneAccess.canRead`) is checked FIRST, so a post marked `zone` inside a
// members-only 版块 is still invisible to a non-member.

import type { ZoneAccess } from './permissions';
import type { ZonePostVisibilityValue } from './shared';

/**
 * - `privileged` — author / co-author / 版主 / site admin: sees drafts and
 *   soft-deleted rows too, plus the share code and the designated-viewer list.
 * - `visible`    — may read the whole post.
 * - `locked`     — a `restricted` post the viewer has not unlocked: the detail
 *   page renders the stub + 访问密码 form, never the body.
 * - `hidden`     — 404 for this viewer.
 */
export type ZonePostAccessDecision = 'privileged' | 'visible' | 'locked' | 'hidden';

export interface ZonePostAccessRow {
  authorId: string;
  /** Co-author ids; omit when they are not loaded (the check then only sees the primary author). */
  coauthorIds?: readonly string[];
  status: 'draft' | 'published';
  deletedAt?: Date | string | null;
  visibility: ZonePostVisibilityValue;
}

export interface ZonePostAccessContext {
  viewerId: string | null;
  /** ZoneAccess.canRead — the zone gate, always applied before post visibility. */
  canRead: boolean;
  isMember: boolean;
  canModerate: boolean;
  siteAdmin: boolean;
  /** A ZonePostViewer row exists for (post, viewer) — designated OR code-redeemed. */
  granted: boolean;
}

/** The pre-decided `ZoneAccess` is the only policy input; `granted` comes from ZonePostViewer. */
export function zonePostAccessContext(access: ZoneAccess, granted = false): ZonePostAccessContext {
  return {
    viewerId: access.viewerId,
    canRead: access.canRead,
    isMember: access.isMember,
    canModerate: access.canModerate,
    siteAdmin: access.siteAdmin,
    granted,
  };
}

export function isZonePostAuthor(post: ZonePostAccessRow, viewerId: string | null): boolean {
  if (!viewerId) return false;
  return post.authorId === viewerId || (post.coauthorIds ?? []).includes(viewerId);
}

export function decideZonePostAccess(post: ZonePostAccessRow, ctx: ZonePostAccessContext): ZonePostAccessDecision {
  // Authors, co-authors, 版主 and site staff bypass everything below (drafts included).
  if (isZonePostAuthor(post, ctx.viewerId) || ctx.canModerate || ctx.siteAdmin) return 'privileged';
  if (post.status !== 'published' || post.deletedAt) return 'hidden';
  // Zone gate first, always.
  if (!ctx.canRead) return 'hidden';
  switch (post.visibility) {
    case 'zone':
      return 'visible';
    case 'members':
      return ctx.isMember ? 'visible' : 'hidden';
    case 'restricted':
      return ctx.granted ? 'visible' : 'locked';
    default:
      return 'hidden';
  }
}

/** The post may be opened in full (body, attachments, embeds, comments). */
export function isZonePostReadable(decision: ZonePostAccessDecision): boolean {
  return decision === 'privileged' || decision === 'visible';
}

/** The post exists for this viewer — readable, or shown as the locked stub. */
export function isZonePostDiscoverable(decision: ZonePostAccessDecision): boolean {
  return decision !== 'hidden';
}
