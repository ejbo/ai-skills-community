// @人 — the WRITE-PATH half of the mention contract.
//
// `lib/mentions.ts` extracts handles out of a markdown body (pure, fence-aware,
// capped). `lib/notifications.ts#notifyMention` writes the rows. This module is
// the piece in between that EVERY surface needs and none should re-invent:
//
//   1. resolve handles → user ids in ONE query per write,
//   2. drop the actor (nobody @s themselves into their own inbox),
//   3. run that surface's OWN visibility gate over the survivors,
//   4. fan out, best-effort.
//
// The gates live in lib/mention-access.ts (pure, unit-tested) and are wired to
// their batch queries here. Two rules they exist for:
//
//  - **A mention must never notify someone who cannot READ the thing it lives
//    in.** "X 在「Q3 评审纪要」中提到了你" leaks the title, the author and the
//    existence of the thread to an outsider — and the deep link then 404s, so
//    the notification is worse than useless.
//
//  - **Under-notify rather than over-notify.** The candidate query already
//    joins each person's site role, so `can(candidate, 'zones' | 'library' | …)`
//    is exact and costs nothing extra; where a gate still cannot be sure, it
//    stays silent. A missed ping is a nuisance; a leaked one is a bug.
//
// Everything here is best-effort: a mention notification may never fail the
// write that triggered it, so `notifyMentions` swallows its own errors — the
// same posture as every other entry point in lib/notifications.ts.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ROLE_SELECT, roleForUserRow } from '@/lib/roles';
import { extractMentionHandles, newMentionHandles } from '@/lib/mentions';
import { notifyMention, type MentionSite } from '@/lib/notifications';
import { canViewVideo, videoActorFrom } from '@/lib/video/access';
import { ZONE_MEMBER_ROLE_KEY } from '@/lib/zones/permissions';
import type { ZonePostAccessRow } from '@/lib/zones/post-access';
import {
  mayReadLibraryDoc,
  mayReadZonePost,
  type LibraryDocGateRow,
  type MentionCandidate,
  type ZoneMentionFacts,
} from '@/lib/mention-access';

export type { LibraryDocGateRow, MentionCandidate, ZoneMentionFacts };
export { mayReadLibraryDoc, mayReadZonePost };

/** Narrows the resolved candidates to those who may read the mention's home. */
export type MentionGate = (
  candidates: MentionCandidate[],
) => MentionCandidate[] | Promise<MentionCandidate[]>;

const CANDIDATE_SELECT = {
  id: true,
  handle: true,
  isAdmin: true,
  role: { select: ROLE_SELECT },
} satisfies Prisma.UserSelect;

/** handles → active users, minus the actor. ONE query, whatever the surface. */
async function resolveCandidates(handles: string[], actorId: string): Promise<MentionCandidate[]> {
  const rows = await prisma.user.findMany({
    where: { handle: { in: handles }, isActive: true },
    select: CANDIDATE_SELECT,
  });
  const out: MentionCandidate[] = [];
  for (const row of rows) {
    if (row.id === actorId) continue;
    const role = roleForUserRow(row);
    out.push({
      id: row.id,
      handle: row.handle,
      roleKey: role.roleKey,
      permissions: role.permissions,
    });
  }
  return out;
}

/**
 * Fan a body's @人 out to its targets.
 *
 * `prevMd` is the edit switch: omit it on a CREATE (everyone mentioned gets a
 * ping), pass the previous body on an EDIT (only handles the edit ADDED get
 * one, so fixing a typo does not re-ping the thread — `newMentionHandles`).
 * Passing `null`/`''` explicitly is an edit of a body that had no mentions.
 */
export async function notifyMentions(opts: {
  bodyMd: string;
  prevMd?: string | null;
  actorId: string;
  actorName: string;
  site: MentionSite;
  gate?: MentionGate;
}): Promise<void> {
  try {
    const handles =
      opts.prevMd === undefined
        ? extractMentionHandles(opts.bodyMd)
        : newMentionHandles(opts.bodyMd, opts.prevMd);
    if (handles.length === 0) return;

    let candidates = await resolveCandidates(handles, opts.actorId);
    if (candidates.length === 0) return;

    if (opts.gate) candidates = await opts.gate(candidates);
    if (candidates.length === 0) return;

    await notifyMention({
      recipientIds: candidates.map((c) => c.id),
      actorId: opts.actorId,
      actorName: opts.actorName,
      site: opts.site,
      bodyMd: opts.bodyMd,
    });
  } catch (e) {
    console.error('[notify] mention fan-out failed:', e);
  }
}

// ─── 技术专区 gate ──────────────────────────────────────────────────────────

/**
 * Gate for a mention living in (or under) one zone post. Costs two queries when
 * the post is readable zone-wide and three when it is `restricted` — and only
 * ever runs when the body actually mentioned somebody.
 */
export function zonePostMentionGate(input: {
  zone: { id: string; ownerId: string; visibility: string };
  post: ZonePostAccessRow & { id: string };
}): MentionGate {
  return async (candidates) => {
    const ids = candidates.map((c) => c.id);
    const [members, memberRole] = await Promise.all([
      prisma.zoneMember.findMany({
        where: { zoneId: input.zone.id, userId: { in: ids }, status: 'active' },
        select: { userId: true, role: { select: { permissions: true } } },
      }),
      prisma.zoneRole.findUnique({
        where: { zoneId_key: { zoneId: input.zone.id, key: ZONE_MEMBER_ROLE_KEY } },
        select: { permissions: true },
      }),
    ]);
    // `roleId: null` ⇒ the zone's `member` system role (the ZoneMember contract).
    const memberPermissions = new Map<string, readonly string[]>(
      members.map((m) => [m.userId, m.role?.permissions ?? memberRole?.permissions ?? []]),
    );

    let grantedIds: ReadonlySet<string> = new Set<string>();
    if (input.post.visibility === 'restricted') {
      const grants = await prisma.zonePostViewer.findMany({
        where: { postId: input.post.id, userId: { in: ids } },
        select: { userId: true },
      });
      grantedIds = new Set(grants.map((g) => g.userId));
    }

    const facts: ZoneMentionFacts = {
      zone: input.zone,
      post: input.post,
      memberPermissions,
      grantedIds,
    };
    return candidates.filter((c) => mayReadZonePost(c, facts));
  };
}

// ─── 知识库 gate ────────────────────────────────────────────────────────────

/** Gate for a mention in a 知识库 comment. One extra query, `restricted` only. */
export function libraryDocMentionGate(doc: LibraryDocGateRow): MentionGate {
  return async (candidates) => {
    let approvedIds: ReadonlySet<string> = new Set<string>();
    if (doc.visibility === 'restricted') {
      const rows = await prisma.libraryAccessRequest.findMany({
        where: { docId: doc.id, userId: { in: candidates.map((c) => c.id) }, status: 'approved' },
        select: { userId: true },
      });
      approvedIds = new Set(rows.map((r) => r.userId));
    }
    return candidates.filter((c) => mayReadLibraryDoc(c, doc, approvedIds));
  };
}

// ─── 视频 gate ──────────────────────────────────────────────────────────────

export interface VideoGateRow {
  status: string;
  visibility: string;
  uploaderId: string;
  deletedAt: Date | null;
  isShort?: boolean;
}

/** Straight through `canViewVideo` — no second opinion, no extra query. */
export function videoMentionGate(video: VideoGateRow): MentionGate {
  return (candidates) => candidates.filter((c) => canViewVideo(video, videoActorFrom(c)));
}
