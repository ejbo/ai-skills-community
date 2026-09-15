// 技术专区 — "may THIS viewer edit THIS post's content?", answered once on the
// server for the pages that show an edit entry.
//
// The policy itself is `canEditZonePostContent` (post-queries.ts), which the
// PATCH route already enforces. The reading page and the composer page used to
// decide with `post.isAuthor || access.canModerate` instead — close, but not the
// same rule: a CO-author of a post inside a 仅成员可见 版块 they cannot read is
// `isAuthor` (a byline is site-wide) yet may not edit, so they were shown 编辑,
// got the composer, and only learned on save that PATCH answers 403. Every edit
// entry now goes through this one function, so the button and the write can
// never disagree again.
//
// The public post views deliberately carry no user ids (only handles), so the
// ids the policy needs are read here with one primary-key lookup. A viewer who
// is neither an author nor a moderator is answered without touching the DB —
// `isAuthor` is derived from exactly those ids, so the policy could only say no.

import { prisma } from '@/lib/db';
import { canEditZonePostContent } from './post-queries';

export async function canViewerEditZonePost(o: {
  postId: string;
  /** `ZonePostCardView.isAuthor` — primary author OR co-author. */
  isAuthor: boolean;
  access: { viewerId: string | null; canRead: boolean; canModerate: boolean };
}): Promise<boolean> {
  const viewerId = o.access.viewerId;
  if (!viewerId) return false;
  if (!o.isAuthor && !o.access.canModerate) return false;
  const row = await prisma.zonePost.findUnique({
    where: { id: o.postId },
    select: { authorId: true, coauthors: { select: { userId: true } } },
  });
  if (!row) return false;
  return canEditZonePostContent({
    viewerId,
    authorId: row.authorId,
    coauthorIds: row.coauthors.map((c) => c.userId),
    canRead: o.access.canRead,
    canModerate: o.access.canModerate,
  });
}
