import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logAdmin } from '@/lib/audit';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import {
  findManagedActivity,
  getVoteActivityView,
  voteViewerFromSession,
} from '@/lib/vote-queries';
import {
  VOTE_ANNOUNCEMENT_MAX,
  VOTE_DESCRIPTION_MAX,
  VOTE_TITLE_MAX,
  VOTES_PER_USER_MAX,
  MAX_PER_ENTRY_MAX,
  parseCustomFields,
} from '@/lib/votes/shared';
import {
  deleteVoteMediaFile,
  isValidVoteMediaKey,
  statVoteMediaAsync,
  voteMediaKeyFromUrl,
  voteMediaPublicUrl,
} from '@/lib/votes/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// GET /api/votes/[id] — the full gallery payload (used by the client to
// refresh budget/results state after voting). Same gating as the RSC page.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const viewer = voteViewerFromSession(session);
  // Anonymous key = per-IP (LAST XFF hop — the first is forgeable), never one
  // shared bucket for every logged-out viewer.
  const anonIp =
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ??
    'unknown';
  const gate = rateLimit(`votes:view:${viewer.id ?? anonIp}`, 240, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }
  const view = await getVoteActivityView(params.id, viewer);
  if (!view) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, activity: view });
}

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), 'invalid_date');

const formField = z.enum(['required', 'optional', 'off']);

const contentSchema = z.object({
  title: z.string().trim().min(1).max(VOTE_TITLE_MAX).optional(),
  descriptionMd: z.string().max(VOTE_DESCRIPTION_MAX).optional(),
  announcement: z.string().trim().max(VOTE_ANNOUNCEMENT_MAX).optional(),
  coverKey: z.string().max(200).nullable().optional(),
  startAt: isoDate.nullable().optional(),
  endAt: isoDate.nullable().optional(),
  votesPerUser: z.number().int().min(1).max(VOTES_PER_USER_MAX).optional(),
  budgetPeriod: z.enum(['total', 'daily']).optional(),
  maxPerEntry: z.number().int().min(1).max(MAX_PER_ENTRY_MAX).optional(),
  allowRevoke: z.boolean().optional(),
  resultsMode: z.enum(['realtime', 'after_end', 'creator_only']).optional(),
  showTitles: z.boolean().optional(),
  showAuthors: z.boolean().optional(),
  entryOrder: z.enum(['random', 'upload', 'votes']).optional(),
  // ── 成员投稿设置 ──
  allowSubmissions: z.boolean().optional(),
  submissionReview: z.boolean().optional(),
  submissionMedia: z.enum(['image', 'video', 'both']).optional(),
  maxSubmissionsPerUser: z.number().int().min(1).max(50).optional(),
  maxSubmissionMb: z.number().int().min(1).max(102400).nullable().optional(),
  submitTitle: formField.optional(),
  submitAuthorName: formField.optional(),
  submitAuthorNo: formField.optional(),
  submitDescription: formField.optional(),
  submissionFields: z.unknown().optional(),
  submissionNote: z.string().trim().max(500).optional(),
  allowComments: z.boolean().optional(),
});

const lifecycleSchema = z.object({
  publish: z.boolean().optional(),
  closed: z.boolean().optional(),
});

const moderationSchema = z.object({
  featured: z.boolean(),
});

// PATCH /api/votes/[id] — three branches (events pattern):
//   { featured }            `votes` moderation (logAdmin'd)
//   { publish } / { closed } lifecycle (creator or admin)
//   otherwise                partial content/settings edit (creator or admin)
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // ── admin feature toggle ──
  if ('featured' in body) {
    if (!can(session.user, 'votes')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const parsed = moderationSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    const activity = await prisma.voteActivity.findUnique({ where: { id: params.id } });
    if (!activity || activity.deletedAt) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const featured = parsed.data.featured;
    await prisma.voteActivity.update({
      where: { id: activity.id },
      data: { featured, featuredAt: featured ? new Date() : null },
    });
    await logAdmin({
      adminUserId: session.user.id,
      action: 'feature_vote_activity',
      targetType: 'vote_activity',
      targetId: activity.id,
      details: { title: activity.title, featured: { before: activity.featured, after: featured } },
    });
    return NextResponse.json({ ok: true, featured });
  }

  const viewer = voteViewerFromSession(session);
  const activity = await findManagedActivity(params.id, viewer);
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // ── lifecycle: publish / 提前结束 / 重新开放 ──
  if ('publish' in body || 'closed' in body) {
    const parsed = lifecycleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

    if (parsed.data.publish) {
      if (activity.status !== 'published') {
        const visible = await prisma.voteEntry.count({
          where: { activityId: activity.id, hidden: false, status: 'approved' },
        });
        // 开了成员投稿的活动可以“空场”发布，让成员在征集期把画廊填满。
        if (visible < 1 && !activity.allowSubmissions) {
          return NextResponse.json({ error: 'no_entries' }, { status: 400 });
        }
        await prisma.voteActivity.update({
          where: { id: activity.id },
          data: { status: 'published', publishedAt: activity.publishedAt ?? new Date() },
        });
      }
      return NextResponse.json({ ok: true, status: 'published' });
    }

    if (typeof parsed.data.closed === 'boolean') {
      if (parsed.data.closed) {
        await prisma.voteActivity.update({
          where: { id: activity.id },
          data: { closedAt: activity.closedAt ?? new Date() },
        });
      } else {
        // 重新开放 only makes sense while the deadline (if any) is still ahead.
        if (activity.endAt && activity.endAt.getTime() <= Date.now()) {
          return NextResponse.json({ error: 'deadline_passed' }, { status: 400 });
        }
        await prisma.voteActivity.update({
          where: { id: activity.id },
          data: { closedAt: null },
        });
      }
      return NextResponse.json({ ok: true, closed: parsed.data.closed });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // ── partial content/settings edit ──
  const parsed = contentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const input = parsed.data;

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.descriptionMd !== undefined) data.descriptionMd = input.descriptionMd;
  if (input.announcement !== undefined) data.announcement = input.announcement;
  if (input.votesPerUser !== undefined) data.votesPerUser = input.votesPerUser;
  if (input.budgetPeriod !== undefined && input.budgetPeriod !== activity.budgetPeriod) {
    // Switching the budget period re-buckets VoteBallot.day, which would make
    // every existing ballot invisible to the budget/cap checks (fresh budgets
    // for all, unrevokable orphan votes) — locked once anyone has voted,
    // mirroring the polls poll_has_votes contract.
    const balloted = await prisma.voteBallot.count({ where: { activityId: activity.id } });
    if (balloted > 0) {
      return NextResponse.json({ error: 'budget_period_locked' }, { status: 400 });
    }
    data.budgetPeriod = input.budgetPeriod;
  }
  if (input.maxPerEntry !== undefined) data.maxPerEntry = input.maxPerEntry;
  if (input.allowRevoke !== undefined) data.allowRevoke = input.allowRevoke;
  if (input.resultsMode !== undefined) data.resultsMode = input.resultsMode;
  if (input.showTitles !== undefined) data.showTitles = input.showTitles;
  if (input.showAuthors !== undefined) data.showAuthors = input.showAuthors;
  if (input.entryOrder !== undefined) data.entryOrder = input.entryOrder;
  if (input.allowSubmissions !== undefined) data.allowSubmissions = input.allowSubmissions;
  if (input.submissionReview !== undefined) data.submissionReview = input.submissionReview;
  if (input.submissionMedia !== undefined) data.submissionMedia = input.submissionMedia;
  if (input.maxSubmissionsPerUser !== undefined) data.maxSubmissionsPerUser = input.maxSubmissionsPerUser;
  if (input.maxSubmissionMb !== undefined) data.maxSubmissionMb = input.maxSubmissionMb;
  if (input.submitTitle !== undefined) data.submitTitle = input.submitTitle;
  if (input.submitAuthorName !== undefined) data.submitAuthorName = input.submitAuthorName;
  if (input.submitAuthorNo !== undefined) data.submitAuthorNo = input.submitAuthorNo;
  if (input.submitDescription !== undefined) data.submitDescription = input.submitDescription;
  if (input.submissionFields !== undefined) {
    const fields = parseCustomFields(input.submissionFields);
    if (fields === null) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    data.submissionFields = fields;
  }
  if (input.submissionNote !== undefined) data.submissionNote = input.submissionNote;
  if (input.allowComments !== undefined) data.allowComments = input.allowComments;

  // Dates: validate the PAIR against the final values.
  const nextStart =
    input.startAt === undefined ? activity.startAt : input.startAt ? new Date(input.startAt) : null;
  const nextEnd =
    input.endAt === undefined ? activity.endAt : input.endAt ? new Date(input.endAt) : null;
  if (nextStart && nextEnd && nextEnd.getTime() <= nextStart.getTime()) {
    return NextResponse.json({ error: 'end_before_start' }, { status: 400 });
  }
  if (input.startAt !== undefined) data.startAt = nextStart;
  if (input.endAt !== undefined) data.endAt = nextEnd;

  // Cover: client echoes the uploaded key; server re-derives the URL and
  // verifies the file exists (never trust a client URL). Keys are visible in
  // rendered URLs and there is no ownership ledger for covers, so a key
  // already referenced by ANOTHER activity is rejected — otherwise a member
  // could hijack someone else's cover and then delete the shared file.
  let oldCoverKeyToDelete: string | null = null;
  if (input.coverKey !== undefined) {
    if (input.coverKey === null || input.coverKey === '') {
      oldCoverKeyToDelete = voteMediaKeyFromUrl(activity.coverUrl);
      data.coverUrl = null;
    } else {
      if (!isValidVoteMediaKey(input.coverKey, 'cover')) {
        return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
      }
      const stat = await statVoteMediaAsync(input.coverKey);
      if (!stat) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
      const nextUrl = voteMediaPublicUrl(input.coverKey);
      if (nextUrl !== activity.coverUrl) {
        const inUse = await prisma.voteActivity.findFirst({
          // Soft-deleted rows keep their files — count them as references too.
          where: { coverUrl: nextUrl, id: { not: activity.id } },
          select: { id: true },
        });
        if (inUse) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
        oldCoverKeyToDelete = voteMediaKeyFromUrl(activity.coverUrl);
        data.coverUrl = nextUrl;
      }
    }
  }

  await prisma.voteActivity.update({ where: { id: activity.id }, data });
  if (oldCoverKeyToDelete && oldCoverKeyToDelete !== input.coverKey) {
    // Unlink only when no surviving row still references the old file.
    const stillUsed = activity.coverUrl
      ? await prisma.voteActivity.findFirst({
          where: { coverUrl: activity.coverUrl, id: { not: activity.id } },
          select: { id: true },
        })
      : null;
    if (!stillUsed) await deleteVoteMediaFile(oldCoverKeyToDelete);
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/votes/[id] — soft delete (files retained, house policy).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const viewer = voteViewerFromSession(session);
  const activity = await findManagedActivity(params.id, viewer);
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.voteActivity.updateMany({
    where: { id: activity.id, deletedAt: null },
    data: { deletedAt: new Date(), featured: false, featuredAt: null },
  });
  if (viewer.canManage && activity.creatorId !== session.user.id) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_vote_activity',
      targetType: 'vote_activity',
      targetId: activity.id,
      details: { title: activity.title },
    });
  }
  return NextResponse.json({ ok: true });
}
