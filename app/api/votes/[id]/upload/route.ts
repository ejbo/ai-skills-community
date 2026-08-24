import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { findManagedActivity, recountVisibleEntries, voteViewerFromSession } from '@/lib/vote-queries';
import { DEFAULT_NAME_RULE, applyNameRule, parseNameRule, voteOver } from '@/lib/votes/shared';
import {
  deleteVoteMediaFile,
  faststartRemuxVoteMedia,
  isAllowedVoteImageType,
  isAllowedVoteVideoType,
  maxBytesForVoteKind,
  newVoteMediaKey,
  probeVoteMediaDurationSec,
  saveVoteMediaStream,
  voteMediaExtFor,
  voteMediaPublicUrl,
  type VoteMediaKind,
} from '@/lib/votes/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
// Bulk intake is the core use case (hundreds of files per contest) — this is
// an anti-abuse burst guard, not a UX cap.
const UPLOADS_PER_MINUTE = 120;
const INT32_MAX = 2147483647;

// POST /api/votes/[id]/upload (activity creator or admin) — raw-body upload.
// Headers:
//   content-type:   file MIME (validated per kind)
//   x-upload-kind:  'image' | 'video' (creates a VoteEntry row — the resumable
//                   draft unit) | 'poster' (?entry=<id>, video cover frame)
//                   | 'cover' (activity cover; stored via a later PATCH)
//   x-filename:     encodeURIComponent(file.name) — parse-rule input + ext hint
// Optional query: ?duration=<sec> (client-probed fallback; ffprobe overrides).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`votes:upload:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const activity = await findManagedActivity(params.id, voteViewerFromSession(session));
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (voteOver(activity)) return NextResponse.json({ error: 'vote_over' }, { status: 400 });

  const kindRaw = req.headers.get('x-upload-kind') ?? 'image';
  const kind: VoteMediaKind =
    kindRaw === 'video' || kindRaw === 'poster' || kindRaw === 'cover' ? kindRaw : 'image';
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  // x-filename is the parse-rule input; a malformed %-escape must not 500.
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }

  const allowed =
    kind === 'video' ? isAllowedVoteVideoType(contentType) : isAllowedVoteImageType(contentType);
  if (!allowed) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });

  const url = new URL(req.url);

  // poster attaches to an existing entry of THIS activity — validate before streaming.
  let posterEntryId: string | null = null;
  if (kind === 'poster') {
    posterEntryId = url.searchParams.get('entry');
    if (!posterEntryId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    const entry = await prisma.voteEntry.findUnique({
      where: { id: posterEntryId },
      select: { activityId: true, kind: true },
    });
    if (!entry || entry.activityId !== activity.id || entry.kind !== 'video') {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
  }

  const max = maxBytesForVoteKind(kind);
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newVoteMediaKey(kind, voteMediaExtFor(kind, contentType, filename));
  let size = 0;
  try {
    size = await saveVoteMediaStream(key, req.body, max);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (msg === 'empty_body') return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  try {
    if (kind === 'cover') {
      return NextResponse.json({ key, url: voteMediaPublicUrl(key), size });
    }

    if (kind === 'poster' && posterEntryId) {
      const prev = await prisma.voteEntry.findUnique({
        where: { id: posterEntryId },
        select: { posterKey: true },
      });
      await prisma.voteEntry.update({
        where: { id: posterEntryId },
        data: { posterKey: key, posterUrl: voteMediaPublicUrl(key) },
      });
      if (prev?.posterKey && prev.posterKey !== key) await deleteVoteMediaFile(prev.posterKey);
      return NextResponse.json({ key, url: voteMediaPublicUrl(key), size });
    }
    if (kind === 'poster') {
      // ?entry= was validated above; unreachable, but keep the narrowing honest.
      await deleteVoteMediaFile(key);
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }

    // image / video → a VoteEntry row (the resumable-draft unit).
    let durationSec = 0;
    if (kind === 'video') {
      await faststartRemuxVoteMedia(key, size);
      const clientDuration = Number.parseInt(url.searchParams.get('duration') ?? '', 10);
      durationSec =
        (await probeVoteMediaDurationSec(key)) ??
        (Number.isFinite(clientDuration) && clientDuration > 0 ? clientDuration : 0);
    }

    const rule = parseNameRule(activity.nameRule) ?? DEFAULT_NAME_RULE;
    const parsed = applyNameRule(filename, rule);

    // entryNo = max+1 inside a tx; the (activityId, entryNo) unique catches
    // races between the picker's parallel uploads — retry on conflict.
    let entry: Prisma.VoteEntryGetPayload<object> | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        entry = await prisma.$transaction(async (tx) => {
          const last = await tx.voteEntry.findFirst({
            where: { activityId: activity.id },
            orderBy: { entryNo: 'desc' },
            select: { entryNo: true },
          });
          const created = await tx.voteEntry.create({
            data: {
              activityId: activity.id,
              entryNo: (last?.entryNo ?? 0) + 1,
              kind,
              fileKey: key,
              fileUrl: voteMediaPublicUrl(key),
              originalName: filename.slice(0, 255),
              title: parsed.title,
              authorName: parsed.authorName,
              authorNo: parsed.authorNo,
              mimeType: contentType,
              sizeBytes: Math.min(size, INT32_MAX),
              durationSec,
            },
          });
          await recountVisibleEntries(tx, activity.id);
          return created;
        });
        break;
      } catch (e) {
        const conflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (conflict && attempt < 5) continue;
        throw e;
      }
    }

    return NextResponse.json({
      entry: {
        id: entry!.id,
        entryNo: entry!.entryNo,
        kind: entry!.kind,
        fileUrl: entry!.fileUrl,
        posterUrl: entry!.posterUrl,
        posterAspect: entry!.posterAspect,
        posterPos: entry!.posterPos,
        originalName: entry!.originalName,
        title: entry!.title,
        authorName: entry!.authorName,
        authorNo: entry!.authorNo,
        titleEdited: entry!.titleEdited,
        mimeType: entry!.mimeType,
        sizeBytes: entry!.sizeBytes,
        durationSec: entry!.durationSec,
        hidden: entry!.hidden,
        voteCount: entry!.voteCount,
      },
    });
  } catch {
    // DB write failed after the file landed — don't leak the orphan file.
    await deleteVoteMediaFile(key);
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
