import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { findManagedActivity, voteViewerFromSession } from '@/lib/vote-queries';

export const dynamic = 'force-dynamic';

// GET /api/votes/[id]/entries/[entryId]/ballots (creator/admin) — who voted
// for this entry. 隐私账号 contract: handle (= W3 工号) and department are
// trimmed for non-admin creators; displayName stays as the visible identity.
export async function GET(
  _req: Request,
  { params }: { params: { id: string; entryId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const viewer = voteViewerFromSession(session);
  const activity = await findManagedActivity(params.id, viewer);
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const entry = await prisma.voteEntry.findUnique({
    where: { id: params.entryId },
    select: { activityId: true },
  });
  if (!entry || entry.activityId !== activity.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ballots = await prisma.voteBallot.findMany({
    where: { entryId: params.entryId },
    orderBy: { updatedAt: 'desc' },
    take: 500,
    select: {
      count: true,
      day: true,
      updatedAt: true,
      user: { select: { handle: true, displayName: true, department: true, isPrivate: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    ballots: ballots.map((b) => ({
      displayName: b.user.displayName,
      handle: b.user.isPrivate && !viewer.isAdmin ? '' : b.user.handle,
      department: b.user.isPrivate && !viewer.isAdmin ? '' : (b.user.department ?? ''),
      count: b.count,
      day: b.day,
      at: b.updatedAt.toISOString(),
    })),
  });
}
