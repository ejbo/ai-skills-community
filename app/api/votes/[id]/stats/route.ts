import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { findManagedActivity, voteViewerFromSession } from '@/lib/vote-queries';
import { competitionRanks } from '@/lib/votes/shared';

export const dynamic = 'force-dynamic';

export interface VoteStatsEntry {
  id: string;
  entryNo: number;
  kind: 'image' | 'video';
  thumbUrl: string | null;
  title: string;
  authorName: string;
  authorNo: string;
  submitterName: string | null;
  status: 'approved' | 'pending' | 'rejected';
  hidden: boolean;
  voteCount: number;
  voterCount: number; // distinct voters on this entry
  commentCount: number;
  rank: number | null; // gallery-consistent rank (visible approved only)
}

// GET /api/votes/[id]/stats (creator/admin) — the 数据 tab's on-page detail:
// ranked entries with distinct-voter counts. Per-entry voter lists load lazily
// via /entries/[entryId]/ballots.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const activity = await findManagedActivity(params.id, voteViewerFromSession(session));
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [entries, ballotPairs] = await Promise.all([
    prisma.voteEntry.findMany({
      where: { activityId: activity.id },
      orderBy: [{ voteCount: 'desc' }, { entryNo: 'asc' }],
      select: {
        id: true,
        entryNo: true,
        kind: true,
        fileUrl: true,
        posterUrl: true,
        title: true,
        authorName: true,
        authorNo: true,
        status: true,
        hidden: true,
        voteCount: true,
        commentCount: true,
        submitter: { select: { displayName: true } },
      },
    }),
    // Distinct (entry, user) pairs — daily mode stores one row per day, so the
    // raw row count would overstate voters.
    prisma.voteBallot.findMany({
      where: { activityId: activity.id },
      distinct: ['entryId', 'userId'],
      select: { entryId: true },
    }),
  ]);

  const votersByEntry = new Map<string, number>();
  for (const pair of ballotPairs) {
    votersByEntry.set(pair.entryId, (votersByEntry.get(pair.entryId) ?? 0) + 1);
  }

  const visible = entries.filter((e) => !e.hidden && e.status === 'approved');
  const ranks = competitionRanks(visible.map((e) => e.voteCount));
  const rankById = new Map(visible.map((e, i) => [e.id, ranks[i]]));

  const items: VoteStatsEntry[] = entries.map((e) => ({
    id: e.id,
    entryNo: e.entryNo,
    kind: e.kind,
    thumbUrl: e.kind === 'video' ? e.posterUrl : e.fileUrl,
    title: e.title,
    authorName: e.authorName,
    authorNo: e.authorNo,
    submitterName: e.submitter?.displayName ?? null,
    status: e.status,
    hidden: e.hidden,
    voteCount: e.voteCount,
    voterCount: votersByEntry.get(e.id) ?? 0,
    commentCount: e.commentCount,
    rank: rankById.get(e.id) ?? null,
  }));

  return NextResponse.json({
    ok: true,
    entries: items,
    totals: {
      entryCount: activity.entryCount,
      voteCount: activity.voteCount,
      voterCount: activity.voterCount,
    },
  });
}
