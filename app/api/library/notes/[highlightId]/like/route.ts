import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/library/notes/[highlightId]/like (login) — toggle 有用 on a shared
// 批注. Ranking the 最热 sort, so the counter must not drift: the toggle and the
// counter move together in one transaction with GUARDED writes, and the
// response re-reads the authoritative row instead of trusting the local delta
// (two fast clicks from two tabs otherwise diverge).
export async function POST(_req: Request, { params }: { params: { highlightId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:note-like:${session.user.id}`, 60, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const highlight = await prisma.libraryHighlight.findUnique({
    where: { id: params.highlightId },
    select: {
      id: true,
      userId: true,
      doc: {
        select: { id: true, uploaderId: true, visibility: true, status: true, deletedAt: true },
      },
    },
  });
  if (!highlight || highlight.doc.deletedAt || highlight.doc.status !== 'ready') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!(await canReadDoc(highlight.doc, libraryViewerFromSession(session)))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Only annotations their owner actually shares are likeable.
  if (highlight.userId !== session.user.id) {
    const shared = await prisma.libraryProgress.findUnique({
      where: { userId_docId: { userId: highlight.userId, docId: highlight.doc.id } },
      select: { shareNotes: true },
    });
    if (!shared?.shareNotes) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const userId = session.user.id;
  const key = { highlightId: highlight.id, userId };

  await prisma.$transaction(async (tx) => {
    const removed = await tx.libraryNoteLike.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.libraryHighlight.update({
        where: { id: highlight.id },
        data: { likeCount: { decrement: removed.count } },
      });
      return;
    }
    // createMany + skipDuplicates so a racing double-click is a no-op rather
    // than a unique-constraint 500 that also skips the counter.
    const added = await tx.libraryNoteLike.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.libraryHighlight.update({
        where: { id: highlight.id },
        data: { likeCount: { increment: added.count } },
      });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.libraryHighlight.findUnique({
      where: { id: highlight.id },
      select: { likeCount: true },
    }),
    prisma.libraryNoteLike.findUnique({
      where: { highlightId_userId: key },
      select: { userId: true },
    }),
  ]);
  return NextResponse.json({
    ok: true,
    likeCount: Math.max(0, fresh?.likeCount ?? 0),
    liked: Boolean(mine),
  });
}
