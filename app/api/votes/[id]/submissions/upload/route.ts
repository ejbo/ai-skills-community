import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { MAX_UPLOAD_SAFETY_BYTES, hasFreeSpace } from '@/lib/uploads/disk-space';
import { voteOver } from '@/lib/votes/shared';
import {
  MAX_VOTE_IMAGE_BYTES,
  MAX_VOTE_POSTER_BYTES,
  MAX_VOTE_VIDEO_BYTES,
  isAllowedVoteImageType,
  isAllowedVoteVideoType,
  newVoteMediaKey,
  saveVoteMediaStream,
  voteMediaExtFor,
  voteMediaPublicUrl,
} from '@/lib/votes/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const UPLOADS_PER_MINUTE = 10;

// POST /api/votes/[id]/submissions/upload (any member) — raw-body upload for a
// SELF-SUBMITTED entry. Two-phase like shorts: this route only stores bytes and
// returns {key,url,size}; the entry row is created by POST
// /api/votes/[id]/submissions, which re-validates the echoed keys. Headers:
//   content-type:  file MIME — image/* or video/* per the activity's
//                  submissionMedia setting ('poster' kind is always an image)
//   x-upload-kind: 'media' | 'poster'
//   x-filename:    encodeURIComponent(file.name) (extension hint only)
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`votes:submit-upload:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const activity = await prisma.voteActivity.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      deletedAt: true,
      status: true,
      startAt: true,
      endAt: true,
      closedAt: true,
      allowSubmissions: true,
      submissionMedia: true,
      maxSubmissionMb: true,
      maxSubmissionsPerUser: true,
    },
  });
  if (!activity || activity.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // 投稿窗口：已发布且未结束（startAt 只挡投票，不挡投稿 ⇒ 征集期可先行）。
  if (!activity.allowSubmissions || activity.status !== 'published' || voteOver(activity)) {
    return NextResponse.json({ error: 'submissions_closed' }, { status: 400 });
  }

  // Cheap pre-check so a spent quota fails before megabytes fly; the publish
  // route re-checks authoritatively inside its transaction.
  const mine = await prisma.voteEntry.count({
    where: { activityId: activity.id, submitterId: session.user.id, status: { not: 'rejected' } },
  });
  if (mine >= activity.maxSubmissionsPerUser) {
    return NextResponse.json({ error: 'submission_quota' }, { status: 400 });
  }

  const uploadKind = req.headers.get('x-upload-kind') === 'poster' ? 'poster' : 'media';
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }

  const isVideo = isAllowedVoteVideoType(contentType);
  const isImage = isAllowedVoteImageType(contentType);
  let storageKind: 'image' | 'video' | 'poster';
  let max: number;
  if (uploadKind === 'poster') {
    if (!isImage) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
    storageKind = 'poster';
    max = MAX_VOTE_POSTER_BYTES;
  } else if (isVideo) {
    if (activity.submissionMedia === 'image') {
      return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
    }
    storageKind = 'video';
    max = MAX_VOTE_VIDEO_BYTES;
  } else if (isImage) {
    if (activity.submissionMedia === 'video') {
      return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
    }
    storageKind = 'image';
    max = MAX_VOTE_IMAGE_BYTES;
  } else {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }
  // 发起人配置的单文件上限（MB）叠加在类型基线之上。
  if (uploadKind === 'media' && activity.maxSubmissionMb) {
    max = Math.min(max, activity.maxSubmissionMb * 1024 * 1024);
  }
  // …and under everything sits the volume-safety ceiling: MAX_VOTE_VIDEO_BYTES
  // is deliberately unbounded (product decision), which left a member able to
  // push an arbitrarily large file onto the disk PostgreSQL lives on.
  max = Math.min(max, MAX_UPLOAD_SAFETY_BYTES);

  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (!(await hasFreeSpace(declared))) {
    return NextResponse.json({ error: 'insufficient_storage' }, { status: 507 });
  }
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newVoteMediaKey(storageKind, voteMediaExtFor(storageKind, contentType, filename));
  try {
    const size = await saveVoteMediaStream(key, req.body, max);
    return NextResponse.json({ key, url: voteMediaPublicUrl(key), size, kind: storageKind });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (msg === 'empty_body') return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
