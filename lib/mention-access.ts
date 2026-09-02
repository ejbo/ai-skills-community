// @人 — "may this person be told?", the PURE half.
//
// Split out of lib/mention-notify.ts (which needs prisma, and through
// lib/notifications.ts the env-validating mailer) purely so these decisions are
// unit-testable — tests/mention-access.test.ts. Same shape as the other
// pure/server pairs in the codebase (lib/zones/post-access.ts,
// lib/video/subtitles-shared.ts, lib/github-trending-shared.ts).
//
// The rule these functions exist for: **a mention must never notify someone who
// cannot READ the thing it lives in.** The notification title carries the post
// or document title, so a ping to an outsider leaks the title, the author and
// the fact that the thread exists — and its deep link 404s anyway. Neither
// function invents policy: each rebuilds the inputs of its domain's OWN
// decision (`decideZonePostAccess`, the `canReadDoc` rules) from batch-loaded
// facts, so the gate cannot drift away from the surface it is gating.

import { can, type PermissionHolder } from '@/lib/permissions';
import { ZONE_PERMISSION_KEYS, normalizeZonePermissions } from '@/lib/zones/permissions';
import {
  decideZonePostAccess,
  isZonePostReadable,
  type ZonePostAccessRow,
} from '@/lib/zones/post-access';

/**
 * A resolved mention target. Deliberately shaped as `{ id } & PermissionHolder`
 * so it drops straight into `can(candidate, '<domain>')` and
 * `videoActorFrom(candidate)` — the gates decide with the SAME helpers the
 * request-time code paths use, never a re-implementation.
 */
export interface MentionCandidate extends PermissionHolder {
  id: string;
  handle: string;
  roleKey: string;
  permissions: string[];
}

// ─── 技术专区 ───────────────────────────────────────────────────────────────

/** Everything a zone-post decision needs, already batch-loaded. */
export interface ZoneMentionFacts {
  zone: { ownerId: string; visibility: string };
  post: ZonePostAccessRow;
  /** Active members only: userId → the zone permissions their role grants. */
  memberPermissions: ReadonlyMap<string, readonly string[]>;
  /** Holders of a `ZonePostViewer` row (designated or code-redeemed). */
  grantedIds: ReadonlySet<string>;
}

/**
 * May this candidate open the post? Rebuilds exactly the fields
 * `decideZonePostAccess` reads out of `ZoneAccess` (see `buildZoneAccess`):
 * `canRead` is the zone gate, `isMember`/`canModerate` come from the
 * membership, `siteAdmin` from the site `zones` permission.
 *
 * A `restricted` post the candidate has not unlocked decides `locked` — the
 * 提取码 stub, not the body — and `isZonePostReadable` rightly refuses it.
 */
export function mayReadZonePost(candidate: MentionCandidate, facts: ZoneMentionFacts): boolean {
  const isOwner = candidate.id === facts.zone.ownerId;
  const membership = facts.memberPermissions.get(candidate.id);
  const isMember = isOwner || membership !== undefined;
  const siteAdmin = can(candidate, 'zones');
  const zonePermissions =
    isOwner || siteAdmin ? ZONE_PERMISSION_KEYS : normalizeZonePermissions(membership ?? []);
  const decision = decideZonePostAccess(facts.post, {
    viewerId: candidate.id,
    canRead: siteAdmin || facts.zone.visibility === 'public' ? true : isMember,
    isMember,
    canModerate: zonePermissions.includes('moderate'),
    siteAdmin,
    granted: facts.grantedIds.has(candidate.id),
  });
  return isZonePostReadable(decision);
}

// ─── 知识库 ─────────────────────────────────────────────────────────────────

export interface LibraryDocGateRow {
  id: string;
  uploaderId: string;
  visibility: string;
}

/**
 * Batch twin of `canReadDoc` (lib/library-queries.ts): `public` is open to every
 * logged-in member, `private` is the uploader (plus 知识库 managers), and
 * `restricted` additionally admits an APPROVED access request.
 */
export function mayReadLibraryDoc(
  candidate: MentionCandidate,
  doc: LibraryDocGateRow,
  approvedIds: ReadonlySet<string>,
): boolean {
  if (doc.visibility === 'public') return true;
  if (candidate.id === doc.uploaderId || can(candidate, 'library')) return true;
  if (doc.visibility === 'private') return false;
  return approvedIds.has(candidate.id);
}
