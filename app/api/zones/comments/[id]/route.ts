import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { logAdmin } from '@/lib/audit';
import { ZONE_ACCESS_SELECT, resolveZoneAccess, zoneSiteViewer } from '@/lib/zones/access';
import { ZONE_LIMITS } from '@/lib/zones/shared';

export const dynamic = 'force-dynamic';

/** Authors may edit their own comment for this long; moderators always. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

const editSchema = z.object({ bodyMd: z.string().trim().min(1).max(ZONE_LIMITS.commentMax) });

const COMMENT_SELECT = {
  id: true,
  postId: true,
  authorId: true,
  parentId: true,
  replyCount: true,
  status: true,
  createdAt: true,
  post: {
    select: {
      id: true,
      zoneId: true,
      deletedAt: true,
      zone: { select: ZONE_ACCESS_SELECT },
    },
  },
} as const;

/** comment → post → zone: the zone policy is resolved from the comment's own post. */
async function loadCommentContext(id: string, session: Session) {
  const comment = await prisma.zonePostComment.findUnique({ where: { id }, select: COMMENT_SELECT });
  if (!comment) return null;
  const viewer = zoneSiteViewer(session.user);
  if (comment.post.zone.deletedAt && !viewer.siteAdmin) return null;
  const access = await resolveZoneAccess(comment.post.zone, viewer);
  return { comment, viewer, access };
}

// PATCH /api/zones/comments/[id] { bodyMd } (author within 15 min OR canModerate) → { ok, comment }
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const loaded = await loadCommentContext(params.id, session);
  if (!loaded || loaded.comment.status === 'deleted' || loaded.comment.post.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const { comment, access } = loaded;

  const isAuthor = comment.authorId === session.user.id;
  if (!isAuthor && !access.canModerate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (isAuthor && !access.canModerate && Date.now() - comment.createdAt.getTime() > EDIT_WINDOW_MS) {
    return NextResponse.json(
      { error: 'edit_window_closed', reason: await apiReason('zone_edit_window') },
      { status: 403 },
    );
  }

  const updated = await prisma.zonePostComment.update({
    where: { id: comment.id },
    data: { bodyMd: parsed.data.bodyMd, editedAt: new Date() },
    select: { id: true, bodyMd: true, editedAt: true },
  });

  if (!isAuthor && access.siteAdmin && !access.isMember) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'edit_zone_comment',
      targetType: 'zone_comment',
      targetId: comment.id,
      details: { postId: comment.postId, zoneSlug: comment.post.zone.slug },
    });
  }

  return NextResponse.json({
    ok: true,
    comment: {
      id: updated.id,
      bodyMd: updated.bodyMd,
      editedAt: updated.editedAt ? updated.editedAt.toISOString() : null,
    },
  });
}

// DELETE /api/zones/comments/[id] (author OR canModerate of the post's zone)
//   → { ok, tombstoned, prunedParent }
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const loaded = await loadCommentContext(params.id, session);
  if (!loaded || loaded.comment.status === 'deleted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const { comment, access } = loaded;

  const isAuthor = comment.authorId === session.user.id;
  if (!isAuthor && !access.canModerate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Interactive transaction with guarded writes: the pre-read above is only the
  // 401/403/404 fast path. Re-deciding inside the transaction (and bailing when
  // a guarded write matched no row) keeps commentCount honest when two deletes
  // race, or when a new reply lands between the read and the delete.
  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await tx.zonePostComment.findUnique({
      where: { id: comment.id },
      select: { replyCount: true, parentId: true, status: true },
    });
    if (!fresh || fresh.status === 'deleted') return null;

    const tombstone = fresh.replyCount > 0;
    if (tombstone) {
      const r = await tx.zonePostComment.updateMany({
        where: { id: comment.id, status: 'visible' },
        data: { status: 'deleted', bodyMd: '' },
      });
      if (r.count === 0) return null; // lost a concurrent-delete race
    } else {
      // replyCount guard: if a reply raced in, don't cascade it away.
      const r = await tx.zonePostComment.deleteMany({ where: { id: comment.id, replyCount: 0 } });
      if (r.count === 0) return null;
    }

    await tx.zonePost.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });

    let prunedParent = false;
    if (fresh.parentId) {
      const parent = await tx.zonePostComment.update({
        where: { id: fresh.parentId },
        data: { replyCount: { decrement: 1 } },
        select: { id: true, status: true, replyCount: true },
      });
      // A tombstone that just lost its last reply has nothing left to show.
      if (parent.status === 'deleted' && parent.replyCount <= 0) {
        const pr = await tx.zonePostComment.deleteMany({
          where: { id: parent.id, status: 'deleted', replyCount: { lte: 0 } },
        });
        prunedParent = pr.count > 0;
      }
    }
    return { tombstone, prunedParent };
  });

  if (!outcome) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!isAuthor && access.siteAdmin && !access.isMember) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_zone_comment',
      targetType: 'zone_comment',
      targetId: comment.id,
      details: { postId: comment.postId, zoneSlug: comment.post.zone.slug, authorId: comment.authorId },
    });
  }

  return NextResponse.json({ ok: true, tombstoned: outcome.tombstone, prunedParent: outcome.prunedParent });
}
