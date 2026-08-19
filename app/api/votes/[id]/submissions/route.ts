import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { recountVisibleEntries } from '@/lib/vote-queries';
import {
  VOTE_ENTRY_AUTHOR_MAX,
  VOTE_ENTRY_DESCRIPTION_MAX,
  VOTE_ENTRY_TITLE_MAX,
  parseCustomFields,
  resolveCustomAnswers,
  voteOver,
} from '@/lib/votes/shared';
import {
  faststartRemuxVoteMedia,
  isValidVoteMediaKey,
  probeVoteMediaDurationSec,
  statVoteMediaAsync,
  voteMediaPublicUrl,
} from '@/lib/votes/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const INT32_MAX = 2147483647;

const submitSchema = z.object({
  kind: z.enum(['image', 'video']),
  fileKey: z.string().max(200),
  posterKey: z.string().max(200).nullable().optional(),
  title: z.string().trim().max(VOTE_ENTRY_TITLE_MAX).optional().default(''),
  description: z.string().trim().max(VOTE_ENTRY_DESCRIPTION_MAX).optional().default(''),
  authorName: z.string().trim().max(VOTE_ENTRY_AUTHOR_MAX).optional().default(''),
  // 工号 VALUE is never accepted from the client — only this opt-in flag for
  // the 'optional' config (required 工号 always stamps).
  includeAuthorNo: z.boolean().optional().default(true),
  formData: z.record(z.string(), z.unknown()).optional(),
  durationSec: z.number().int().min(0).max(24 * 60 * 60).optional().default(0),
});

// POST /api/votes/[id]/submissions (any member) — publish a self-submitted
// entry from keys uploaded via ./submissions/upload. The shorts contract:
// echoed keys are re-validated (shape + on-disk + not-attached-elsewhere),
// required form fields enforced per the activity's config, quota re-checked
// INSIDE the transaction, entry lands as pending when 审核 is on.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const userId = session.user.id;

  const gate = rateLimit(`votes:submit:${userId}`, 10, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const input = parsed.data;

  const activity = await prisma.voteActivity.findUnique({ where: { id: params.id } });
  if (!activity || activity.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!activity.allowSubmissions || activity.status !== 'published' || voteOver(activity)) {
    return NextResponse.json({ error: 'submissions_closed' }, { status: 400 });
  }
  if (
    (input.kind === 'video' && activity.submissionMedia === 'image') ||
    (input.kind === 'image' && activity.submissionMedia === 'video')
  ) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }

  // ── form fields per the creator's config ──
  // 'off' fields are forced empty (never trust the client to honor the config).
  // 作者名 prefills client-side and stays editable; 工号 is LOCKED to the
  // submitter's own huaweiW3Id — client input is ignored entirely, so a member
  // can never submit under someone else's employee id.
  const title = activity.submitTitle === 'off' ? '' : input.title;
  const description = activity.submitDescription === 'off' ? '' : input.description;
  let authorName = activity.submitAuthorName === 'off' ? '' : input.authorName;
  // 'optional' 工号 honors the submitter's opt-out (blank stays blank — a
  // private user must be able to keep their W3 id off the entry); 'required'
  // always stamps. The VALUE always comes from the profile, never the client.
  let authorNo = '';
  const wantsAuthorNo =
    activity.submitAuthorNo === 'required' ||
    (activity.submitAuthorNo === 'optional' && input.includeAuthorNo);
  if (wantsAuthorNo) {
    const profile = await prisma.user.findUnique({
      where: { id: userId },
      select: { huaweiW3Id: true },
    });
    authorNo = (profile?.huaweiW3Id ?? '').toLowerCase();
  }
  if (activity.submitAuthorName === 'required' && !authorName) {
    const profile = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    authorName = profile?.displayName ?? '';
  }
  if (activity.submitTitle === 'required' && !title) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 });
  }
  if (activity.submitDescription === 'required' && !description) {
    return NextResponse.json({ error: 'description_required' }, { status: 400 });
  }
  if (activity.submitAuthorName === 'required' && !authorName) {
    return NextResponse.json({ error: 'author_required' }, { status: 400 });
  }
  if (activity.submitAuthorNo === 'required' && !authorNo) {
    // required 工号 + 无 W3 绑定 ⇒ 需要华为账号才能投稿。
    return NextResponse.json({ error: 'huawei_required' }, { status: 403 });
  }

  // 自定义表单字段：必填校验 + 未知字段丢弃 + 长度钳制。
  const fieldDefs = parseCustomFields(activity.submissionFields) ?? [];
  const customAnswers = resolveCustomAnswers(fieldDefs, input.formData);
  if (customAnswers === null) {
    return NextResponse.json({ error: 'custom_field_required' }, { status: 400 });
  }

  // ── echoed keys: shape + on-disk + size cap + not-attached-elsewhere ──
  if (!isValidVoteMediaKey(input.fileKey, input.kind)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const stat = await statVoteMediaAsync(input.fileKey);
  if (!stat) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (
    activity.maxSubmissionMb &&
    stat.size > activity.maxSubmissionMb * 1024 * 1024
  ) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  let posterKey: string | null = null;
  if (input.posterKey) {
    if (input.kind !== 'video' || !isValidVoteMediaKey(input.posterKey, 'poster')) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    if (!(await statVoteMediaAsync(input.posterKey))) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    posterKey = input.posterKey;
  }

  const claimedKeys = posterKey ? [input.fileKey, posterKey] : [input.fileKey];
  const status = activity.submissionReview ? 'pending' : 'approved';

  // Quota + entryNo + key-claiming live in ONE Serializable tx (poll pattern):
  // parallel publishes must not exceed maxSubmissionsPerUser, and the
  // fileKey/posterKey uniques backstop a double-claimed upload at the DB level.
  let entry: Prisma.VoteEntryGetPayload<object>;
  for (let attempt = 0; ; attempt++) {
    try {
      entry = await prisma.$transaction(
        async (tx) => {
          const claimed = await tx.voteEntry.findFirst({
            where: {
              OR: [{ fileKey: { in: claimedKeys } }, { posterKey: { in: claimedKeys } }],
            },
            select: { id: true },
          });
          if (claimed) throw new Error('key_claimed');
          const mine = await tx.voteEntry.count({
            where: { activityId: activity.id, submitterId: userId, status: { not: 'rejected' } },
          });
          if (mine >= activity.maxSubmissionsPerUser) throw new Error('submission_quota');
          const last = await tx.voteEntry.findFirst({
            where: { activityId: activity.id },
            orderBy: { entryNo: 'desc' },
            select: { entryNo: true },
          });
          const created = await tx.voteEntry.create({
            data: {
              activityId: activity.id,
              entryNo: (last?.entryNo ?? 0) + 1,
              kind: input.kind,
              fileKey: input.fileKey,
              fileUrl: voteMediaPublicUrl(input.fileKey),
              posterKey,
              posterUrl: posterKey ? voteMediaPublicUrl(posterKey) : null,
              originalName: '',
              title,
              description,
              formData: Object.keys(customAnswers).length > 0 ? customAnswers : undefined,
              authorName,
              authorNo,
              // 投稿者填写的命名不是解析产物 — 重新应用规则不得覆盖。
              titleEdited: true,
              mimeType: stat.contentType,
              sizeBytes: Math.min(stat.size, INT32_MAX),
              durationSec: input.kind === 'video' ? input.durationSec : 0,
              submitterId: userId,
              status,
            },
          });
          if (status === 'approved') await recountVisibleEntries(tx, activity.id);
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'submission_quota') {
          return NextResponse.json({ error: 'submission_quota' }, { status: 400 });
        }
        if (e.message === 'key_claimed') {
          return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
        }
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // fileKey/posterKey unique ⇒ a racing request claimed this upload —
        // permanent, don't retry. entryNo unique ⇒ counter race — retry.
        const target = Array.isArray(e.meta?.target) ? (e.meta?.target as string[]) : [];
        if (target.includes('fileKey') || target.includes('posterKey')) {
          return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
        }
        if (attempt < 5) continue;
      }
      const serializeConflict =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (serializeConflict && attempt < 5) {
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 60));
        continue;
      }
      return NextResponse.json({ error: 'submit_failed' }, { status: 500 });
    }
  }

  // Finalize media AFTER the row exists: the create above is what excludes a
  // concurrent double-claim, so only one request can ever remux this file
  // (concurrent remuxes share a tmp path — corruption risk). Best-effort.
  let durationSec = entry.durationSec;
  if (input.kind === 'video') {
    await faststartRemuxVoteMedia(input.fileKey, stat.size);
    const probed = await probeVoteMediaDurationSec(input.fileKey);
    if (probed && probed !== durationSec) {
      durationSec = probed;
      await prisma.voteEntry
        .update({ where: { id: entry.id }, data: { durationSec: probed } })
        .catch(() => undefined);
    }
  }

  return NextResponse.json({
    ok: true,
    pending: status === 'pending',
    entry: {
      id: entry.id,
      entryNo: entry.entryNo,
      kind: entry.kind,
      fileUrl: entry.fileUrl,
      posterUrl: entry.posterUrl,
      title: entry.title,
      status: entry.status,
      reviewNote: entry.reviewNote,
      voteCount: null,
      createdAt: entry.createdAt.toISOString(),
    },
  });
}
