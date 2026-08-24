import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { findManagedActivity, recountVisibleEntries, voteViewerFromSession } from '@/lib/vote-queries';
import {
  VOTE_ENTRY_AUTHOR_MAX,
  VOTE_ENTRY_AUTHOR_NO_MAX,
  VOTE_ENTRY_TITLE_MAX,
  parsePosterPos,
  voteOver,
} from '@/lib/votes/shared';
import { deleteVoteMediaFile } from '@/lib/votes/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  title: z.string().trim().max(VOTE_ENTRY_TITLE_MAX).optional(),
  authorName: z.string().trim().max(VOTE_ENTRY_AUTHOR_MAX).optional(),
  authorNo: z.string().trim().max(VOTE_ENTRY_AUTHOR_NO_MAX).optional(),
  hidden: z.boolean().optional(),
  // 审核：通过 / 驳回（可回到 pending 重新排队）。驳回时 reviewNote 给投稿者看。
  status: z.enum(['approved', 'pending', 'rejected']).optional(),
  reviewNote: z.string().trim().max(500).optional(),
  // 封面裁切（发起人在作品表的封面编辑器里调整）。
  posterAspect: z.enum(['landscape', 'portrait']).optional(),
  posterPos: z.string().max(12).optional(),
});

async function findEntry(activityId: string, entryId: string) {
  const entry = await prisma.voteEntry.findUnique({ where: { id: entryId } });
  return entry && entry.activityId === activityId ? entry : null;
}

// PATCH /api/votes/[id]/entries/[entryId] (creator/admin) — inline edits from
// the manage table + the 审核 actions for member submissions. Hand-edited
// naming fields set titleEdited ONLY on an actual change; 隐藏 keeps votes but
// drops the entry from the gallery.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; entryId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const activity = await findManagedActivity(params.id, voteViewerFromSession(session));
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const entry = await findEntry(activity.id, params.entryId);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const input = parsed.data;

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.authorName !== undefined) data.authorName = input.authorName;
  // 工号 stored lowercase (EmployeeDirectory contract).
  if (input.authorNo !== undefined) data.authorNo = input.authorNo.toLowerCase();
  // Flag as hand-edited ONLY on an actual change — a focus-then-blur that saved
  // the same values must not exempt the row from 重新应用规则 forever.
  const namingChanged =
    (input.title !== undefined && input.title !== entry.title) ||
    (input.authorName !== undefined && input.authorName !== entry.authorName) ||
    (input.authorNo !== undefined && input.authorNo.toLowerCase() !== entry.authorNo);
  if (namingChanged) data.titleEdited = true;
  if (input.hidden !== undefined) data.hidden = input.hidden;
  if (input.posterAspect !== undefined) data.posterAspect = input.posterAspect;
  if (input.posterPos !== undefined) {
    const pos = parsePosterPos(input.posterPos);
    if (pos === null) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    data.posterPos = pos;
  }
  if (input.status !== undefined) {
    data.status = input.status;
    // 驳回理由随驳回落下；通过/回到待审核时清空旧理由。
    data.reviewNote = input.status === 'rejected' ? (input.reviewNote ?? entry.reviewNote) : '';
  } else if (input.reviewNote !== undefined) {
    data.reviewNote = input.reviewNote;
  }

  const galleryChanged = input.hidden !== undefined || input.status !== undefined;
  let updated;
  for (let attempt = 0; ; attempt++) {
    try {
      updated = await prisma.$transaction(
        async (tx) => {
          const row = await tx.voteEntry.update({ where: { id: entry.id }, data });
          if (galleryChanged) await recountVisibleEntries(tx, activity.id);
          return row;
        },
        // Serializable so concurrent 审核/隐藏 actions can't write a stale recount.
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (e) {
      const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (conflict && attempt < 3) continue;
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    entry: {
      id: updated.id,
      title: updated.title,
      authorName: updated.authorName,
      authorNo: updated.authorNo,
      titleEdited: updated.titleEdited,
      hidden: updated.hidden,
      status: updated.status,
      reviewNote: updated.reviewNote,
      posterAspect: updated.posterAspect,
      posterPos: updated.posterPos,
    },
  });
}

// DELETE /api/votes/[id]/entries/[entryId] — hard delete: the row, its ballots
// (cascade) and its files go together, every counter recomputed in the tx.
// Allowed for the creator/admin anytime, AND for the entry's own submitter
// while the activity is still running (撤回投稿; frozen once results are final).
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; entryId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const activity = await prisma.voteActivity.findUnique({ where: { id: params.id } });
  if (!activity || activity.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const entry = await findEntry(activity.id, params.entryId);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isManager = can(session.user, 'votes') || activity.creatorId === session.user.id;
  const isOwnSubmission = entry.submitterId !== null && entry.submitterId === session.user.id;
  if (!isManager && !(isOwnSubmission && !voteOver(activity))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.voteEntry.delete({ where: { id: entry.id } });
          await recountVisibleEntries(tx, activity.id);
          const totals = await tx.voteBallot.aggregate({
            where: { activityId: activity.id },
            _sum: { count: true },
          });
          const voters = await tx.voteBallot.findMany({
            where: { activityId: activity.id },
            distinct: ['userId'],
            select: { userId: true },
          });
          await tx.voteActivity.update({
            where: { id: activity.id },
            data: {
              voteCount: totals._sum.count ?? 0,
              voterCount: voters.length,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (e) {
      const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (conflict && attempt < 3) continue;
      return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
    }
  }

  // Files unlink AFTER the row is gone (own ledger — keys are never shared).
  await deleteVoteMediaFile(entry.fileKey);
  await deleteVoteMediaFile(entry.posterKey);
  return NextResponse.json({ ok: true });
}
